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

/** Near-K window; grow with bank so evening play does not collide until exhausted. */
export const PAIR_RECENT_K = 48

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

export const VOTE_ABSTAIN = 'abstain'
export const VOTE_NOTICE_REVOTE = '平票，请再投一次'
export const VOTE_NOTICE_TIE_NONE = '平票，无人出局'
export const VOTE_ERR = {
  NOT_VOTING: 'NOT_VOTING',
  NOT_ALIVE: 'NOT_ALIVE',
  BAD_TARGET: 'BAD_TARGET',
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

export function aliveSpeakOrder(speakOrder, aliveIds) {
  const alive = seatIdList(aliveIds)
  const aliveSet = new Set(alive)
  const prev = seatIdList(speakOrder).filter((id) => aliveSet.has(id))
  for (const id of alive) {
    if (!prev.includes(id)) prev.push(id)
  }
  return prev
}

export function normalizeVoteTarget(raw) {
  if (raw === true) return VOTE_ABSTAIN
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v) return null
  if (v === VOTE_ABSTAIN) return VOTE_ABSTAIN
  return v
}

export function tallyVoteCounts(votes, aliveIds) {
  const alive = new Set(seatIdList(aliveIds))
  const counts = {}
  for (const [voter, target] of Object.entries(votes || {})) {
    if (!alive.has(voter)) continue
    if (target === VOTE_ABSTAIN || !target) continue
    if (!alive.has(target)) continue
    counts[target] = (counts[target] || 0) + 1
  }
  return counts
}

export function highestVoteTargets(counts) {
  let max = 0
  const tops = []
  for (const [id, n] of Object.entries(counts || {})) {
    const score = Number(n) || 0
    if (score > max) {
      max = score
      tops.length = 0
      tops.push(id)
    } else if (score === max && score > 0) {
      tops.push(id)
    }
  }
  return { max, tops }
}

export function fillOfflineAbstain(party, members) {
  const alive = aliveWordSeatIds(party, members)
  const online = new Set(onlineAliveSeatIds(party, members))
  const votes = { ...(party?.votes || {}) }
  for (const id of alive) {
    if (!(id in votes) && !online.has(id)) votes[id] = VOTE_ABSTAIN
  }
  return votes
}

export function canSettleVotes(party, members) {
  if (!party || party.phase !== 'voting') return false
  const alive = aliveWordSeatIds(party, members)
  if (!alive.length) return false
  const votes = party.votes || {}
  const online = new Set(onlineAliveSeatIds(party, members))
  return alive.every((id) => id in votes || !online.has(id))
}

export function castVoteOnParty(party, members, voterSeatId, rawTarget) {
  if (!party || party.phase !== 'voting') return { error: VOTE_ERR.NOT_VOTING }
  const target = normalizeVoteTarget(rawTarget)
  if (!target) return { error: VOTE_ERR.BAD_TARGET }
  const alive = aliveWordSeatIds(party, members)
  if (!voterSeatId || !alive.includes(voterSeatId)) {
    return { error: VOTE_ERR.NOT_ALIVE }
  }
  if (target !== VOTE_ABSTAIN && (target === voterSeatId || !alive.includes(target))) {
    return { error: VOTE_ERR.BAD_TARGET }
  }
  return {
    party: {
      ...party,
      votes: { ...(party.votes || {}), [voterSeatId]: target },
    },
  }
}

export function applyVotingDisconnect(party, members, seatId) {
  if (!party || party.phase !== 'voting' || !seatId) return party
  const alive = aliveWordSeatIds(party, members)
  if (!alive.includes(seatId)) return party
  const votes = { ...(party.votes || {}) }
  if (!(seatId in votes)) votes[seatId] = VOTE_ABSTAIN
  return { ...party, votes }
}

export function checkUndercoverWinner(eliminatedSeatIds, privates, aliveSeatIds) {
  const elim = new Set(seatIdList(eliminatedSeatIds))
  const underIds = []
  for (const [id, p] of Object.entries(privates || {})) {
    if (p && p.role === 'undercover') underIds.push(id)
  }
  if (underIds.some((id) => elim.has(id))) return 'civilian'
  const alive = new Set(seatIdList(aliveSeatIds))
  let aliveUnder = 0
  let aliveCiv = 0
  for (const id of alive) {
    const role = privates?.[id]?.role
    if (role === 'undercover') aliveUnder += 1
    else if (role === 'civilian') aliveCiv += 1
  }
  if (aliveUnder > 0 && aliveUnder >= aliveCiv) return 'undercover'
  return null
}

export function settleVoteParty(party, members, privates) {
  const votes = fillOfflineAbstain(party, members)
  const alive = aliveWordSeatIds(party, members)
  const counts = tallyVoteCounts(votes, alive)
  const { max, tops } = highestVoteTargets(counts)
  const voteRound = party?.voteRound === 1 ? 1 : 0
  const isTie = max <= 0 || tops.length !== 1
  const base = {
    gameId: party?.gameId || 'undercover',
    pairId: party?.pairId,
    undercoverCount: party?.undercoverCount || 1,
    round: party?.round,
    seats: party?.seats,
    eliminatedSeatIds: seatIdList(party?.eliminatedSeatIds),
    recentPairIds: seatIdList(party?.recentPairIds),
  }

  if (isTie) {
    if (voteRound === 0) {
      return {
        ...base,
        phase: 'voting',
        speakerSeatId: null,
        spokeSeatIds: seatIdList(party?.spokeSeatIds),
        speakOrder: seatIdList(party?.speakOrder),
        voteRound: 1,
        votes: {},
        voteNotice: VOTE_NOTICE_REVOTE,
        winner: null,
      }
    }
    const ring = buildSpeakingRound(aliveSpeakOrder(party?.speakOrder, alive), members)
    return {
      ...base,
      ...ring,
      voteNotice: VOTE_NOTICE_TIE_NONE,
      winner: null,
    }
  }

  const outId = tops[0]
  const eliminatedSeatIds = [
    ...base.eliminatedSeatIds.filter((id) => id !== outId),
    outId,
  ]
  const nextAlive = alive.filter((id) => id !== outId)
  const winner = checkUndercoverWinner(eliminatedSeatIds, privates, nextAlive)
  if (winner) {
    return {
      ...base,
      phase: 'revealed',
      speakerSeatId: null,
      spokeSeatIds: [],
      speakOrder: seatIdList(party?.speakOrder),
      voteRound: 0,
      votes: {},
      eliminatedSeatIds,
      winner,
    }
  }
  const ring = buildSpeakingRound(
    aliveSpeakOrder(party?.speakOrder, nextAlive),
    members,
  )
  return {
    ...base,
    ...ring,
    eliminatedSeatIds,
    winner: null,
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

export function recentPairIdsOf(raw, pairCount = 0, k = PAIR_RECENT_K) {
  if (!Array.isArray(raw)) return []
  const window = Math.max(k, pairCount)
  const ids = raw
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim())
  return ids.slice(-window)
}

export function pickPair(pairs, recentIds = [], rng = Math.random, k = PAIR_RECENT_K) {
  if (!pairs.length) return null
  const blocked = new Set(recentPairIdsOf(recentIds, pairs.length, k))
  let pool = pairs.filter((p) => p && p.id && !blocked.has(p.id))
  if (!pool.length) pool = pairs
  return pool[Math.floor(rng() * pool.length)] || pool[0] || null
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

export function dealRound(seatIds, bank = WORDBANK, rng = Math.random, recentPairIds = []) {
  const pairs = allPairs(bank)
  const recent = recentPairIdsOf(recentPairIds, pairs.length)
  if (!pairs.length || !seatIds.length) {
    return { pairId: '', undercoverCount: 0, privates: [], recentPairIds: recent }
  }
  const pair = pickPair(pairs, recent, rng) || pairs[0]
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
  const nextRecent = [...recent.filter((id) => id !== pair.id), pair.id].slice(
    -Math.max(PAIR_RECENT_K, pairs.length),
  )
  return { pairId: pair.id, undercoverCount, privates, recentPairIds: nextRecent }
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
