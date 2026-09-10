/**
 * Host-authoritative room mutations for the shared relay.
 * Mirrors src/store/localRoom.ts + src/types (keep in sync).
 */

export const MAX_SEATS = 8
export const DEFAULT_DENOMS = [1, 5, 10, 25, 100]
export const ACK_REASONS = {
  SEAT_LOCKED: '席位已锁定',
  NOT_HOST: '仅桌主可执行此操作',
  OFFLINE: '以桌主为准',
  TIMEOUT: '以桌主为准',
  ROLLBACK: '操作未生效，已回滚',
  INVALID: '操作无效',
  ROOM_MISSING: '房间不存在或已解散',
  ROOM_CODE_INVALID: '房码无效',
  TABLE_FULL: '本桌已满（最多8人）',
  TABLE_PAUSED: '桌主已离开 · 桌子已暂停，请等待重开一桌或选新桌主',
  INSUFFICIENT: '余额不足',
  SELF_TRANSFER: '不能转给自己',
  POSITIVE_INT: '请输入正整数',
}

const ROOM_TTL_MS = 4 * 60 * 60 * 1000 // 4h idle → drop

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function generateRoomCode(existing) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 40; attempt++) {
    let code = ''
    for (let i = 0; i < 4; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    if (!existing.has(code)) return code
  }
  // Extremely unlikely fallback
  return `X${Date.now().toString(36).toUpperCase().slice(-3)}`
}

function normalize(data) {
  return {
    ...data,
    room: {
      ...data.room,
      roomCode: data.room.roomCode.toUpperCase(),
      maxSeats: MAX_SEATS,
      members: data.room.members.slice(0, MAX_SEATS),
    },
    table: {
      ...data.table,
      seats: data.table.seats.slice(0, MAX_SEATS),
      ledger: Array.isArray(data.table.ledger) ? data.table.ledger : [],
    },
  }
}

export function createRoomStore() {
  /** @type {Map<string, { data: object, touchedAt: number }>} */
  const rooms = new Map()

  function touch(code) {
    const entry = rooms.get(code)
    if (entry) entry.touchedAt = Date.now()
  }

  function get(code) {
    const key = code.toUpperCase()
    const entry = rooms.get(key)
    if (!entry) return null
    touch(key)
    return entry.data
  }

  function set(data) {
    const normalized = normalize(data)
    const key = normalized.room.roomCode.toUpperCase()
    rooms.set(key, { data: normalized, touchedAt: Date.now() })
    return normalized
  }

  function del(code) {
    rooms.delete(code.toUpperCase())
  }

  function sweep() {
    const now = Date.now()
    for (const [key, entry] of rooms) {
      if (now - entry.touchedAt > ROOM_TTL_MS) rooms.delete(key)
    }
  }

  function createEmptyHostRoom(preferredSeatId) {
    sweep()
    const roomCode = generateRoomCode(rooms)
    const seatId = preferredSeatId || uid('seat')
    const now = Date.now()
    const data = set({
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
        ledger: [],
      },
    })
    return {
      session: { seatId, name: '', roomCode },
      data,
    }
  }

  function claimHostSeat(roomCode, seatId, name) {
    const existing = get(roomCode)
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
      return set({
        room: { ...existing.room, members, maxSeats: MAX_SEATS },
        table: { ...existing.table, seats, snapshotAt: Date.now() },
      })
    }

    if (existing.room.members.length >= MAX_SEATS) return null

    return set({
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
      },
    })
  }

  function joinRoom(roomCode, name) {
    const code = roomCode.trim().toUpperCase()
    if (!code || !/^[A-Z0-9]+$/.test(code)) {
      return { error: ACK_REASONS.ROOM_CODE_INVALID }
    }
    const existing = get(code)
    if (!existing) return { error: ACK_REASONS.ROOM_MISSING }
    if (existing.room.members.length >= MAX_SEATS) {
      return { error: ACK_REASONS.TABLE_FULL }
    }
    const seatId = uid('seat')
    const data = set({
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
    })
    return { session: { seatId, name, roomCode: code }, data }
  }

  function fillSeatsToMax(roomCode) {
    const existing = get(roomCode)
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
    return set({
      room: { ...existing.room, members, maxSeats: MAX_SEATS },
      table: { ...existing.table, seats, snapshotAt: Date.now() },
    })
  }

  function setPhase(roomCode, phase) {
    const existing = get(roomCode)
    if (!existing) return null
    return set({
      ...existing,
      room: { ...existing.room, phase, maxSeats: MAX_SEATS },
      table: { ...existing.table, snapshotAt: Date.now() },
    })
  }

  function setMemberConnected(roomCode, seatId, connected) {
    const existing = get(roomCode)
    if (!existing) return null
    const members = existing.room.members.map((m) =>
      m.seatId === seatId ? { ...m, connected } : m,
    )
    return set({
      room: { ...existing.room, members, maxSeats: MAX_SEATS },
      table: { ...existing.table, snapshotAt: Date.now() },
    })
  }

  function pickNewHost(roomCode, newHostSeatId) {
    const existing = get(roomCode)
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
    return set({
      room: {
        ...existing.room,
        hostSeatId: newHostSeatId,
        members,
        phase: 'playing',
        maxSeats: MAX_SEATS,
      },
      table: { ...existing.table, seats, snapshotAt: Date.now() },
    })
  }

  function resumeAsHost(roomCode, hostSeatId) {
    const existing = get(roomCode)
    if (!existing) return null
    if (existing.room.hostSeatId !== hostSeatId) return null
    return setPhase(roomCode, 'playing')
  }

  function restoreSeat(roomCode, seatId) {
    const existing = get(roomCode)
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

  function applyChipOp(op) {
    const existing = get(op.roomCode)
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

    const fail = (reason) => ({
      ack: {
        opId: op.opId,
        ok: false,
        reason,
        snapshotAt: existing.table.snapshotAt,
      },
      data: existing,
    })

    if (
      !target &&
      op.type !== 'resetTable' &&
      op.type !== 'transfer' &&
      op.type !== 'uniformBuyIn'
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
      case 'transfer': {
        const amount = op.amount ?? 0
        if (!Number.isInteger(amount) || amount <= 0) {
          return fail(ACK_REASONS.INVALID)
        }

        const rawIds =
          op.targetSeatIds && op.targetSeatIds.length > 0
            ? op.targetSeatIds
            : [op.targetSeatId]
        const seen = new Set()
        const targetIds = []
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
        if (ledger.length > 100) ledger = ledger.slice(-100)
        break
      }
      case 'uniformBuyIn': {
        if (!isHost) return fail(ACK_REASONS.NOT_HOST)
        const amount = op.amount ?? 0
        if (!Number.isInteger(amount) || amount <= 0) {
          return fail(ACK_REASONS.POSITIVE_INT)
        }
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
        })
        if (ledger.length > 100) ledger = ledger.slice(-100)
        break
      }
      default:
        return fail(ACK_REASONS.INVALID)
    }

    const snapshotAt = Date.now()
    const data = set({
      room: existing.room,
      table: {
        snapshotAt,
        denoms: existing.table.denoms,
        seats,
        ledger,
      },
    })
    return { ack: { opId: op.opId, ok: true, snapshotAt }, data }
  }

  return {
    get,
    set,
    del,
    createEmptyHostRoom,
    claimHostSeat,
    joinRoom,
    fillSeatsToMax,
    setPhase,
    setMemberConnected,
    pickNewHost,
    resumeAsHost,
    restoreSeat,
    applyChipOp,
    sweep,
    size: () => rooms.size,
  }
}
