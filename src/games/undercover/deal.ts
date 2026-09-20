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
}

export interface DealResult {
  pairId: string
  undercoverCount: number
  privates: SeatPrivate[]
}

export const WORDBANK = wordbankJson as Wordbank

/** PRD: n<=8 → 1 undercover; else 2. Seat cap is 8 so live rooms get 1. */
export function undercoverCountFor(n: number): number {
  return n <= 8 ? 1 : 2
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
): DealResult {
  const pairs = allPairs(bank)
  if (pairs.length === 0 || seatIds.length === 0) {
    return { pairId: '', undercoverCount: 0, privates: [] }
  }
  const pair = pairs[Math.floor(rng() * pairs.length)] ?? pairs[0]
  const undercoverCount = Math.min(
    undercoverCountFor(seatIds.length),
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
  return { pairId: pair.id, undercoverCount, privates }
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
