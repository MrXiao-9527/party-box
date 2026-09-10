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

/** Ledger row kind — omit / transfer = seat→seat; uniformBuyIn = summary. */
export type LedgerKind = 'transfer' | 'uniformBuyIn'

/** Successful chip ledger row — failed attempts never appear. */
export interface LedgerEntry {
  id: string
  /** Default transfer when omitted (older snapshots). */
  kind?: LedgerKind
  fromSeatId: string
  fromName: string
  toSeatId: string
  toName: string
  amount: number
  at: number
}

export interface Seat {
  seatId: string
  name: string
  isSelf: boolean
  isHost: boolean
  locked: boolean
  balance: number
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
  /** Hard cap — always 8 in this MVP. */
  maxSeats: number
}

export interface ChipOp {
  opId: string
  roomCode: string
  fromSeatId: string
  /** Primary / first target (required shape). Transfer may list more via targetSeatIds. */
  targetSeatId: string
  type: ChipOpType
  denom?: number
  /** Transfer / uniformBuyIn: positive integer amount. */
  amount?: number
  /** Transfer one-to-many targets. If omitted, [targetSeatId]. */
  targetSeatIds?: string[]
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
}

export interface TableSnapshot {
  snapshotAt: number
  seats: SnapshotSeat[]
  denoms: number[]
  /** In-table ledger (successful settles only: transfers + uniform buy-in). */
  ledger: LedgerEntry[]
}

export const MAX_SEATS = 8
export const DEFAULT_DENOMS = [1, 5, 10, 25, 100] as const

/** Human Chinese fail copy only — no tech error codes. */
export const ACK_REASONS = {
  SEAT_LOCKED: '席位已锁定',
  NOT_HOST: '仅桌主可执行此操作',
  OFFLINE: '以桌主为准',
  TIMEOUT: '以桌主为准',
  ROLLBACK: '操作未生效，已回滚',
  INVALID: '操作无效',
  ROOM_MISSING: '房间不存在或已解散',
  RELAY_UNREACHABLE: '连不上房间服务，请重试',
  ROOM_CODE_INVALID: '房码无效',
  TABLE_FULL: '本桌已满（最多8人）',
  TABLE_PAUSED: '桌主已离开 · 桌子已暂停，请等待重开一桌或选新桌主',
  INSUFFICIENT: '余额不足',
  SELF_TRANSFER: '不能转给自己',
  POSITIVE_INT: '请输入正整数',
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
