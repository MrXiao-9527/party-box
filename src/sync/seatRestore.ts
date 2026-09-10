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
export const TAB_CHANNEL = 'party-box:seat-tab'

export interface TabMessage {
  type: 'claim' | 'kick' | 'ping' | 'pong'
  roomCode: string
  seatId: string
  tabId: string
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

export function saveIdentity(identity: SeatIdentity | null): void {
  if (!identity) {
    localStorage.removeItem(IDENTITY_KEY)
    return
  }
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
 */
export function decideRestore(args: {
  roomCode: string
  room: RestoreRoomView | null
  identity: SeatIdentity | null
  seatHeldByOtherTab: boolean
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
    return { kind: 'identity_lost', toast: RESTORE_COPY.IDENTITY_LOST }
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
