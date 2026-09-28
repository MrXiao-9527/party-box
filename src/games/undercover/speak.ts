/** Independent undercover speak ring. Do not import truthDare turn helpers. */

export function isUndercoverDealtPhase(phase: string | undefined): boolean {
  return (
    phase === 'speaking' ||
    phase === 'voting' ||
    phase === 'playing' ||
    phase === 'revealed'
  )
}

export function isUndercoverPrivatePhase(phase: string | undefined): boolean {
  return phase === 'speaking' || phase === 'voting' || phase === 'playing'
}

export function seatIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string' || !x.trim()) continue
    const id = x.trim()
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

type RingMember = { seatId?: string; connected?: boolean } | null | undefined
type RingParty = {
  phase?: string
  gameId?: string
  pairId?: string
  undercoverCount?: number
  round?: number
  seats?: { seatId?: string; hasWord?: boolean }[]
  eliminatedSeatIds?: string[]
  speakOrder?: string[]
  spokeSeatIds?: string[]
  speakerSeatId?: string | null
  votes?: Record<string, string>
  voteRound?: 0 | 1
  voteNotice?: string
  winner?: 'civilian' | 'undercover' | null
}

type SeatPrivateLike = { role?: string } | null | undefined

export const VOTE_ABSTAIN = 'abstain'
export const VOTE_NOTICE_REVOTE = '平票，请再投一次'
export const VOTE_NOTICE_TIE_NONE = '平票，无人出局'
export const VOTE_ERR = {
  NOT_VOTING: 'NOT_VOTING',
  NOT_ALIVE: 'NOT_ALIVE',
  BAD_TARGET: 'BAD_TARGET',
} as const

export function aliveWordSeatIds(
  party: RingParty | null | undefined,
  members: RingMember[] = [],
): string[] {
  const eliminated = new Set(seatIdList(party?.eliminatedSeatIds))
  const withWord = new Set(
    (party?.seats || [])
      .filter((s) => s && s.seatId && s.hasWord)
      .map((s) => s.seatId as string),
  )
  return (members || [])
    .filter(
      (m) => m && m.seatId && withWord.has(m.seatId) && !eliminated.has(m.seatId),
    )
    .map((m) => m!.seatId as string)
}

export function onlineAliveSeatIds(
  party: RingParty | null | undefined,
  members: RingMember[] = [],
): string[] {
  const alive = new Set(aliveWordSeatIds(party, members))
  return (members || [])
    .filter((m) => m && m.connected && m.seatId && alive.has(m.seatId))
    .map((m) => m!.seatId as string)
}

export function nextUnspokenOnline(
  speakOrder: unknown,
  spokeSeatIds: unknown,
  onlineIds: string[],
  afterSeatId: string | null | undefined,
): string | null {
  const spoke = new Set(seatIdList(spokeSeatIds))
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

export function enterVotingRound(party?: RingParty | null) {
  return {
    phase: 'voting' as const,
    speakerSeatId: null as string | null,
    spokeSeatIds: seatIdList(party?.spokeSeatIds),
    speakOrder: seatIdList(party?.speakOrder),
    voteRound: 0 as const,
    votes: {} as Record<string, string>,
  }
}

export function buildSpeakingRound(
  seatIds: string[],
  members: RingMember[] = [],
) {
  const speakOrder = seatIdList(seatIds)
  const online = new Set(
    (members || [])
      .filter((m) => m && m.connected && m.seatId && speakOrder.includes(m.seatId))
      .map((m) => m!.seatId as string),
  )
  return {
    phase: 'speaking' as const,
    speakerSeatId: speakOrder.find((id) => online.has(id)) || null,
    spokeSeatIds: [] as string[],
    speakOrder,
    voteRound: 0 as const,
    votes: {} as Record<string, string>,
  }
}

export function advanceSpeakRing(input: {
  speakOrder?: unknown
  spokeSeatIds?: unknown
  speakerSeatId?: string | null
  onlineAliveIds?: string[]
  markSpoke?: boolean
}) {
  const spoke = seatIdList(input.spokeSeatIds)
  const speakerSeatId = input.speakerSeatId || null
  if (input.markSpoke && speakerSeatId && !spoke.includes(speakerSeatId)) {
    spoke.push(speakerSeatId)
  }
  const online = seatIdList(input.onlineAliveIds)
  const order = seatIdList(input.speakOrder)
  if (!online.length) {
    return {
      phase: 'speaking' as const,
      speakerSeatId: null as string | null,
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
    phase: 'speaking' as const,
    speakerSeatId: next,
    spokeSeatIds: spoke,
    speakOrder: order,
  }
}

/** Q5: rejoin appends to tail; never steals the current speaker. */
export function appendSpeakTail(
  speakOrder: unknown,
  seatId: string,
  speakerSeatId?: string | null,
): string[] {
  if (!seatId) return seatIdList(speakOrder)
  const order = seatIdList(speakOrder)
  if (speakerSeatId === seatId) {
    return order.includes(seatId) ? order : [...order, seatId]
  }
  return [...order.filter((id) => id !== seatId), seatId]
}

export function applyDisconnectSkip<T extends RingParty>(
  party: T,
  members: RingMember[] = [],
): T {
  if (!party || party.phase !== 'speaking') return party
  const online = onlineAliveSeatIds(party, members)
  const speaker = party.speakerSeatId || null
  if (speaker && online.includes(speaker)) {
    if (
      online.length &&
      online.every((id) => (party.spokeSeatIds || []).includes(id))
    ) {
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

export function applyRejoinSpeakTail<T extends RingParty>(
  party: T,
  seatId: string,
  members: RingMember[] = [],
): T {
  if (!party || party.phase !== 'speaking' || !seatId) return party
  const alive = aliveWordSeatIds(party, members)
  if (!alive.includes(seatId)) return party
  return {
    ...party,
    speakOrder: appendSpeakTail(party.speakOrder, seatId, party.speakerSeatId),
  }
}

export function aliveSpeakOrder(speakOrder: unknown, aliveIds: unknown): string[] {
  const alive = seatIdList(aliveIds)
  const aliveSet = new Set(alive)
  const prev = seatIdList(speakOrder).filter((id) => aliveSet.has(id))
  for (const id of alive) {
    if (!prev.includes(id)) prev.push(id)
  }
  return prev
}

export function normalizeVoteTarget(raw: unknown): string | null {
  if (raw === true) return VOTE_ABSTAIN
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v) return null
  if (v === VOTE_ABSTAIN) return VOTE_ABSTAIN
  return v
}

export function tallyVoteCounts(
  votes: Record<string, string> | null | undefined,
  aliveIds: unknown,
): Record<string, number> {
  const alive = new Set(seatIdList(aliveIds))
  const counts: Record<string, number> = {}
  for (const [voter, target] of Object.entries(votes || {})) {
    if (!alive.has(voter)) continue
    if (target === VOTE_ABSTAIN || !target) continue
    if (!alive.has(target)) continue
    counts[target] = (counts[target] || 0) + 1
  }
  return counts
}

export function highestVoteTargets(counts: Record<string, number> | null | undefined) {
  let max = 0
  const tops: string[] = []
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

export function fillOfflineAbstain(
  party: RingParty | null | undefined,
  members: RingMember[] = [],
): Record<string, string> {
  const alive = aliveWordSeatIds(party, members)
  const online = new Set(onlineAliveSeatIds(party, members))
  const votes = { ...(party?.votes || {}) }
  for (const id of alive) {
    if (!(id in votes) && !online.has(id)) votes[id] = VOTE_ABSTAIN
  }
  return votes
}

export function canSettleVotes(
  party: RingParty | null | undefined,
  members: RingMember[] = [],
): boolean {
  if (!party || party.phase !== 'voting') return false
  const alive = aliveWordSeatIds(party, members)
  if (!alive.length) return false
  const votes = party.votes || {}
  const online = new Set(onlineAliveSeatIds(party, members))
  return alive.every((id) => id in votes || !online.has(id))
}

export function castVoteOnParty(
  party: RingParty | null | undefined,
  members: RingMember[],
  voterSeatId: string,
  rawTarget: unknown,
): { error: string } | { party: RingParty } {
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

export function applyVotingDisconnect<T extends RingParty>(
  party: T,
  members: RingMember[],
  seatId: string,
): T {
  if (!party || party.phase !== 'voting' || !seatId) return party
  const alive = aliveWordSeatIds(party, members)
  if (!alive.includes(seatId)) return party
  const votes = { ...(party.votes || {}) }
  if (!(seatId in votes)) votes[seatId] = VOTE_ABSTAIN
  return { ...party, votes }
}

export function checkUndercoverWinner(
  eliminatedSeatIds: unknown,
  privates: Record<string, SeatPrivateLike> | null | undefined,
  aliveSeatIds: unknown,
): 'civilian' | 'undercover' | null {
  const elim = new Set(seatIdList(eliminatedSeatIds))
  const underIds: string[] = []
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

export function settleVoteParty(
  party: RingParty | null | undefined,
  members: RingMember[] = [],
  privates: Record<string, SeatPrivateLike> | null | undefined = {},
): RingParty {
  const votes = fillOfflineAbstain(party, members)
  const alive = aliveWordSeatIds(party, members)
  const counts = tallyVoteCounts(votes, alive)
  const { max, tops } = highestVoteTargets(counts)
  const voteRound = party?.voteRound === 1 ? 1 : 0
  const isTie = max <= 0 || tops.length !== 1
  const base: RingParty = {
    gameId: party?.gameId || 'undercover',
    pairId: party?.pairId,
    undercoverCount: party?.undercoverCount || 1,
    round: party?.round,
    seats: party?.seats,
    eliminatedSeatIds: seatIdList(party?.eliminatedSeatIds),
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
    ...(base.eliminatedSeatIds || []).filter((id) => id !== outId),
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
