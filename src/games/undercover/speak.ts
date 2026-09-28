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
  seats?: { seatId?: string; hasWord?: boolean }[]
  eliminatedSeatIds?: string[]
  speakOrder?: string[]
  spokeSeatIds?: string[]
  speakerSeatId?: string | null
}

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
