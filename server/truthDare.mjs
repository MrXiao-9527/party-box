/**
 * Truth-or-dare draw. Prompts are public on the room snapshot (no SeatPrivate).
 * Bank: src/games/truthDare/prompts.json (self-authored; do not scrape).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BANK_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/games/truthDare/prompts.json',
)

export const RECENT_K = 8
export const PROMPTS = JSON.parse(readFileSync(BANK_PATH, 'utf8'))

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
