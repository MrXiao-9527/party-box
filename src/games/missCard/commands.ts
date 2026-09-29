/** Classic 十三钗 command table (PRD v0.2 §5). Self-authored copy; not a room editor. */

export const MISS_CARD_RANKS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
] as const

export const MISS_CARD_SUITS = ['spade', 'heart', 'club', 'diamond'] as const

export type MissCardRank = (typeof MISS_CARD_RANKS)[number]
export type MissCardSuit = (typeof MISS_CARD_SUITS)[number]

export const SUIT_GLYPH: Record<MissCardSuit, string> = {
  spade: '♠',
  heart: '♥',
  club: '♣',
  diamond: '♦',
}

export const SUIT_LABEL: Record<MissCardSuit, string> = {
  spade: '黑桃',
  heart: '红桃',
  club: '梅花',
  diamond: '方片',
}

export type MissCardCommandKind =
  | 'pick'
  | 'role'
  | 'prompt'
  | 'toilet'
  | 'neighbor'
  | 'k'

export type MissCardCommand = {
  rank: MissCardRank
  name: string
  instruction: string
  kind: MissCardCommandKind
}

export const MISS_CARD_COMMANDS: Record<MissCardRank, MissCardCommand> = {
  A: {
    rank: 'A',
    name: '指定喝',
    instruction: '抽牌人指定一人喝一杯（可点自己）。只可点当前在线席。',
    kind: 'pick',
  },
  '2': {
    rank: '2',
    name: '小姐',
    instruction: '抽牌人成为「小姐」。他人输酒可叫小姐陪喝。下一张 2 顶替持有人。',
    kind: 'role',
  },
  '3': {
    rank: '3',
    name: '逛三园',
    instruction: '抽牌人先说一个品类，众人轮流接龙；接不上或重复者喝。',
    kind: 'prompt',
  },
  '4': {
    rank: '4',
    name: '摸鼻子',
    instruction: '任何人可随时摸鼻子，最后才模仿的人喝。',
    kind: 'prompt',
  },
  '5': {
    rank: '5',
    name: '照相机',
    instruction: '有人喊「定格」后，还在动的人喝。',
    kind: 'prompt',
  },
  '6': {
    rank: '6',
    name: '扭一扭',
    instruction: '递增「风吹柳树扭一扭」口令接龙，接不上或说错者喝。',
    kind: 'prompt',
  },
  '7': {
    rank: '7',
    name: '逢7过',
    instruction: '从抽牌人起数数；逢 7 的倍数或含 7 要说「过」，说错者喝。',
    kind: 'prompt',
  },
  '8': {
    rank: '8',
    name: '厕所牌',
    instruction: '获得 1 次上厕所权。徽章显示剩余次数，用完即消失。',
    kind: 'toilet',
  },
  '9': {
    rank: '9',
    name: '自喝',
    instruction: '抽牌人自己喝一杯。',
    kind: 'prompt',
  },
  '10': {
    rank: '10',
    name: '神经病',
    instruction: '抽牌人成为「神经病」。他人不可与其对话，违者喝。下一张 10 顶替。',
    kind: 'role',
  },
  J: {
    rank: 'J',
    name: '左边喝',
    instruction: '左邻（席位环上一在线，跳过离线）喝一杯。无人邻座则自喝。',
    kind: 'neighbor',
  },
  Q: {
    rank: 'Q',
    name: '右边喝',
    instruction: '右邻（席位环下一在线，跳过离线）喝一杯。无人邻座则自喝。',
    kind: 'neighbor',
  },
  K: {
    rank: 'K',
    name: '定量牌',
    instruction:
      '首次：自喝一杯，并设定「下个 K 喝几杯」。再次：执行该杯数，之后可重定。',
    kind: 'k',
  },
}

export const MISS_CARD_COMMAND_LIST: MissCardCommand[] = MISS_CARD_RANKS.map(
  (rank) => MISS_CARD_COMMANDS[rank],
)

export function commandOf(rank: string): MissCardCommand | null {
  return rank in MISS_CARD_COMMANDS
    ? MISS_CARD_COMMANDS[rank as MissCardRank]
    : null
}

export const MISS_CARD_COPY = {
  toolName: '小姐牌',
  toolSubtitle: '十三钗 · 轮流抽牌出令',
  start: '开局',
  remaining: (n: number) => `剩余 ${n} 张`,
  waitDraw: (nick: string) => `等待 ${nick} 抽牌`,
  yourDraw: '轮到你抽一张',
  draw: '抽一张',
  complete: '完成',
  pickHint: '指定一人喝一杯',
  pickAction: '点他',
  miss: '小姐',
  psycho: '神经病',
  toilet: (n: number) => `厕所 ×${n}`,
  useToilet: '用掉一次',
  neighborLeft: '左边喝',
  neighborRight: '右边喝',
  noNeighbor: '无人邻座，请自喝',
  kFirst: '自喝一杯，并设定下个 K 喝几杯',
  kAgain: (n: number) => `执行定量：喝 ${n} 杯`,
  kSet: '设定杯数',
  kReset: '重定杯数',
  kApply: '已执行，清空定量',
  history: '近史',
  rules: '规则',
  skipDrawer: '跳过当前抽牌人',
  skipOffline: (nick: string) => `${nick} 已离线，跳过`,
  skipHost: '已跳过当前抽牌人',
  deckEmpty: '牌已抽完',
  reshuffle: '洗切重开',
  endGame: '收局回工具',
  ended: '本局已结束',
} as const
