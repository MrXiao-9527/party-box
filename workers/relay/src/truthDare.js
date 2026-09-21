/**
 * Truth-or-dare draw (Worker copy of server/truthDare.mjs).
 * Prompts are public on the room snapshot (no SeatPrivate).
 * Bank is local JSON — keep in sync with src/games/truthDare/prompts.json.
 */
import PROMPTS from './prompts.json'

export { PROMPTS }
export const RECENT_K = 8

export function allPrompts(bank = PROMPTS) {
  return Array.isArray(bank.prompts) ? bank.prompts : []
}

export function publicPrompt(entry) {
  return {
    id: entry.id,
    displayType: entry.type === 'dare' ? 'dare' : 'truth',
    text: entry.text,
  }
}

function usable(entry) {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    !!entry.id.trim() &&
    typeof entry.text === 'string' &&
    !!entry.text.trim() &&
    (entry.type === 'truth' || entry.type === 'dare')
  )
}

export function pickPrompt({
  recentIds = [],
  previousId = '',
  previousText = '',
  mustChange = false,
  bank = PROMPTS,
  rng = Math.random,
  k = RECENT_K,
} = {}) {
  const ids = (recentIds || []).filter((id) => typeof id === 'string' && id)
  const pool = allPrompts(bank).filter(usable)
  if (!pool.length) return null

  const blocked = new Set(ids.slice(-k))
  if (mustChange && previousId) blocked.add(previousId)

  const eligible = (p) => {
    if (blocked.has(p.id)) return false
    if (mustChange && previousText && p.text === previousText) return false
    return true
  }

  let candidates = pool.filter(eligible)
  if (!candidates.length && mustChange) {
    candidates = pool.filter((p) => p.id !== previousId && p.text !== previousText)
  }
  if (!candidates.length) {
    candidates = pool.filter((p) => p.id !== previousId)
  }
  if (!candidates.length) candidates = pool

  const picked = candidates[Math.floor(rng() * candidates.length)] || candidates[0]
  if (!picked) return null
  return {
    prompt: publicPrompt(picked),
    recentPromptIds: [...ids, picked.id].slice(-k),
  }
}
