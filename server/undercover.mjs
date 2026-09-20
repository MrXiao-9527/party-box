/**
 * Who-is-undercover dealing. Words never belong on the public snapshot.
 * Wordbank: src/games/undercover/wordbank.json (self-authored; do not scrape).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BANK_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/games/undercover/wordbank.json',
)

export const WORDBANK = JSON.parse(readFileSync(BANK_PATH, 'utf8'))

/** PRD: n<=8 → 1 undercover; else 2. */
export function undercoverCountFor(n) {
  return n <= 8 ? 1 : 2
}

export function allPairs(bank = WORDBANK) {
  return bank.categories.flatMap((c) => c.pairs)
}

export function findPair(pairId, bank = WORDBANK) {
  return allPairs(bank).find((p) => p.id === pairId) || null
}

export function pairWords(pair) {
  return pair ? [pair.civilian, pair.undercover] : []
}

function fisherYates(items, rng) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

export function dealRound(seatIds, bank = WORDBANK, rng = Math.random) {
  const pairs = allPairs(bank)
  if (!pairs.length || !seatIds.length) {
    return { pairId: '', undercoverCount: 0, privates: [] }
  }
  const pair = pairs[Math.floor(rng() * pairs.length)] || pairs[0]
  const undercoverCount = Math.min(
    undercoverCountFor(seatIds.length),
    Math.max(0, seatIds.length - 1),
  )
  const order = fisherYates(seatIds, rng)
  const underSet = new Set(order.slice(0, undercoverCount))
  const privates = seatIds.map((seatId) => {
    const role = underSet.has(seatId) ? 'undercover' : 'civilian'
    return {
      seatId,
      role,
      pairId: pair.id,
      word: role === 'undercover' ? pair.undercover : pair.civilian,
    }
  })
  return { pairId: pair.id, undercoverCount, privates }
}

const SECRET_KEY_RE =
  /"(word|role|civilian|undercover|civilianWord|undercoverWord|partyPrivates|seatTokens|seatToken)"\s*:/

export function publicPayloadLeaks(payload, words = []) {
  const raw = JSON.stringify(payload)
  if (!raw) return 'empty'
  if (SECRET_KEY_RE.test(raw)) return 'secret-key'
  for (const word of words) {
    if (word && raw.includes(word)) return `word:${word}`
  }
  return null
}
