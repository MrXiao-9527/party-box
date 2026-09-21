/** Truth-or-dare draw. Prompts are public; never use SeatPrivate. */

import promptsJson from './prompts.json'

export const RECENT_K = 8

export type PromptKind = 'truth' | 'dare'

export interface PromptEntry {
  id: string
  type: PromptKind
  text: string
}

export interface PromptBank {
  version: number
  gameId: string
  prompts: PromptEntry[]
}

/** Public shared prompt on the room snapshot. */
export interface PublicPrompt {
  id: string
  displayType: PromptKind
  text: string
  drawnAt?: number
}

export const PROMPTS = promptsJson as PromptBank

export function allPrompts(bank: PromptBank = PROMPTS): PromptEntry[] {
  return Array.isArray(bank.prompts) ? bank.prompts : []
}

export function publicPrompt(entry: PromptEntry): PublicPrompt {
  return {
    id: entry.id,
    displayType: entry.type === 'dare' ? 'dare' : 'truth',
    text: entry.text,
  }
}

function usable(entry: PromptEntry | null | undefined): entry is PromptEntry {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    !!entry.id.trim() &&
    typeof entry.text === 'string' &&
    !!entry.text.trim() &&
    (entry.type === 'truth' || entry.type === 'dare')
  )
}

export function pickPrompt(
  opts: {
    recentIds?: string[]
    previousId?: string
    previousText?: string
    mustChange?: boolean
    bank?: PromptBank
    rng?: () => number
    k?: number
  } = {},
): { prompt: PublicPrompt; recentPromptIds: string[] } | null {
  const bank = opts.bank ?? PROMPTS
  const rng = opts.rng ?? Math.random
  const k = opts.k ?? RECENT_K
  const recentIds = (opts.recentIds ?? []).filter((id) => typeof id === 'string' && id)
  const previousId = opts.previousId || ''
  const previousText = opts.previousText || ''
  const mustChange = !!opts.mustChange
  const pool = allPrompts(bank).filter(usable)
  if (pool.length === 0) return null

  const blocked = new Set(recentIds.slice(-k))
  if (mustChange && previousId) blocked.add(previousId)

  const eligible = (p: PromptEntry) => {
    if (blocked.has(p.id)) return false
    if (mustChange && previousText && p.text === previousText) return false
    return true
  }

  let candidates = pool.filter(eligible)
  if (candidates.length === 0 && mustChange) {
    candidates = pool.filter(
      (p) => p.id !== previousId && p.text !== previousText,
    )
  }
  if (candidates.length === 0) {
    candidates = pool.filter((p) => p.id !== previousId)
  }
  if (candidates.length === 0) candidates = pool

  const picked = candidates[Math.floor(rng() * candidates.length)] ?? candidates[0]
  if (!picked) return null
  return {
    prompt: publicPrompt(picked),
    recentPromptIds: [...recentIds, picked.id].slice(-k),
  }
}

export type RoomMemberLike = {
  seatId: string
  connected?: boolean
}

export function onlineMembers(members: RoomMemberLike[] = []): RoomMemberLike[] {
  return (members || []).filter((m) => m && m.seatId && m.connected)
}

export function firstOnlineSeatId(members: RoomMemberLike[] = []): string | null {
  return onlineMembers(members)[0]?.seatId || null
}

export function nextDrawerSeatId(
  members: RoomMemberLike[] = [],
  currentSeatId: string | null | undefined = '',
): string | null {
  const seats = (members || []).filter((m) => m && m.seatId)
  const online = seats.filter((m) => m.connected)
  if (!online.length) return null
  if (!currentSeatId) return online[0].seatId
  const start = seats.findIndex((m) => m.seatId === currentSeatId)
  const from = start === -1 ? -1 : start
  for (let i = 1; i <= seats.length; i++) {
    const m = seats[(from + i) % seats.length]
    if (m.connected) return m.seatId
  }
  return online[0].seatId
}

function memberBySeat(
  members: RoomMemberLike[],
  seatId: string | null | undefined,
): RoomMemberLike | null {
  if (!seatId) return null
  return members.find((m) => m.seatId === seatId) || null
}

export function isTruthDarePhase(
  raw: unknown,
): raw is 'idle' | 'drawing' | 'answering' {
  return raw === 'idle' || raw === 'drawing' || raw === 'answering'
}

type TruthDareTurn = {
  gameId: 'truthDare'
  phase: 'idle' | 'drawing' | 'answering'
  drawerSeatId: string | null
  answererSeatId: string | null
  prompt?: PublicPrompt
  recentPromptIds?: string[]
}

export function ensureTruthDareTurn<T extends { gameId?: string }>(
  party: T,
  members: RoomMemberLike[] = [],
): T {
  if (!party || party.gameId !== 'truthDare') return party
  const src = party as T & {
    prompt?: PublicPrompt | null
    recentPromptIds?: string[]
    drawerSeatId?: string | null
    answererSeatId?: string | null
    phase?: string
  }
  const prompt = src.prompt || null
  const recent = Array.isArray(src.recentPromptIds)
    ? src.recentPromptIds.filter((id) => typeof id === 'string' && id)
    : []
  const online = firstOnlineSeatId(members)
  let drawerSeatId =
    typeof src.drawerSeatId === 'string' && src.drawerSeatId
      ? src.drawerSeatId
      : null
  let answererSeatId =
    typeof src.answererSeatId === 'string' && src.answererSeatId
      ? src.answererSeatId
      : null

  if (online) {
    const drawerMember = memberBySeat(members, drawerSeatId)
    if (!drawerMember) drawerSeatId = online
    else if (!drawerMember.connected) {
      drawerSeatId = nextDrawerSeatId(members, drawerSeatId)
    }
  }

  let phase: TruthDareTurn['phase']
  if (prompt) phase = 'answering'
  else if (online) phase = 'drawing'
  else phase = 'idle'

  if (phase === 'answering') {
    if (!answererSeatId || !memberBySeat(members, answererSeatId)) {
      answererSeatId = drawerSeatId
    }
  } else {
    answererSeatId = null
  }

  if (phase === 'idle') drawerSeatId = null

  const next: TruthDareTurn = {
    gameId: 'truthDare',
    phase,
    drawerSeatId,
    answererSeatId,
  }
  if (prompt && phase === 'answering') next.prompt = prompt
  if (recent.length) next.recentPromptIds = recent
  return next as unknown as T
}
