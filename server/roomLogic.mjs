/**
 * Host-authoritative room mutations for the shared relay.
 * Mirrors src/store/localRoom.ts + src/types (keep in sync).
 */

export const MIN_SEATS = 2
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
  SEATS_RANGE: '人数须为2–8',
  TABLE_PAUSED: '桌主已离开 · 桌子已暂停，请等待重开一桌或选新桌主',
  INSUFFICIENT: '余额不足',
  POT_INSUFFICIENT: '底池不足',
  SELF_TRANSFER: '不能转给自己',
  POSITIVE_INT: '请输入正整数',
  NOTHING_TO_UNDO: '没有可撤销的记录',
  TABLE_SETTLING: '结算中，请先返回桌面',
}

export function normalizeMaxSeats(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) return MAX_SEATS
  return n
}

export function tableFullReason(maxSeats = MAX_SEATS) {
  return `本桌已满（最多${normalizeMaxSeats(maxSeats)}人）`
}

function optionalPositiveInt(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: undefined }
  }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n <= 0) return { ok: false }
  return { ok: true, value: n }
}

/** Create-room body. Omitted buy-in → 0; omitted seats → 8. Invalid 1/9 / ≤0 rejected. */
export function parseRoomCreate(input = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const buyRaw = src.buyInN
  const buyMissing = buyRaw === undefined || buyRaw === null || buyRaw === ''
  let buyInN = 0
  if (!buyMissing) {
    const n = typeof buyRaw === 'number' ? buyRaw : Number(buyRaw)
    if (!Number.isInteger(n) || n <= 0) {
      return { error: ACK_REASONS.POSITIVE_INT }
    }
    buyInN = n
  }
  const seatsRaw = src.maxSeats
  const seatsMissing =
    seatsRaw === undefined || seatsRaw === null || seatsRaw === ''
  let maxSeats = MAX_SEATS
  if (!seatsMissing) {
    const n = typeof seatsRaw === 'number' ? seatsRaw : Number(seatsRaw)
    if (!Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) {
      return { error: ACK_REASONS.SEATS_RANGE }
    }
    maxSeats = n
  }
  const small = optionalPositiveInt(src.smallBlind)
  if (!small.ok) return { error: ACK_REASONS.POSITIVE_INT }
  const big = optionalPositiveInt(src.bigBlind)
  if (!big.ok) return { error: ACK_REASONS.POSITIVE_INT }
  const seatId =
    typeof src.seatId === 'string' && src.seatId ? src.seatId : undefined
  return {
    ok: true,
    buyInN,
    maxSeats,
    smallBlind: small.value,
    bigBlind: big.value,
    seatId,
  }
}

/** Body carries a real create snapshot, not omitted defaults (buyIn 0 / seats 8). */
export function hasCreateSnapshot(parsed) {
  if (!parsed || !parsed.ok) return false
  return (
    parsed.buyInN > 0 ||
    parsed.maxSeats !== MAX_SEATS ||
    parsed.smallBlind != null ||
    parsed.bigBlind != null
  )
}

/**
 * Overlay create-room snapshot onto room when `input` includes it.
 * Repairs rooms whose POST /rooms dropped buyInN / maxSeats / blinds.
 */
export function stampCreateSettings(room, input) {
  if (!input || typeof input !== 'object') return room
  const parsed = parseRoomCreate(input)
  if (!hasCreateSnapshot(parsed)) return room
  return {
    ...room,
    buyInN: parsed.buyInN,
    maxSeats: parsed.maxSeats,
    smallBlind: parsed.smallBlind,
    bigBlind: parsed.bigBlind,
  }
}

export function ledgerEntrySummary(entry) {
  // Locked copy: `{谁} → {谁} · 转 {n}` / `全员买入 {n}` / `进底池 {n}` /
  // `出底池 {n}` / `均分底池` / `{谁} 席位±{n}` / `撤销：{原摘要}`
  if (entry.kind === 'uniformBuyIn') return `全员买入 ${entry.amount}`
  if (entry.kind === 'undo') {
    return entry.fromName ? `撤销：${entry.fromName}` : '撤销'
  }
  if (entry.kind === 'seatAdjust') {
    const n = entry.amount
    return `${entry.fromName} 席位${n > 0 ? '+' : ''}${n}`
  }
  if (entry.kind === 'potIn') return `进底池 ${entry.amount}`
  if (entry.kind === 'potOut') return `出底池 ${entry.amount}`
  if (entry.kind === 'potSplit') return '均分底池'
  return `${entry.fromName} → ${entry.toName} · 转 ${entry.amount}`
}

export function potSplitSummary(k, m, r) {
  return `底池均分 · 在座${k}人 · 各 +${m} · 余${r}留底池`
}

export function findLastUndoable(ledger) {
  const undone = new Set()
  for (const e of ledger) {
    if (e.kind === 'undo' && e.undoneId) undone.add(e.undoneId)
  }
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i]
    if (e.kind === 'undo') continue
    if (undone.has(e.id)) continue
    return e
  }
  return null
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

function normalizePot(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function normalizeBuyIn(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

function normalizeSeat(s) {
  return { ...s, buyIn: normalizeBuyIn(s.buyIn) }
}

function applyPlusBuyIn(seat, actual) {
  if (actual > 0) seat.buyIn = normalizeBuyIn(seat.buyIn) + actual
}

function undoPlusBuyIn(seat, delta) {
  if (delta > 0) seat.buyIn = Math.max(0, normalizeBuyIn(seat.buyIn) - delta)
}

function normalize(data) {
  const maxSeats = normalizeMaxSeats(data.room.maxSeats)
  const buyInN = normalizeBuyIn(data.room.buyInN)
  const smallBlind = optionalPositiveInt(data.room.smallBlind).ok
    ? optionalPositiveInt(data.room.smallBlind).value
    : undefined
  const bigBlind = optionalPositiveInt(data.room.bigBlind).ok
    ? optionalPositiveInt(data.room.bigBlind).value
    : undefined
  return {
    ...data,
    room: {
      ...data.room,
      roomCode: data.room.roomCode.toUpperCase(),
      maxSeats,
      buyInN,
      smallBlind,
      bigBlind,
      members: data.room.members.slice(0, maxSeats),
    },
    table: {
      ...data.table,
      seats: data.table.seats.slice(0, maxSeats).map(normalizeSeat),
      pot: normalizePot(data.table.pot),
      ledger: Array.isArray(data.table.ledger) ? data.table.ledger : [],
      settling: !!data.table.settling,
    },
  }
}

function nextSnapshotAt(existing) {
  return Math.max((existing.table.snapshotAt ?? 0) + 1, Date.now())
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

  function createEmptyHostRoom(input) {
    sweep()
    const src = typeof input === 'string' ? { seatId: input } : input || {}
    const parsed = parseRoomCreate(src)
    if (parsed.error) return { error: parsed.error }
    const roomCode = generateRoomCode(rooms)
    const seatId = parsed.seatId || uid('seat')
    const now = Date.now()
    const data = set({
      room: {
        roomCode,
        hostSeatId: seatId,
        phase: 'lobby',
        maxSeats: parsed.maxSeats,
        buyInN: parsed.buyInN,
        smallBlind: parsed.smallBlind,
        bigBlind: parsed.bigBlind,
        members: [],
      },
      table: {
        snapshotAt: now,
        denoms: [...DEFAULT_DENOMS],
        seats: [],
        pot: 0,
        ledger: [],
        settling: false,
      },
    })
    return {
      session: { seatId, name: '', roomCode },
      data,
    }
  }

  function claimHostSeat(roomCode, seatId, name, settings) {
    const existing = get(roomCode)
    if (!existing) return null
    if (existing.room.hostSeatId !== seatId) return null
    const room = stampCreateSettings(existing.room, settings)

    const already = room.members.find((m) => m.seatId === seatId)
    if (already) {
      const members = room.members.map((m) =>
        m.seatId === seatId ? { ...m, name, isHost: true, connected: true } : m,
      )
      const seats = existing.table.seats.map((s) =>
        s.seatId === seatId ? { ...s, name, isHost: true } : s,
      )
      return set({
        room: { ...room, members },
        table: { ...existing.table, seats, snapshotAt: nextSnapshotAt(existing) },
      })
    }

    if (room.members.length >= normalizeMaxSeats(room.maxSeats)) {
      return null
    }

    return set({
      room: {
        ...room,
        hostSeatId: seatId,
        members: [
          { seatId, name, isHost: true, connected: true },
          ...room.members.map((m) => ({ ...m, isHost: false })),
        ],
      },
      table: {
        snapshotAt: nextSnapshotAt(existing),
        denoms: existing.table.denoms,
        seats: [
          { seatId, name, isHost: true, locked: false, balance: 0, buyIn: 0 },
          ...existing.table.seats.map((s) => ({ ...s, isHost: false })),
        ],
        // Same host TableSnapshot as seats — never drop pot/ledger on rebuild.
        pot: normalizePot(existing.table.pot),
        ledger: Array.isArray(existing.table.ledger)
          ? existing.table.ledger
          : [],
        settling: !!existing.table.settling,
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
    const cap = normalizeMaxSeats(existing.room.maxSeats)
    if (existing.room.members.length >= cap) {
      return { error: tableFullReason(cap) }
    }
    const seatId = uid('seat')
    const data = set({
      room: {
        ...existing.room,
        members: [
          ...existing.room.members,
          { seatId, name, isHost: false, connected: true },
        ],
      },
      table: {
        ...existing.table,
        snapshotAt: nextSnapshotAt(existing),
        seats: [
          ...existing.table.seats,
          { seatId, name, isHost: false, locked: false, balance: 0, buyIn: 0 },
        ],
      },
    })
    return { session: { seatId, name, roomCode: code }, data }
  }

  function fillSeatsToMax(roomCode) {
    const existing = get(roomCode)
    if (!existing) return { error: ACK_REASONS.ROOM_MISSING }
    const cap = normalizeMaxSeats(existing.room.maxSeats)
    const members = [...existing.room.members]
    const seats = [...existing.table.seats]
    let n = 1
    while (members.length < cap) {
      const seatId = uid('seat')
      const name = `座位${n++}`
      members.push({ seatId, name, isHost: false, connected: true })
      seats.push({
        seatId,
        name,
        isHost: false,
        locked: false,
        balance: 0,
        buyIn: 0,
      })
    }
    return set({
      room: { ...existing.room, members },
      table: { ...existing.table, seats, snapshotAt: nextSnapshotAt(existing) },
    })
  }

  function setPhase(roomCode, phase, settings) {
    const existing = get(roomCode)
    if (!existing) return null
    const snapshotAt = nextSnapshotAt(existing)
    return set({
      ...existing,
      room: { ...stampCreateSettings(existing.room, settings), phase },
      table: { ...existing.table, snapshotAt },
    })
  }

  function setMemberConnected(roomCode, seatId, connected) {
    const existing = get(roomCode)
    if (!existing) return null
    const members = existing.room.members.map((m) =>
      m.seatId === seatId ? { ...m, connected } : m,
    )
    return set({
      room: { ...existing.room, members },
      table: { ...existing.table, snapshotAt: nextSnapshotAt(existing) },
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
      },
      table: { ...existing.table, seats, snapshotAt: nextSnapshotAt(existing) },
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
    let pot = normalizePot(existing.table.pot)
    let settling = !!existing.table.settling

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
      settling &&
      op.type !== 'openSettlement' &&
      op.type !== 'closeSettlement'
    ) {
      return fail(ACK_REASONS.TABLE_SETTLING)
    }

    if (
      !target &&
      op.type !== 'resetTable' &&
      op.type !== 'transfer' &&
      op.type !== 'uniformBuyIn' &&
      op.type !== 'potIn' &&
      op.type !== 'potOut' &&
      op.type !== 'potSplit' &&
      op.type !== 'undoLast' &&
      op.type !== 'openSettlement' &&
      op.type !== 'closeSettlement'
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
          applyPlusBuyIn(target, actual)
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
          applyPlusBuyIn(target, actual)
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
        const prevBalances = seats.map((s) => ({
          seatId: s.seatId,
          balance: s.balance,
          buyIn: normalizeBuyIn(s.buyIn),
        }))
        // 开局清桌优先于锁定：locked seats also set to N (lock flag kept).
        for (const s of seats) {
          s.balance = amount
          s.buyIn = amount
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
        // Coerce in case JSON/transport delivered amount as numeric string.
        const amount = Number(op.amount)
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
          toName: '底池',
          amount,
          at: Date.now(),
        })
        if (ledger.length > 100) ledger = ledger.slice(-100)
        break
      }
      case 'potOut': {
        if (!isHost) return fail(ACK_REASONS.NOT_HOST)
        const amount = Number(op.amount)
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
          fromName: '底池',
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
        const amount = Number(op.amount)
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
          fromName: '底池',
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
          const byId = new Map(entry.prevBalances.map((p) => [p.seatId, p]))
          for (const s of seats) {
            const prev = byId.get(s.seatId)
            if (!prev) continue
            s.balance = prev.balance
            if (typeof prev.buyIn === 'number') s.buyIn = normalizeBuyIn(prev.buyIn)
          }
        } else if (entry.kind === 'seatAdjust') {
          const seat = seats.find((s) => s.seatId === entry.fromSeatId)
          if (!seat) return fail(ACK_REASONS.NOTHING_TO_UNDO)
          const delta = entry.amount
          if (!Number.isInteger(delta) || delta === 0) {
            return fail(ACK_REASONS.NOTHING_TO_UNDO)
          }
          seat.balance = Math.max(0, seat.balance - delta)
          undoPlusBuyIn(seat, delta)
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
      case 'openSettlement': {
        if (!isHost) return fail(ACK_REASONS.NOT_HOST)
        settling = true
        break
      }
      case 'closeSettlement': {
        if (!isHost) return fail(ACK_REASONS.NOT_HOST)
        settling = false
        break
      }
      default:
        return fail(ACK_REASONS.INVALID)
    }

    const snapshotAt = nextSnapshotAt(existing)
    const data = set({
      room: existing.room,
      table: {
        snapshotAt,
        denoms: existing.table.denoms,
        seats,
        pot,
        ledger,
        settling,
      },
    })
    return { ack: { opId: op.opId, ok: true, snapshotAt }, data }
  }

  /** Full dump for disk persistence (code → { data, touchedAt }). */
  function exportAll() {
    /** @type {Record<string, { data: object, touchedAt: number }>} */
    const out = {}
    for (const [key, entry] of rooms) {
      out[key] = { data: entry.data, touchedAt: entry.touchedAt }
    }
    return out
  }

  /** Hydrate from disk after process restart. */
  function importAll(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return 0
    let n = 0
    for (const [key, entry] of Object.entries(snapshot)) {
      if (!entry?.data?.room?.roomCode) continue
      const code = String(key).toUpperCase()
      rooms.set(code, {
        data: normalize(entry.data),
        touchedAt:
          typeof entry.touchedAt === 'number' ? entry.touchedAt : Date.now(),
      })
      n += 1
    }
    return n
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
    exportAll,
    importAll,
    size: () => rooms.size,
  }
}
