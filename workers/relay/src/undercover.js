/**
 * Who-is-undercover dealing (Worker copy of server/undercover.mjs).
 * Wordbank is local JSON — keep in sync with src/games/undercover/wordbank.json.
 */
import WORDBANK from './wordbank.json'

export { WORDBANK }

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
