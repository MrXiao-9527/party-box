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
export const HISTORY_N = 5
export const PROMPTS = JSON.parse(readFileSync(BANK_PATH, 'utf8'))

export function allPrompts(bank = PROMPTS) {
  return Array.isArray(bank.prompts) ? bank.prompts : []
}

export function asTypeChoice(raw) {
  return raw === 'truth' || raw === 'dare' || raw === 'random' ? raw : null
}

export function publicPrompt(entry, extra = {}) {
  const prompt = {
    id: entry.id,
    displayType: entry.type === 'dare' ? 'dare' : 'truth',
    text: entry.text,
  }
  const typeChoice = asTypeChoice(extra.typeChoice)
  if (typeChoice) prompt.typeChoice = typeChoice
  return prompt
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

/** Seated + connected/online only. Next-draw / default-answer ring. */
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

/** Default answerer = next seated online after drawer (ring; solo → self). */
export function nextAnswererSeatId(members = [], drawerSeatId = '') {
  return nextDrawerSeatId(members, drawerSeatId)
}

export function isTruthDarePhase(raw) {
  return raw === 'idle' || raw === 'drawing' || raw === 'answering'
}

export function memberBySeat(members, seatId) {
  if (!seatId) return null
  return (members || []).find((m) => m && m.seatId === seatId) || null
}

export function promptHistoryOf(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    const displayType = item.displayType === 'dare' ? 'dare' : 'truth'
    if (!id || !text) continue
    const nick =
      typeof item.answererNickname === 'string' ? item.answererNickname.trim() : ''
    const answererSeatId =
      typeof item.answererSeatId === 'string' && item.answererSeatId.trim()
        ? item.answererSeatId.trim()
        : ''
    const closedAt =
      typeof item.closedAt === 'number' ? item.closedAt : Number(item.closedAt)
    out.push({
      id,
      displayType,
      text,
      answererSeatId,
      answererNickname: nick,
      redrawn: !!item.redrawn,
      closedAt: Number.isFinite(closedAt) && closedAt > 0 ? closedAt : 0,
    })
    if (out.length >= HISTORY_N) break
  }
  return out
}

export function appendPromptHistory(history, entry) {
  if (!entry || typeof entry !== 'object') return promptHistoryOf(history)
  return promptHistoryOf([entry, ...promptHistoryOf(history)])
}

export function nicknameOf(members, seatId) {
  const m = memberBySeat(members, seatId)
  return m && typeof m.name === 'string' ? m.name.trim() : ''
}

/**
 * Repair/migrate truthDare turn fields.
 * Old lobby snapshots: prompt → answering; else drawing when someone is online.
 * Drawing + offline drawer → next online. Answering + offline drawer → keep prompt.
 */
export function ensureTruthDareTurn(party, members = []) {
  if (!party || party.gameId !== 'truthDare') return party
  const prompt = party.prompt || null
  const recent = Array.isArray(party.recentPromptIds)
    ? party.recentPromptIds.filter((id) => typeof id === 'string' && id)
    : []
  const history = promptHistoryOf(party.promptHistory)
  const redrawUsedThisTurn = !!party.redrawUsedThisTurn
  const online = firstOnlineSeatId(members)
  let drawerSeatId =
    typeof party.drawerSeatId === 'string' && party.drawerSeatId
      ? party.drawerSeatId
      : null
  let answererSeatId =
    typeof party.answererSeatId === 'string' && party.answererSeatId
      ? party.answererSeatId
      : null

  let phase
  if (prompt) phase = 'answering'
  else if (online) phase = 'drawing'
  else phase = 'idle'

  if (online) {
    const drawerMember = memberBySeat(members, drawerSeatId)
    if (phase === 'drawing') {
      if (!drawerMember) drawerSeatId = online
      else if (!drawerMember.connected) {
        drawerSeatId = nextDrawerSeatId(members, drawerSeatId)
      }
    } else if (phase === 'answering') {
      if (!drawerMember) drawerSeatId = drawerSeatId || online
    }
  }

  if (phase === 'answering') {
    const answererMember = memberBySeat(members, answererSeatId)
    if (!answererSeatId || !answererMember) {
      answererSeatId =
        nextAnswererSeatId(members, drawerSeatId) || drawerSeatId
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
    redrawUsedThisTurn: phase === 'answering' ? redrawUsedThisTurn : false,
  }
  if (prompt && phase === 'answering') next.prompt = prompt
  if (recent.length) next.recentPromptIds = recent
  if (history.length) next.promptHistory = history
  return next
}

export function pickPrompt({
  recentIds = [],
  previousId = '',
  previousText = '',
  mustChange = false,
  type,
  typeChoice,
  bank = PROMPTS,
  rng = Math.random,
  k = RECENT_K,
} = {}) {
  const ids = (recentIds || []).filter((id) => typeof id === 'string' && id)
  const choice = asTypeChoice(type) || asTypeChoice(typeChoice)
  const want = choice === 'truth' || choice === 'dare' ? choice : null
  const pool = allPrompts(bank).filter(usable)
  if (!pool.length) return null
  const typed = want ? pool.filter((p) => p.type === want) : pool
  const source = typed.length ? typed : pool

  const blocked = new Set(ids.slice(-k))
  if (mustChange && previousId) blocked.add(previousId)

  const eligible = (p) => {
    if (blocked.has(p.id)) return false
    if (mustChange && previousText && p.text === previousText) return false
    return true
  }

  let candidates = source.filter(eligible)
  if (!candidates.length && mustChange) {
    candidates = source.filter((p) => p.id !== previousId && p.text !== previousText)
  }
  if (!candidates.length) {
    candidates = source.filter((p) => p.id !== previousId)
  }
  if (!candidates.length) candidates = source
  if (!candidates.length) candidates = pool

  const picked = candidates[Math.floor(rng() * candidates.length)] || candidates[0]
  if (!picked) return null
  const prompt = publicPrompt(picked, { typeChoice: choice || undefined })
  return {
    prompt,
    recentPromptIds: [...ids, picked.id].slice(-k),
  }
}
