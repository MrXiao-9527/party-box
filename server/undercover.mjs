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

/** Q4: complete edition always 1 undercover. */
export const UNDERCOVER_COUNT = 1

export function undercoverCountFor(_n) {
  return UNDERCOVER_COUNT
}

export function isUndercoverDealtPhase(phase) {
  return (
    phase === 'speaking' ||
    phase === 'voting' ||
    phase === 'playing' ||
    phase === 'revealed'
  )
}

export function isUndercoverPrivatePhase(phase) {
  return phase === 'speaking' || phase === 'voting' || phase === 'playing'
}

export function seatIdList(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const x of raw) {
    if (typeof x !== 'string' || !x.trim()) continue
    const id = x.trim()
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function aliveWordSeatIds(party, members) {
  const eliminated = new Set(seatIdList(party?.eliminatedSeatIds))
  const withWord = new Set(
    (party?.seats || [])
      .filter((s) => s && s.seatId && s.hasWord)
      .map((s) => s.seatId),
  )
  return (members || [])
    .filter(
      (m) => m && m.seatId && withWord.has(m.seatId) && !eliminated.has(m.seatId),
    )
    .map((m) => m.seatId)
}

export function onlineAliveSeatIds(party, members) {
  const alive = new Set(aliveWordSeatIds(party, members))
  return (members || [])
    .filter((m) => m && m.connected && alive.has(m.seatId))
    .map((m) => m.seatId)
}

export function nextUnspokenOnline(
  speakOrder,
  spokeSeatIds,
  onlineIds,
  afterSeatId,
) {
  const spoke = new Set(spokeSeatIds || [])
  const online = new Set(onlineIds || [])
  const order = seatIdList(speakOrder)
  if (!order.length) {
    return (onlineIds || []).find((id) => id && !spoke.has(id)) || null
  }
  const start = afterSeatId ? order.indexOf(afterSeatId) : -1
  for (let i = 1; i <= order.length; i++) {
    const id = order[(start + i + order.length) % order.length]
    if (online.has(id) && !spoke.has(id)) return id
  }
  return null
}

export function enterVotingRound(party) {
  return {
    phase: 'voting',
    speakerSeatId: null,
    spokeSeatIds: seatIdList(party?.spokeSeatIds),
    speakOrder: seatIdList(party?.speakOrder),
    voteRound: 0,
    votes: {},
  }
}

export function buildSpeakingRound(seatIds, members) {
  const speakOrder = seatIdList(seatIds)
  const online = new Set(
    (members || [])
      .filter((m) => m && m.connected && speakOrder.includes(m.seatId))
      .map((m) => m.seatId),
  )
  return {
    phase: 'speaking',
    speakerSeatId: speakOrder.find((id) => online.has(id)) || null,
    spokeSeatIds: [],
    speakOrder,
    voteRound: 0,
    votes: {},
  }
}

export function advanceSpeakRing({
  speakOrder,
  spokeSeatIds,
  speakerSeatId,
  onlineAliveIds,
  markSpoke,
}) {
  const spoke = seatIdList(spokeSeatIds)
  if (markSpoke && speakerSeatId && !spoke.includes(speakerSeatId)) {
    spoke.push(speakerSeatId)
  }
  const online = seatIdList(onlineAliveIds)
  const order = seatIdList(speakOrder)
  if (!online.length) {
    return {
      phase: 'speaking',
      speakerSeatId: null,
      spokeSeatIds: spoke,
      speakOrder: order,
    }
  }
  if (online.every((id) => spoke.includes(id))) {
    return enterVotingRound({ spokeSeatIds: spoke, speakOrder: order })
  }
  const next = nextUnspokenOnline(order, spoke, online, speakerSeatId)
  if (!next) {
    return enterVotingRound({ spokeSeatIds: spoke, speakOrder: order })
  }
  return {
    phase: 'speaking',
    speakerSeatId: next,
    spokeSeatIds: spoke,
    speakOrder: order,
  }
}

/** Q5: rejoin appends to tail; never steals the current speaker. */
export function appendSpeakTail(speakOrder, seatId, speakerSeatId) {
  if (!seatId) return seatIdList(speakOrder)
  const order = seatIdList(speakOrder)
  if (speakerSeatId === seatId) {
    return order.includes(seatId) ? order : [...order, seatId]
  }
  return [...order.filter((id) => id !== seatId), seatId]
}

export function applyDisconnectSkip(party, members) {
  if (!party || party.phase !== 'speaking') return party
  const online = onlineAliveSeatIds(party, members)
  const speaker = party.speakerSeatId || null
  if (speaker && online.includes(speaker)) {
    if (online.length && online.every((id) => (party.spokeSeatIds || []).includes(id))) {
      return { ...party, ...enterVotingRound(party) }
    }
    return party
  }
  return {
    ...party,
    ...advanceSpeakRing({
      speakOrder: party.speakOrder,
      spokeSeatIds: party.spokeSeatIds,
      speakerSeatId: speaker,
      onlineAliveIds: online,
      markSpoke: false,
    }),
  }
}

export function applyRejoinSpeakTail(party, seatId, members) {
  if (!party || party.phase !== 'speaking' || !seatId) return party
  const alive = aliveWordSeatIds(party, members)
  if (!alive.includes(seatId)) return party
  return {
    ...party,
    speakOrder: appendSpeakTail(party.speakOrder, seatId, party.speakerSeatId),
  }
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
    UNDERCOVER_COUNT,
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
