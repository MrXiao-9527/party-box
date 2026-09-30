/** Werewolf-deal roles — self-authored copy. Keep in sync with server/werewolfDeal.mjs. */

export const WEREWOLF_GAME_ID = 'werewolf-deal' as const

export type WerewolfRoleId =
  | 'werewolf'
  | 'villager'
  | 'seer'
  | 'witch'
  | 'hunter'
  | 'guard'

export type WerewolfCamp = 'wolf' | 'good'
export type WerewolfPhase = 'lobby' | 'dealt'
export type WerewolfStage = 'idle' | 'night' | 'day' | 'vote'

export const ROLE_IDS: WerewolfRoleId[] = [
  'werewolf',
  'villager',
  'seer',
  'witch',
  'hunter',
  'guard',
]

export const ROLE_META: Record<
  WerewolfRoleId,
  { label: string; camp: WerewolfCamp; blurb: string }
> = {
  werewolf: {
    label: '狼人',
    camp: 'wolf',
    blurb: '夜间与狼队一起行动（线下）',
  },
  villager: {
    label: '平民',
    camp: 'good',
    blurb: '没有技能，靠发言和投票找出狼人',
  },
  seer: {
    label: '预言家',
    camp: 'good',
    blurb: '夜间查验一名玩家的阵营（线下）',
  },
  witch: {
    label: '女巫',
    camp: 'good',
    blurb: '解药和毒药各一瓶，夜间使用（线下）',
  },
  hunter: {
    label: '猎人',
    camp: 'good',
    blurb: '出局时可开枪带走一人（线下）',
  },
  guard: {
    label: '守卫',
    camp: 'good',
    blurb: '夜间守护一名玩家（线下）',
  },
}

export const STAGE_COPY: Record<WerewolfStage, string> = {
  idle: '未开始',
  night: '天黑了',
  day: '白天了',
  vote: '开始投票',
}

export const CAMP_LABEL: Record<WerewolfCamp, string> = {
  wolf: '狼',
  good: '好人',
}

export const WW_ACK = {
  BOARD_MISMATCH: '人数与板子对不上',
  NO_WOLF: '狼人不能为 0',
  NO_GOOD: '好人不能为 0',
  BOARD_LOCKED: '发牌后不能改角色数量',
  NEED_TWO_SEATED: '至少 2 人入座才能发牌',
  SEATS_RANGE: '人数须为2–10',
  NOT_DEALT: '发牌后才能切换阶段',
  NOT_IN_LOBBY: '未发牌时才能改板',
} as const

export const LATE_JOIN_COPY = '本局已发牌，你没有身份'
export const REDEAL_CONFIRM = '新一局将清空所有人身份'
export const STAGE_HINT = '仅提示，线下行动'

export interface WerewolfBoard {
  werewolf: number
  villager: number
  seer: number
  witch: number
  hunter: number
  guard: number
}

export interface WerewolfRoleCount {
  roleId: WerewolfRoleId
  label: string
  count: number
}

export interface WerewolfSeatPrivate {
  seatId: string
  gameId: typeof WEREWOLF_GAME_ID
  dealId: string
  roleId: WerewolfRoleId
  camp: WerewolfCamp
  label: string
}

export function isWerewolfRoleId(raw: unknown): raw is WerewolfRoleId {
  return (
    raw === 'werewolf' ||
    raw === 'villager' ||
    raw === 'seer' ||
    raw === 'witch' ||
    raw === 'hunter' ||
    raw === 'guard'
  )
}

export function isWerewolfStage(raw: unknown): raw is WerewolfStage {
  return raw === 'idle' || raw === 'night' || raw === 'day' || raw === 'vote'
}

export function emptyBoard(): WerewolfBoard {
  return {
    werewolf: 0,
    villager: 0,
    seer: 0,
    witch: 0,
    hunter: 0,
    guard: 0,
  }
}

export function boardOf(raw: unknown): WerewolfBoard {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out = emptyBoard()
  for (const id of ROLE_IDS) {
    const n = typeof src[id] === 'number' ? src[id] : Number(src[id])
    out[id] = Number.isInteger(n) && n > 0 ? n : 0
  }
  return out
}

export function sumBoard(board: unknown): number {
  const b = boardOf(board)
  return ROLE_IDS.reduce((n, id) => n + b[id], 0)
}

export function goodCount(board: unknown): number {
  const b = boardOf(board)
  return b.villager + b.seer + b.witch + b.hunter + b.guard
}

export function campOf(roleId: WerewolfRoleId): WerewolfCamp {
  return ROLE_META[roleId].camp
}

export function labelOf(roleId: WerewolfRoleId): string {
  return ROLE_META[roleId].label
}

export function blurbOf(roleId: WerewolfRoleId): string {
  return ROLE_META[roleId].blurb
}

export function isWerewolfPrivate(raw: unknown): raw is WerewolfSeatPrivate {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return p.gameId === WEREWOLF_GAME_ID && isWerewolfRoleId(p.roleId)
}
