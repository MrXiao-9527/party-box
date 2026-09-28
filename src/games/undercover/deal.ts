/** Undercover dealing — public pairId only; words stay in SeatPrivate. */

import wordbankJson from './wordbank.json'

export type UndercoverRole = 'civilian' | 'undercover'

export interface WordPair {
  id: string
  civilian: string
  undercover: string
}

export interface WordCategory {
  id: string
  name: string
  pairs: WordPair[]
}

export interface Wordbank {
  version: number
  gameId: string
  categories: WordCategory[]
}

export interface SeatPrivate {
  seatId: string
  word: string
  role: UndercoverRole
  pairId: string
  round?: number
}

export interface DealResult {
  pairId: string
  undercoverCount: number
  privates: SeatPrivate[]
  recentPairIds: string[]
}

export const WORDBANK = wordbankJson as Wordbank

/** Q4: complete edition always 1 undercover. */
export const UNDERCOVER_COUNT = 1

/** Near-K window; grow with bank so evening play does not collide until exhausted. */
export const PAIR_RECENT_K = 48

export function undercoverCountFor(_n: number): number {
  return UNDERCOVER_COUNT
}

export function allPairs(bank: Wordbank = WORDBANK): WordPair[] {
  return bank.categories.flatMap((c) => c.pairs)
}

export function findPair(
  pairId: string,
  bank: Wordbank = WORDBANK,
): WordPair | null {
  for (const pair of allPairs(bank)) {
    if (pair.id === pairId) return pair
  }
  return null
}

export function pairWords(pair: WordPair): string[] {
  return [pair.civilian, pair.undercover]
}

export function recentPairIdsOf(
  raw: unknown,
  pairCount = 0,
  k = PAIR_RECENT_K,
): string[] {
  if (!Array.isArray(raw)) return []
  const window = Math.max(k, pairCount)
  const ids = raw
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((x) => x.trim())
  return ids.slice(-window)
}

export function pickPair(
  pairs: WordPair[],
  recentIds: unknown = [],
  rng: () => number = Math.random,
  k = PAIR_RECENT_K,
): WordPair | null {
  if (!pairs.length) return null
  const blocked = new Set(recentPairIdsOf(recentIds, pairs.length, k))
  let pool = pairs.filter((p) => p && p.id && !blocked.has(p.id))
  if (!pool.length) pool = pairs
  return pool[Math.floor(rng() * pool.length)] ?? pool[0] ?? null
}

function fisherYates<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

export function dealRound(
  seatIds: string[],
  bank: Wordbank = WORDBANK,
  rng: () => number = Math.random,
  recentPairIds: string[] = [],
): DealResult {
  const pairs = allPairs(bank)
  const recent = recentPairIdsOf(recentPairIds, pairs.length)
  if (pairs.length === 0 || seatIds.length === 0) {
    return { pairId: '', undercoverCount: 0, privates: [], recentPairIds: recent }
  }
  const pair = pickPair(pairs, recent, rng) ?? pairs[0]
  const undercoverCount = Math.min(
    UNDERCOVER_COUNT,
    Math.max(0, seatIds.length - 1),
  )
  const order = fisherYates(seatIds, rng)
  const underSet = new Set(order.slice(0, undercoverCount))
  const privates: SeatPrivate[] = seatIds.map((seatId) => {
    const role: UndercoverRole = underSet.has(seatId)
      ? 'undercover'
      : 'civilian'
    return {
      seatId,
      role,
      pairId: pair.id,
      word: role === 'undercover' ? pair.undercover : pair.civilian,
    }
  })
  const nextRecent = [...recent.filter((id) => id !== pair.id), pair.id].slice(
    -Math.max(PAIR_RECENT_K, pairs.length),
  )
  return { pairId: pair.id, undercoverCount, privates, recentPairIds: nextRecent }
}

const SECRET_KEYS = [
  'word',
  'role',
  'civilian',
  'undercover',
  'civilianWord',
  'undercoverWord',
  'partyPrivates',
  'seatTokens',
  'seatToken',
] as const

/** True if public JSON still carries private word/role fields or pair text. */
export function publicPayloadLeaks(
  payload: unknown,
  words: string[] = [],
): string | null {
  const raw = JSON.stringify(payload)
  if (!raw) return 'empty'
  for (const key of SECRET_KEYS) {
    if (new RegExp(`"${key}"\\s*:`).test(raw)) return `key:${key}`
  }
  for (const word of words) {
    if (word && raw.includes(word)) return `word:${word}`
  }
  return null
}
