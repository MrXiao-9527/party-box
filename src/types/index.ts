/** Shared types for party-box — keep in sync across UI and transport. */

export type Phase = 'lobby' | 'playing' | 'paused'

export type ChipOpType =
  | '+denom'
  | '-denom'
  | '+batch'
  | '-batch'
  | 'set'
  | 'resetSeat'
  | 'resetTable'
  | 'lock'
  | 'unlock'
  | 'transfer'
  | 'uniformBuyIn'
  | 'potIn'
  | 'potOut'
  | 'potSplit'
  | 'undoLast'
  | 'openSettlement'
  | 'closeSettlement'

/** Ledger row kind — omit / transfer = seat→seat; seatAdjust = 本席加减; pot*; uniformBuyIn / undo. */
export type LedgerKind =
  | 'transfer'
  | 'seatAdjust'
  | 'uniformBuyIn'
  | 'potIn'
  | 'potOut'
  | 'potSplit'
  | 'undo'

/** Successful chip ledger row — failed attempts never appear. */
export interface LedgerEntry {
  id: string
  /** Default transfer when omitted (older snapshots). */
  kind?: LedgerKind
  fromSeatId: string
  fromName: string
  toSeatId: string
  toName: string
  /**
   * transfer / uniformBuyIn / potIn / potOut: positive amount.
   * potSplit: per-person floor share.
   * seatAdjust: signed delta (买码 +, 下分 −).
   */
  amount: number
  at: number
  /** uniformBuyIn: balances + 累计买入 before set — required to reverse on undo. */
  prevBalances?: { seatId: string; balance: number; buyIn?: number }[]
  /** potSplit: seats that received the floor share (for undo). */
  splitSeatIds?: string[]
  /** potSplit: remainder kept in pot after floor divide (N − M×K). */
  splitRemainder?: number
  /** undo rows: id of the ledger entry this undo reversed. */
  undoneId?: string
}

export interface Seat {
  seatId: string
  name: string
  isSelf: boolean
  isHost: boolean
  locked: boolean
  balance: number
  /** Cumulative buy-in (authoritative). Older snapshots → 0. */
  buyIn: number
}

export interface RoomMember {
  seatId: string
  name: string
  isHost: boolean
  connected: boolean
}

export interface RoomState {
  roomCode: string
  hostSeatId: string
  members: RoomMember[]
  phase: Phase
  /** Seat cap set at creation — integer 2–8 (default 8). */
  maxSeats: number
  /**
   * Buy-in N set at room creation (display + 全员买入 default).
   * 0 = unset (legacy rooms).
   */
  buyInN: number
  /** Display-only blinds; omit when unset. Never auto-deducted. */
  smallBlind?: number
  bigBlind?: number
}

/** POST /rooms + create-room form. */
export type RoomCreateInput = {
  seatId?: string
  buyInN?: number | string
  maxSeats?: number | string
  smallBlind?: number | string
  bigBlind?: number | string
}

export interface ChipOp {
  opId: string
  roomCode: string
  fromSeatId: string
  /** Primary / first target (required shape). Transfer may list more via targetSeatIds. */
  targetSeatId: string
  type: ChipOpType
  denom?: number
  /** Transfer / uniformBuyIn / potIn / potOut / potSplit: positive integer amount. */
  amount?: number
  /** Transfer one-to-many targets. If omitted, [targetSeatId]. */
  targetSeatIds?: string[]
}

/** Human summary of a ledger row (preview / 流水 / 撤销：原摘要).
 * Locked copy: `{谁} → {谁} · 转 {n}` / `全员买入 {n}` / `进底池 {n}` /
 * `出底池 {n}` / `均分底池` / `{谁} 席位±{n}` / `撤销：{原摘要}`.
 */
export function ledgerEntrySummary(entry: LedgerEntry): string {
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

/** Locked pot-split confirm preview (dialog only; ledger line is `均分底池`). */
export function potSplitSummary(k: number, m: number, r: number): string {
  return `底池均分 · 在座${k}人 · 各 +${m} · 余${r}留底池`
}

/** Newest successful settle that has not yet been undone (skips undo rows). */
export function findLastUndoable(
  ledger: LedgerEntry[],
): LedgerEntry | null {
  const undone = new Set<string>()
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

export interface ChipAck {
  opId: string
  ok: boolean
  reason?: string
  snapshotAt?: number
}

export interface SnapshotSeat {
  seatId: string
  name: string
  isHost: boolean
  locked: boolean
  balance: number
  /** Cumulative buy-in (authoritative). Older snapshots → 0. */
  buyIn: number
}

export interface TableSnapshot {
  snapshotAt: number
  seats: SnapshotSeat[]
  denoms: number[]
  /** Independent public pot balance (not a seat field). Older snapshots → 0. */
  pot: number
  /** In-table ledger (settles: seat ±, transfers, pot, buy-in, undos). */
  ledger: LedgerEntry[]
  /** Host opened 结算 page. Shared so guests see the same numbers. */
  settling?: boolean
}

export const MIN_SEATS = 2
export const MAX_SEATS = 8
export const DEFAULT_DENOMS = [1, 5, 10, 25, 100] as const

/** Locked QR / copy-link origin — never window origin, never trycloudflare. */
export const JOIN_ORIGIN = 'https://party-box-43z.pages.dev'

export function roomJoinUrl(roomCode: string): string {
  const code = roomCode.trim().toUpperCase()
  return `${JOIN_ORIGIN}/r/${code}`
}

export function normalizeMaxSeats(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) return MAX_SEATS
  return n
}

export function tableFullReason(maxSeats: unknown = MAX_SEATS): string {
  return `本桌已满（最多${normalizeMaxSeats(maxSeats)}人）`
}

/** Human Chinese fail copy only — no tech error codes. */
export const ACK_REASONS = {
  SEAT_LOCKED: '席位已锁定',
  NOT_HOST: '仅桌主可执行此操作',
  OFFLINE: '以桌主为准',
  TIMEOUT: '以桌主为准',
  ROLLBACK: '操作未生效，已回滚',
  INVALID: '操作无效',
  ROOM_MISSING: '房间不存在或已解散',
  /** Was-in-room + relay 404 / wipe — locked QA copy (no zombie lobby). */
  RELAY_RESTARTED: '房间服务已重启，请重新开桌',
  RELAY_UNREACHABLE: '连不上房间服务，请重试',
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
} as const

/** A-Z / 0-9 only, always UPPERCASE. */
export function parseRoomCode(
  raw: string,
): { ok: true; code: string } | { ok: false; reason: string } {
  const code = raw.trim().toUpperCase()
  if (!code || !/^[A-Z0-9]+$/.test(code)) {
    return { ok: false, reason: ACK_REASONS.ROOM_CODE_INVALID }
  }
  return { ok: true, code }
}

function optionalPositiveInt(
  raw: unknown,
): { ok: true; value?: number } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: undefined }
  }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n <= 0) return { ok: false }
  return { ok: true, value: n }
}

/**
 * Create-room fields.
 * `strictBuyIn`: empty buy-in is an error (UI form). Relay may omit → buyInN 0.
 * Seats omitted → 8. Seats 1 / 9 / non-int → SEATS_RANGE.
 */
export function parseRoomCreate(
  input: RoomCreateInput | null | undefined,
  opts?: { strictBuyIn?: boolean },
):
  | {
      ok: true
      buyInN: number
      maxSeats: number
      smallBlind?: number
      bigBlind?: number
      seatId?: string
    }
  | { ok: false; error: string } {
  const src = input && typeof input === 'object' ? input : {}
  const buyRaw = src.buyInN
  const buyMissing = buyRaw === undefined || buyRaw === null || buyRaw === ''
  let buyInN = 0
  if (!buyMissing) {
    const n = typeof buyRaw === 'number' ? buyRaw : Number(buyRaw)
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, error: ACK_REASONS.POSITIVE_INT }
    }
    buyInN = n
  } else if (opts?.strictBuyIn) {
    return { ok: false, error: ACK_REASONS.POSITIVE_INT }
  }

  const seatsRaw = src.maxSeats
  const seatsMissing =
    seatsRaw === undefined || seatsRaw === null || seatsRaw === ''
  let maxSeats = MAX_SEATS
  if (!seatsMissing) {
    const n = typeof seatsRaw === 'number' ? seatsRaw : Number(seatsRaw)
    if (!Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) {
      return { ok: false, error: ACK_REASONS.SEATS_RANGE }
    }
    maxSeats = n
  }

  const small = optionalPositiveInt(src.smallBlind)
  if (!small.ok) return { ok: false, error: ACK_REASONS.POSITIVE_INT }
  const big = optionalPositiveInt(src.bigBlind)
  if (!big.ok) return { ok: false, error: ACK_REASONS.POSITIVE_INT }

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
export function hasCreateSnapshot(
  parsed:
    | {
        ok: true
        buyInN: number
        maxSeats: number
        smallBlind?: number
        bigBlind?: number
      }
    | { ok: false; error: string },
): parsed is {
  ok: true
  buyInN: number
  maxSeats: number
  smallBlind?: number
  bigBlind?: number
} {
  if (!parsed.ok) return false
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
export function stampCreateSettings<
  T extends Pick<RoomState, 'buyInN' | 'maxSeats' | 'smallBlind' | 'bigBlind'>,
>(room: T, input: RoomCreateInput | null | undefined): T {
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

function filledPositiveInt(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n <= 0) return undefined
  return n
}

/**
 * Read-only 「桌面设置」 after 开桌.
 * 买入 / 人数 always shown. 小盲 / 大盲 only when filled at create — never 「—」.
 */
export function tableSettingsView(
  room: Pick<RoomState, 'buyInN' | 'maxSeats' | 'smallBlind' | 'bigBlind'>,
): {
  buyInN: number
  maxSeats: number
  smallBlind?: number
  bigBlind?: number
} {
  const buyRaw = typeof room.buyInN === 'number' ? room.buyInN : Number(room.buyInN)
  const view: {
    buyInN: number
    maxSeats: number
    smallBlind?: number
    bigBlind?: number
  } = {
    buyInN: Number.isFinite(buyRaw) ? buyRaw : 0,
    maxSeats: room.maxSeats,
  }
  const sb = filledPositiveInt(room.smallBlind)
  const bb = filledPositiveInt(room.bigBlind)
  if (sb != null) view.smallBlind = sb
  if (bb != null) view.bigBlind = bb
  return view
}
