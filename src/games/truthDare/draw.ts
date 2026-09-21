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
