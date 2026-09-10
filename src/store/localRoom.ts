import {
  ACK_REASONS,
  DEFAULT_DENOMS,
  MAX_SEATS,
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

/** Silent restore: seatId still in room → mark connected, return snapshot. */
export function restoreSeat(
  roomCode: string,
  seatId: string,
): PersistedRoom | null {
  const existing = loadRoom(roomCode)
  if (!existing) return null
  if (!existing.room.members.some((m) => m.seatId === seatId)) return null
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
  if (existing.room.members.length > 0) return null
  const data: PersistedRoom = {
    room: {
      ...existing.room,
      hostSeatId: seatId,
      maxSeats: MAX_SEATS,
      members: [{ seatId, name, isHost: true, connected: true }],
    },
    table: {
      snapshotAt: Date.now(),
      denoms: existing.table.denoms,
      seats: [{ seatId, name, isHost: true, locked: false, balance: 0 }],
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

  // No seat restore this week — always allocate a new seatId (same nick OK).
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

  // Host disconnect while playing → pause. Never auto-transfer host.
  // Host reconnect does NOT auto-resume — keep paused until「重开牌桌」.
  let phase = existing.room.phase
  const isHost = seatId === existing.room.hostSeatId
  if (isHost && !connected && phase === 'playing') {
    phase = 'paused'
  }

  const data: PersistedRoom = {
    room: {
      ...existing.room,
      members,
      phase,
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

  const fail = (reason: string) => ({
    ack: {
      opId: op.opId,
      ok: false,
      reason,
      snapshotAt: existing.table.snapshotAt,
    } satisfies ChipAck,
    data: existing,
  })

  if (!target && op.type !== 'resetTable') {
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
      const delta = op.type === '+denom' ? denom : -denom
      target.balance = Math.max(0, target.balance + delta)
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
      const delta = op.type === '+batch' ? amount : -amount
      target.balance = Math.max(0, target.balance + delta)
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
