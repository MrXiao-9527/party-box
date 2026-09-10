import {
  ACK_REASONS,
  DEFAULT_DENOMS,
  MAX_SEATS,
  findLastUndoable,
  ledgerEntrySummary,
  type ChipAck,
  type ChipOp,
  type Phase,
  type RoomState,
  type TableSnapshot,
} from '../types'

const ROOM_PREFIX = 'party-box:room:'
const SESSION_KEY = 'party-box:session'

export interface Session {
  seatId: string
  name: string
  roomCode: string
}

export interface PersistedRoom {
  room: RoomState
  table: TableSnapshot
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return code
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function saveSession(session: Session | null): void {
  if (!session) {
    localStorage.removeItem(SESSION_KEY)
    return
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function normalizePot(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function normalizeRoom(data: PersistedRoom): PersistedRoom {
  return {
    ...data,
    room: {
      ...data.room,
      maxSeats: MAX_SEATS,
      members: data.room.members.slice(0, MAX_SEATS),
    },
    table: {
      ...data.table,
      seats: data.table.seats.slice(0, MAX_SEATS),
      pot: normalizePot(data.table.pot),
      ledger: Array.isArray(data.table.ledger) ? data.table.ledger : [],
    },
  }
}

export function loadRoom(roomCode: string): PersistedRoom | null {
  try {
    const raw = localStorage.getItem(ROOM_PREFIX + roomCode.toUpperCase())
    if (!raw) return null
    return normalizeRoom(JSON.parse(raw) as PersistedRoom)
  } catch {
    return null
  }
}

export function saveRoom(data: PersistedRoom): void {
  const normalized = normalizeRoom(data)
  localStorage.setItem(
    ROOM_PREFIX + normalized.room.roomCode.toUpperCase(),
    JSON.stringify(normalized),
  )
}

export function deleteRoom(roomCode: string): void {
  localStorage.removeItem(ROOM_PREFIX + roomCode.toUpperCase())
}

/**
 * Silent restore: seatId still in room → mark connected, return snapshot.
 * Host reopening a paused table stays disconnected until「重开一桌」so the
 * member list stays consistent with「桌主已离开 · 桌子已暂停」.
 */
export function restoreSeat(
  roomCode: string,
  seatId: string,
): PersistedRoom | null {
  const existing = loadRoom(roomCode)
  if (!existing) return null
  if (!existing.room.members.some((m) => m.seatId === seatId)) return null
  if (
    existing.room.phase === 'paused' &&
    seatId === existing.room.hostSeatId
  ) {
    return existing
  }
  return setMemberConnected(roomCode, seatId, true)
}


export function createEmptyHostRoom(): {
  session: Session
  data: PersistedRoom
} {
  const roomCode = generateRoomCode()
  const seatId = uid('seat')
  const now = Date.now()
  const data: PersistedRoom = {
    room: {
      roomCode,
      hostSeatId: seatId,
      phase: 'lobby',
      maxSeats: MAX_SEATS,
      members: [],
    },
    table: {
      snapshotAt: now,
      denoms: [...DEFAULT_DENOMS],
      seats: [],
      pot: 0,
      ledger: [],
    },
  }
  saveRoom(data)
  const session: Session = { seatId, name: '', roomCode }
  saveSession(session)
  return { session, data }
}

export function claimHostSeat(
  roomCode: string,
  seatId: string,
  name: string,
): PersistedRoom | null {
  const existing = loadRoom(roomCode)
  if (!existing) return null
  if (existing.room.hostSeatId !== seatId) return null

  const already = existing.room.members.find((m) => m.seatId === seatId)
  if (already) {
    const members = existing.room.members.map((m) =>
      m.seatId === seatId ? { ...m, name, isHost: true, connected: true } : m,
    )
    const seats = existing.table.seats.map((s) =>
      s.seatId === seatId ? { ...s, name, isHost: true } : s,
    )
    const data: PersistedRoom = {
      room: { ...existing.room, members, maxSeats: MAX_SEATS },
      table: {
        ...existing.table,
        seats,
        snapshotAt: Date.now(),
        pot: normalizePot(existing.table.pot),
        ledger: existing.table.ledger ?? [],
      },
    }
    saveRoom(data)
    saveSession({ seatId, name, roomCode: existing.room.roomCode })
    return data
  }

  if (existing.room.members.length >= MAX_SEATS) return null

  const data: PersistedRoom = {
    room: {
      ...existing.room,
      hostSeatId: seatId,
      maxSeats: MAX_SEATS,
      members: [
        { seatId, name, isHost: true, connected: true },
        ...existing.room.members.map((m) => ({ ...m, isHost: false })),
      ],
    },
    table: {
      snapshotAt: Date.now(),
      denoms: existing.table.denoms,
      seats: [
        { seatId, name, isHost: true, locked: false, balance: 0 },
        ...existing.table.seats.map((s) => ({ ...s, isHost: false })),
      ],
      pot: normalizePot(existing.table.pot),
      ledger: existing.table.ledger ?? [],
    },
  }
  saveRoom(data)
  saveSession({ seatId, name, roomCode: existing.room.roomCode })
  return data
}

export function createRoomAsHost(name: string): {
  session: Session
  data: PersistedRoom
} {
  const roomCode = generateRoomCode()
  const seatId = uid('seat')
  const now = Date.now()
  const data: PersistedRoom = {
    room: {
      roomCode,
      hostSeatId: seatId,
      phase: 'lobby',
      maxSeats: MAX_SEATS,
      members: [{ seatId, name, isHost: true, connected: true }],
    },
    table: {
      snapshotAt: now,
      denoms: [...DEFAULT_DENOMS],
      seats: [{ seatId, name, isHost: true, locked: false, balance: 0 }],
      pot: 0,
      ledger: [],
    },
  }
  saveRoom(data)
  const session: Session = { seatId, name, roomCode }
  saveSession(session)
  return { session, data }
}

export function joinRoom(
  roomCode: string,
  name: string,
): { session: Session; data: PersistedRoom } | { error: string } {
  const code = roomCode.trim().toUpperCase()
  if (!/^[A-Z0-9]+$/.test(code)) {
    return { error: ACK_REASONS.ROOM_CODE_INVALID }
  }
  const existing = loadRoom(code)
  if (!existing) {
    return { error: ACK_REASONS.ROOM_MISSING }
  }

  // Always allocate a new seatId (restore / takeover paths bind an existing seat
  // before NicknameGate; nick after seat_taken / identity_lost lands here).
  if (existing.room.members.length >= MAX_SEATS) {
    return { error: ACK_REASONS.TABLE_FULL }
  }

  const seatId = uid('seat')
  const data: PersistedRoom = {
    room: {
      ...existing.room,
      maxSeats: MAX_SEATS,
      members: [
        ...existing.room.members,
        { seatId, name, isHost: false, connected: true },
      ],
    },
    table: {
      ...existing.table,
      snapshotAt: Date.now(),
      seats: [
        ...existing.table.seats,
        { seatId, name, isHost: false, locked: false, balance: 0 },
      ],
      pot: normalizePot(existing.table.pot),
      ledger: existing.table.ledger ?? [],
    },
  }
  saveRoom(data)
  const nextSession: Session = { seatId, name, roomCode: code }
  saveSession(nextSession)
  return { session: nextSession, data }
}

/** DEV: pad fake members up to MAX_SEATS (keeps real seats). */
export function fillSeatsToMax(roomCode: string): PersistedRoom | { error: string } {
  const existing = loadRoom(roomCode)
  if (!existing) return { error: ACK_REASONS.ROOM_MISSING }

  const members = [...existing.room.members]
  const seats = [...existing.table.seats]
  let n = 1
  while (members.length < MAX_SEATS) {
    const seatId = uid('seat')
    const name = `座位${n++}`
    members.push({ seatId, name, isHost: false, connected: true })
    seats.push({ seatId, name, isHost: false, locked: false, balance: 0 })
  }

  const data: PersistedRoom = {
    room: { ...existing.room, members, maxSeats: MAX_SEATS },
    table: { ...existing.table, seats, snapshotAt: Date.now() },
  }
  saveRoom(data)
  return data
}

export function setPhase(roomCode: string, phase: Phase): PersistedRoom | null {
  const existing = loadRoom(roomCode)
  if (!existing) return null
  const data: PersistedRoom = {
    ...existing,
    room: { ...existing.room, phase, maxSeats: MAX_SEATS },
    table: { ...existing.table, snapshotAt: Date.now() },
  }
  saveRoom(data)
  return data
}

export function setMemberConnected(
  roomCode: string,
  seatId: string,
  connected: boolean,
): PersistedRoom | null {
  const existing = loadRoom(roomCode)
  if (!existing) return null

  const members = existing.room.members.map((m) =>
    m.seatId === seatId ? { ...m, connected } : m,
  )

  // Connection flag only. Host-leave pause is explicit via setPhase('paused')
  // (DevPanel / signalHostDisconnect). Auto-pausing here would turn same-tab
  // refresh into「桌主已离开」and break silent 回席 while playing.
  const data: PersistedRoom = {
    room: {
      ...existing.room,
      members,
      maxSeats: MAX_SEATS,
    },
    table: { ...existing.table, snapshotAt: Date.now() },
  }
  saveRoom(data)
  return data
}

/**
 * Explicit host handoff only — never called automatically on disconnect.
 */
export function pickNewHost(
  roomCode: string,
  newHostSeatId: string,
): PersistedRoom | { error: string } {
  const existing = loadRoom(roomCode)
  if (!existing) return { error: ACK_REASONS.ROOM_MISSING }

  const candidate = existing.room.members.find((m) => m.seatId === newHostSeatId)
  if (!candidate) return { error: ACK_REASONS.INVALID }
  if (!candidate.connected) {
    return { error: '该成员已离线，无法成为桌主' }
  }

  const members = existing.room.members.map((m) => ({
    ...m,
    isHost: m.seatId === newHostSeatId,
  }))
  const seats = existing.table.seats.map((s) => ({
    ...s,
    isHost: s.seatId === newHostSeatId,
  }))

  // New host resumes the table
  const data: PersistedRoom = {
    room: {
      ...existing.room,
      hostSeatId: newHostSeatId,
      members,
      phase: 'playing',
      maxSeats: MAX_SEATS,
    },
    table: { ...existing.table, seats, snapshotAt: Date.now() },
  }
  saveRoom(data)
  return data
}

export function resumeAsHost(roomCode: string, hostSeatId: string): PersistedRoom | null {
  const existing = loadRoom(roomCode)
  if (!existing) return null
  if (existing.room.hostSeatId !== hostSeatId) return null
  return setPhase(roomCode, 'playing')
}

/** Host-authoritative chip op applicator. */
export function applyChipOp(op: ChipOp): {
  ack: ChipAck
  data: PersistedRoom | null
} {
  const existing = loadRoom(op.roomCode)
  if (!existing) {
    return {
      ack: { opId: op.opId, ok: false, reason: ACK_REASONS.ROOM_MISSING },
      data: null,
    }
  }

  if (existing.room.phase === 'paused') {
    return {
      ack: {
        opId: op.opId,
        ok: false,
        reason: ACK_REASONS.TABLE_PAUSED,
        snapshotAt: existing.table.snapshotAt,
      },
      data: existing,
    }
  }

  const isHost = op.fromSeatId === existing.room.hostSeatId
  const seats = existing.table.seats.map((s) => ({ ...s }))
  const target = seats.find((s) => s.seatId === op.targetSeatId)
  let ledger = [...(existing.table.ledger ?? [])]
  let pot = normalizePot(existing.table.pot)

  const fail = (reason: string) => ({
    ack: {
      opId: op.opId,
      ok: false,
      reason,
      snapshotAt: existing.table.snapshotAt,
    } satisfies ChipAck,
    data: existing,
  })

  if (
    !target &&
    op.type !== 'resetTable' &&
    op.type !== 'transfer' &&
    op.type !== 'uniformBuyIn' &&
    op.type !== 'potIn' &&
    op.type !== 'potOut' &&
    op.type !== 'potSplit' &&
    op.type !== 'undoLast'
  ) {
    return fail(ACK_REASONS.INVALID)
  }

  switch (op.type) {
    case '+denom':
    case '-denom': {
      if (!target) return fail(ACK_REASONS.INVALID)
      if (target.locked) return fail(ACK_REASONS.SEAT_LOCKED)
      if (!isHost && op.fromSeatId !== op.targetSeatId) {
        return fail(ACK_REASONS.NOT_HOST)
      }
      const denom = op.denom ?? 0
      if (denom <= 0) return fail(ACK_REASONS.INVALID)
      const before = target.balance
      const delta = op.type === '+denom' ? denom : -denom
      target.balance = Math.max(0, target.balance + delta)
      const actual = target.balance - before
      if (actual !== 0) {
        ledger.push({
          id: uid('led'),
          kind: 'seatAdjust',
          fromSeatId: target.seatId,
          fromName: target.name,
          toSeatId: '',
          toName: '',
          amount: actual,
          at: Date.now(),
        })
        if (ledger.length > 100) ledger = ledger.slice(-100)
      }
      break
    }
    case '+batch':
    case '-batch': {
      if (!target) return fail(ACK_REASONS.INVALID)
      if (target.locked) return fail(ACK_REASONS.SEAT_LOCKED)
      if (!isHost && op.fromSeatId !== op.targetSeatId) {
        return fail(ACK_REASONS.NOT_HOST)
      }
      const amount = op.amount ?? 0
      if (amount <= 0) return fail(ACK_REASONS.INVALID)
      const before = target.balance
      const delta = op.type === '+batch' ? amount : -amount
      target.balance = Math.max(0, target.balance + delta)
      const actual = target.balance - before
      if (actual !== 0) {
        ledger.push({
          id: uid('led'),
          kind: 'seatAdjust',
          fromSeatId: target.seatId,
          fromName: target.name,
          toSeatId: '',
          toName: '',
          amount: actual,
          at: Date.now(),
        })
        if (ledger.length > 100) ledger = ledger.slice(-100)
      }
      break
    }
    case 'set': {
      if (!isHost) return fail(ACK_REASONS.NOT_HOST)
      if (!target) return fail(ACK_REASONS.INVALID)
      target.balance = Math.max(0, op.amount ?? 0)
      break
    }
    case 'resetSeat': {
      if (!isHost) return fail(ACK_REASONS.NOT_HOST)
      if (!target) return fail(ACK_REASONS.INVALID)
      target.balance = 0
      target.locked = false
      break
    }
    case 'resetTable': {
      if (!isHost) return fail(ACK_REASONS.NOT_HOST)
      for (const s of seats) {
        s.balance = 0
        s.locked = false
      }
      break
    }
    case 'lock':
    case 'unlock': {
      if (!isHost && op.fromSeatId !== op.targetSeatId) {
        return fail(ACK_REASONS.NOT_HOST)
      }
      if (!target) return fail(ACK_REASONS.INVALID)
      target.locked = op.type === 'lock'
      break
    }
    case 'transfer': {
      const amount = op.amount ?? 0
      if (!Number.isInteger(amount) || amount <= 0) {
        return fail(ACK_REASONS.INVALID)
      }

      const rawIds =
        op.targetSeatIds && op.targetSeatIds.length > 0
          ? op.targetSeatIds
          : [op.targetSeatId]
      const seen = new Set<string>()
      const targetIds: string[] = []
      for (const id of rawIds) {
        if (!id || seen.has(id)) continue
        seen.add(id)
        targetIds.push(id)
      }
      if (targetIds.length === 0) return fail(ACK_REASONS.INVALID)
      if (targetIds.includes(op.fromSeatId)) {
        return fail(ACK_REASONS.SELF_TRANSFER)
      }

      const sender = seats.find((s) => s.seatId === op.fromSeatId)
      if (!sender) return fail(ACK_REASONS.INVALID)
      if (sender.locked) return fail(ACK_REASONS.SEAT_LOCKED)

      const receivers = []
      for (const tid of targetIds) {
        const t = seats.find((s) => s.seatId === tid)
        if (!t) return fail(ACK_REASONS.INVALID)
        if (t.locked) return fail(ACK_REASONS.SEAT_LOCKED)
        receivers.push(t)
      }

      const total = amount * receivers.length
      if (sender.balance < total) return fail(ACK_REASONS.INSUFFICIENT)

      // All-or-nothing: mutate only after every check passed.
      sender.balance -= total
      const at = Date.now()
      for (const t of receivers) {
        t.balance += amount
        ledger.push({
          id: uid('led'),
          kind: 'transfer',
          fromSeatId: sender.seatId,
          fromName: sender.name,
          toSeatId: t.seatId,
          toName: t.name,
          amount,
          at,
        })
      }
      // Cap growth — keep newest 100 successful rows.
      if (ledger.length > 100) ledger = ledger.slice(-100)
      break
    }
    case 'uniformBuyIn': {
      if (!isHost) return fail(ACK_REASONS.NOT_HOST)
      const amount = op.amount ?? 0
      if (!Number.isInteger(amount) || amount <= 0) {
        return fail(ACK_REASONS.POSITIVE_INT)
      }
      const prevBalances = seats.map((s) => ({
        seatId: s.seatId,
        balance: s.balance,
      }))
      // 开局清桌优先于锁定：locked seats also set to N (lock flag kept).
      for (const s of seats) {
        s.balance = amount
      }
      ledger.push({
        id: uid('led'),
        kind: 'uniformBuyIn',
        fromSeatId: op.fromSeatId,
        fromName: '',
        toSeatId: '',
        toName: '',
        amount,
        at: Date.now(),
        prevBalances,
      })
      if (ledger.length > 100) ledger = ledger.slice(-100)
      break
    }
    case 'potIn': {
      const amount = op.amount ?? 0
      if (!Number.isInteger(amount) || amount <= 0) {
        return fail(ACK_REASONS.POSITIVE_INT)
      }
      // Any seated player: deduct from own seat only.
      const sender = seats.find((s) => s.seatId === op.fromSeatId)
      if (!sender) return fail(ACK_REASONS.INVALID)
      if (sender.locked) return fail(ACK_REASONS.SEAT_LOCKED)
      if (sender.balance < amount) return fail(ACK_REASONS.INSUFFICIENT)
      sender.balance -= amount
      pot += amount
      ledger.push({
        id: uid('led'),
        kind: 'potIn',
        fromSeatId: sender.seatId,
        fromName: sender.name,
        toSeatId: '',
        toName: '锅',
        amount,
        at: Date.now(),
      })
      if (ledger.length > 100) ledger = ledger.slice(-100)
      break
    }
    case 'potOut': {
      if (!isHost) return fail(ACK_REASONS.NOT_HOST)
      const amount = op.amount ?? 0
      if (!Number.isInteger(amount) || amount <= 0) {
        return fail(ACK_REASONS.POSITIVE_INT)
      }
      if (!target) return fail(ACK_REASONS.INVALID)
      if (pot < amount) return fail(ACK_REASONS.POT_INSUFFICIENT)
      pot -= amount
      target.balance += amount
      ledger.push({
        id: uid('led'),
        kind: 'potOut',
        fromSeatId: '',
        fromName: '锅',
        toSeatId: target.seatId,
        toName: target.name,
        amount,
        at: Date.now(),
      })
      if (ledger.length > 100) ledger = ledger.slice(-100)
      break
    }
    case 'potSplit': {
      if (!isHost) return fail(ACK_REASONS.NOT_HOST)
      const amount = op.amount ?? 0
      if (!Number.isInteger(amount) || amount <= 0) {
        return fail(ACK_REASONS.POSITIVE_INT)
      }
      if (pot < amount) return fail(ACK_REASONS.POT_INSUFFICIENT)
      // 在座 = occupied (all table seats) AND not locked.
      const eligible = seats.filter((s) => !s.locked)
      if (eligible.length === 0) return fail(ACK_REASONS.INVALID)
      const share = Math.floor(amount / eligible.length)
      if (share < 1) return fail(ACK_REASONS.INVALID)
      const totalOut = share * eligible.length
      pot -= totalOut
      for (const s of eligible) {
        s.balance += share
      }
      const remainder = amount - totalOut
      ledger.push({
        id: uid('led'),
        kind: 'potSplit',
        fromSeatId: '',
        fromName: '锅',
        toSeatId: '',
        toName: '',
        amount: share,
        at: Date.now(),
        splitSeatIds: eligible.map((s) => s.seatId),
        splitRemainder: remainder,
      })
      if (ledger.length > 100) ledger = ledger.slice(-100)
      break
    }
    case 'undoLast': {
      if (!isHost) return fail(ACK_REASONS.NOT_HOST)
      const entry = findLastUndoable(ledger)
      if (!entry) return fail(ACK_REASONS.NOTHING_TO_UNDO)
      const summary = ledgerEntrySummary(entry)

      if (entry.kind === 'uniformBuyIn') {
        if (!entry.prevBalances || entry.prevBalances.length === 0) {
          return fail(ACK_REASONS.NOTHING_TO_UNDO)
        }
        const byId = new Map(
          entry.prevBalances.map((p) => [p.seatId, p.balance]),
        )
        for (const s of seats) {
          if (byId.has(s.seatId)) s.balance = byId.get(s.seatId)!
        }
      } else if (entry.kind === 'seatAdjust') {
        const seat = seats.find((s) => s.seatId === entry.fromSeatId)
        if (!seat) return fail(ACK_REASONS.NOTHING_TO_UNDO)
        const delta = entry.amount
        if (!Number.isInteger(delta) || delta === 0) {
          return fail(ACK_REASONS.NOTHING_TO_UNDO)
        }
        // Reverse signed delta (买码 +N → −N; 下分 −N → +N).
        seat.balance = Math.max(0, seat.balance - delta)
      } else if (entry.kind === 'potIn') {
        const seat = seats.find((s) => s.seatId === entry.fromSeatId)
        if (!seat) return fail(ACK_REASONS.NOTHING_TO_UNDO)
        const amt = entry.amount
        if (!Number.isInteger(amt) || amt <= 0) {
          return fail(ACK_REASONS.NOTHING_TO_UNDO)
        }
        pot = Math.max(0, pot - amt)
        seat.balance += amt
      } else if (entry.kind === 'potOut') {
        const seat = seats.find((s) => s.seatId === entry.toSeatId)
        if (!seat) return fail(ACK_REASONS.NOTHING_TO_UNDO)
        const amt = entry.amount
        if (!Number.isInteger(amt) || amt <= 0) {
          return fail(ACK_REASONS.NOTHING_TO_UNDO)
        }
        seat.balance = Math.max(0, seat.balance - amt)
        pot += amt
      } else if (entry.kind === 'potSplit') {
        const ids = entry.splitSeatIds ?? []
        const amt = entry.amount
        if (!Number.isInteger(amt) || amt <= 0 || ids.length === 0) {
          return fail(ACK_REASONS.NOTHING_TO_UNDO)
        }
        for (const sid of ids) {
          const seat = seats.find((s) => s.seatId === sid)
          if (!seat) return fail(ACK_REASONS.NOTHING_TO_UNDO)
          seat.balance = Math.max(0, seat.balance - amt)
        }
        pot += amt * ids.length
      } else {
        // transfer (or legacy omit kind): reverse one seat→seat row
        const sender = seats.find((s) => s.seatId === entry.fromSeatId)
        const receiver = seats.find((s) => s.seatId === entry.toSeatId)
        if (!sender || !receiver) return fail(ACK_REASONS.NOTHING_TO_UNDO)
        const amt = entry.amount
        if (!Number.isInteger(amt) || amt <= 0) {
          return fail(ACK_REASONS.NOTHING_TO_UNDO)
        }
        receiver.balance = Math.max(0, receiver.balance - amt)
        sender.balance += amt
      }

      ledger.push({
        id: uid('led'),
        kind: 'undo',
        fromSeatId: op.fromSeatId,
        fromName: summary,
        toSeatId: '',
        toName: '',
        amount: entry.amount,
        at: Date.now(),
        undoneId: entry.id,
      })
      if (ledger.length > 100) ledger = ledger.slice(-100)
      break
    }
    default:
      return fail(ACK_REASONS.INVALID)
  }

  const snapshotAt = Date.now()
  const data: PersistedRoom = {
    room: existing.room,
    table: {
      snapshotAt,
      denoms: existing.table.denoms,
      seats,
      pot,
      ledger,
    },
  }
  saveRoom(data)
  return {
    ack: { opId: op.opId, ok: true, snapshotAt },
    data,
  }
}

export function newOpId(): string {
  return uid('op')
}
