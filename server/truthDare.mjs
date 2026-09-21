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

export function onlineMembers(members = []) {
  return (members || []).filter(
    (m) => m && typeof m.seatId === 'string' && m.seatId && m.connected,
  )
}

export function firstOnlineSeatId(members = []) {
  return onlineMembers(members)[0]?.seatId || null
}

/** Next online seat after current, wrapping; full member order. */
export function nextDrawerSeatId(members = [], currentSeatId = '') {
  const seats = (members || []).filter(
    (m) => m && typeof m.seatId === 'string' && m.seatId,
  )
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

export function isTruthDarePhase(raw) {
  return raw === 'idle' || raw === 'drawing' || raw === 'answering'
}

function memberBySeat(members, seatId) {
  if (!seatId) return null
  return (members || []).find((m) => m && m.seatId === seatId) || null
}

/**
 * Repair/migrate truthDare turn fields.
 * Old lobby snapshots: prompt → answering; else drawing when someone is online.
 * Offline drawer → next online. Answering without prompt → drawing.
 */
export function ensureTruthDareTurn(party, members = []) {
  if (!party || party.gameId !== 'truthDare') return party
  const prompt = party.prompt || null
  const recent = Array.isArray(party.recentPromptIds)
    ? party.recentPromptIds.filter((id) => typeof id === 'string' && id)
    : []
  const online = firstOnlineSeatId(members)
  let drawerSeatId =
    typeof party.drawerSeatId === 'string' && party.drawerSeatId
      ? party.drawerSeatId
      : null
  let answererSeatId =
    typeof party.answererSeatId === 'string' && party.answererSeatId
      ? party.answererSeatId
      : null

  if (online) {
    const drawerMember = memberBySeat(members, drawerSeatId)
    if (!drawerMember) drawerSeatId = online
    else if (!drawerMember.connected) {
      drawerSeatId = nextDrawerSeatId(members, drawerSeatId)
    }
  }

  let phase
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

  const next = {
    gameId: 'truthDare',
    phase,
    drawerSeatId,
    answererSeatId,
  }
  if (prompt && phase === 'answering') next.prompt = prompt
  if (recent.length) next.recentPromptIds = recent
  return next
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
