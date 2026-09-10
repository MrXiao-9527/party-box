/**
 * Seat restore (PRD) — identity + dual-tab helpers.
 */

import type { Phase } from '../types'

export type SeatRole = 'host' | 'player'

/** localStorage identity shape (locked PRD). */
export interface SeatIdentity {
  roomCode: string
  seatId: string
  name: string
  role: SeatRole
}

export type RestoreDecision =
  | { kind: 'silent'; identity: SeatIdentity }
  | {
      kind: 'seat_taken'
      toast: string
      prefillName: string
      identity: SeatIdentity
    }
  | { kind: 'identity_lost'; toast: string }
  | { kind: 'fresh_join' }
  | { kind: 'room_gone'; toast: string }
  | {
      kind: 'other_tab'
      toast: string
      identity: SeatIdentity
    }

export const RESTORE_COPY = {
  SEAT_TAKEN: '原席被占，新坐一席',
  IDENTITY_LOST: '本地身份丢失，已为你新坐一席',
  ROOM_GONE: '房间已结束',
  OTHER_TAB: '该席已在其他标签打开',
  TAKEN_OVER: '已在其他标签接管',
} as const

export const IDENTITY_KEY = 'party-box:identity'
/** Room-scoped mark that this browser once held a seatId for the room. */
export const HAD_SEAT_PREFIX = 'party-box:had-seat:'
export const TAB_CHANNEL = 'party-box:seat-tab'

export interface TabMessage {
  type: 'claim' | 'kick' | 'ping' | 'pong'
  roomCode: string
  seatId: string
  tabId: string
}

export function hadSeatKey(roomCode: string): string {
  return `${HAD_SEAT_PREFIX}${roomCode.toUpperCase()}`
}

export function hasHadSeat(roomCode: string): boolean {
  try {
    return localStorage.getItem(hadSeatKey(roomCode)) !== null
  } catch {
    return false
  }
}

export function markHadSeat(roomCode: string): void {
  try {
    localStorage.setItem(hadSeatKey(roomCode), '1')
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearHadSeat(roomCode: string): void {
  try {
    localStorage.removeItem(hadSeatKey(roomCode))
  } catch {
    /* ignore */
  }
}

export function loadIdentity(): SeatIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SeatIdentity
    if (!parsed.roomCode || !parsed.seatId || !parsed.name) return null
    return {
      ...parsed,
      roomCode: parsed.roomCode.toUpperCase(),
    }
  } catch {
    return null
  }
}

/**
 * Persist identity. When clearing, pass `clearRoomCode` so the room-scoped
 * had-seat mark is removed (intentional leave / room ended → quiet rejoin).
 * Saving a seat marks the room; that mark survives a wiped identity key so
 * we can tell wipe vs never-joined.
 */
export function saveIdentity(
  identity: SeatIdentity | null,
  clearRoomCode?: string,
): void {
  if (!identity) {
    const prev = loadIdentity()
    const code = clearRoomCode ?? prev?.roomCode
    if (code) clearHadSeat(code)
    localStorage.removeItem(IDENTITY_KEY)
    return
  }
  const prev = loadIdentity()
  if (
    prev &&
    prev.roomCode.toUpperCase() !== identity.roomCode.toUpperCase()
  ) {
    clearHadSeat(prev.roomCode)
  }
  markHadSeat(identity.roomCode)
  localStorage.setItem(
    IDENTITY_KEY,
    JSON.stringify({
      ...identity,
      roomCode: identity.roomCode.toUpperCase(),
    }),
  )
}

export interface RestoreRoomView {
  roomCode: string
  hostSeatId: string
  phase: Phase
  members: { seatId: string; name: string; connected: boolean }[]
  seats: { seatId: string; name: string }[]
}

/**
 * Pure restore decision for /r/:code or refresh.
 * Dual-tab "other_tab" is detected separately via BroadcastChannel.
 *
 * `hadPriorSeat`: localStorage once had a seatId for this roomCode (room-scoped
 * mark). Without it, missing identity is a quiet first join — not identity_lost.
 */
export function decideRestore(args: {
  roomCode: string
  room: RestoreRoomView | null
  identity: SeatIdentity | null
  seatHeldByOtherTab: boolean
  hadPriorSeat?: boolean
}): RestoreDecision {
  const code = args.roomCode.toUpperCase()

  if (!args.room || args.room.roomCode.toUpperCase() !== code) {
    return { kind: 'room_gone', toast: RESTORE_COPY.ROOM_GONE }
  }

  const identity =
    args.identity && args.identity.roomCode.toUpperCase() === code
      ? args.identity
      : null

  if (!identity) {
    if (args.hadPriorSeat) {
      return { kind: 'identity_lost', toast: RESTORE_COPY.IDENTITY_LOST }
    }
    return { kind: 'fresh_join' }
  }

  if (args.seatHeldByOtherTab) {
    return {
      kind: 'other_tab',
      toast: RESTORE_COPY.OTHER_TAB,
      identity,
    }
  }

  const stillThere = args.room.members.some((m) => m.seatId === identity.seatId)
  if (stillThere) {
    return { kind: 'silent', identity }
  }

  // seatId recorded but seat row gone / replaced → treat as taken
  const nameTakenByOther = args.room.members.some(
    (m) => m.name === identity.name && m.seatId !== identity.seatId,
  )
  if (nameTakenByOther || !stillThere) {
    return {
      kind: 'seat_taken',
      toast: RESTORE_COPY.SEAT_TAKEN,
      prefillName: identity.name,
      identity,
    }
  }

  return { kind: 'identity_lost', toast: RESTORE_COPY.IDENTITY_LOST }
}

export function newTabId(): string {
  return `tab_${Math.random().toString(36).slice(2, 10)}`
}

/** Open BroadcastChannel for dual-tab seat claim/kick (no-op when unsupported). */
export function openSeatTabChannel(
  onMessage: (msg: TabMessage) => void,
): { post: (msg: TabMessage) => void; close: () => void } {
  if (typeof BroadcastChannel === 'undefined') {
    return { post: () => undefined, close: () => undefined }
  }
  const ch = new BroadcastChannel(TAB_CHANNEL)
  const handler = (ev: MessageEvent<TabMessage>) => {
    if (ev.data?.roomCode && ev.data?.seatId) onMessage(ev.data)
  }
  ch.addEventListener('message', handler)
  return {
    post: (msg) => ch.postMessage(msg),
    close: () => {
      ch.removeEventListener('message', handler)
      ch.close()
    },
  }
}
