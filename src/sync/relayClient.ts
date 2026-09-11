/**
 * Shared room relay client (HTTP + WebSocket).
 * Enabled when VITE_RELAY_URL is set (e.g. http://127.0.0.1:45322).
 */

import type { ChipAck, ChipOp, Phase, RoomCreateInput, TableSnapshot } from '../types'
import { ACK_REASONS } from '../types'
import type { PersistedRoom, Session } from '../store/localRoom'
import { saveCreateSettings, saveRoom } from '../store/localRoom'

export class RelayNetworkError extends Error {
  constructor(message = ACK_REASONS.RELAY_UNREACHABLE) {
    super(message)
    this.name = 'RelayNetworkError'
  }
}

export function getRelayBaseUrl(): string | null {
  const raw = (import.meta.env.VITE_RELAY_URL as string | undefined)?.trim()
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

export function isRelayEnabled(): boolean {
  return getRelayBaseUrl() !== null
}

function httpBase(): string {
  const base = getRelayBaseUrl()
  if (!base) throw new Error('relay disabled')
  return base
}

function wsBase(): string {
  const base = httpBase()
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}`
  if (base.startsWith('http://')) return `ws://${base.slice('http://'.length)}`
  if (base.startsWith('wss://') || base.startsWith('ws://')) return base
  return `ws://${base}`
}

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; body: T } | { ok: false; status: number; body: unknown }> {
  let res: Response
  try {
    res = await fetch(`${httpBase()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new RelayNetworkError()
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok) return { ok: false, status: res.status, body }
  return { ok: true, body: body as T }
}

function cache(data: PersistedRoom | null | undefined): PersistedRoom | null {
  if (!data) return null
  const normalized = saveRoom(data)
  notifyRoomUpdate(normalized.room.roomCode, normalized)
  return normalized
}

const ROOM_EVENT = 'party-box:relay-room'

export function notifyRoomUpdate(roomCode: string, data: PersistedRoom | null): void {
  window.dispatchEvent(
    new CustomEvent(ROOM_EVENT, {
      detail: { roomCode: roomCode.toUpperCase(), data },
    }),
  )
}

export function onRelayRoomUpdate(
  roomCode: string,
  handler: (data: PersistedRoom | null) => void,
): () => void {
  const code = roomCode.toUpperCase()
  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail as {
      roomCode: string
      data: PersistedRoom | null
    }
    if (detail.roomCode === code) handler(detail.data)
  }
  window.addEventListener(ROOM_EVENT, listener)
  return () => window.removeEventListener(ROOM_EVENT, listener)
}

function errorFromBody(
  body: unknown,
  fallback: string,
): string {
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'string'
  ) {
    return (body as { error: string }).error
  }
  return fallback
}

export async function relayGetRoom(
  roomCode: string,
): Promise<PersistedRoom | null> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode.toUpperCase())}`,
  )
  if (!result.ok) {
    if (result.status === 404) return null
    throw new RelayNetworkError()
  }
  return cache(result.body.data)
}

export async function relayCreateEmptyHostRoom(
  input: RoomCreateInput = {},
): Promise<{ session: Session; data: PersistedRoom } | { error: string }> {
  const result = await api<{ session: Session; data: PersistedRoom } | { error: string }>(
    '/rooms',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
  if (!result.ok) {
    if (result.status >= 500 || result.status === 0) {
      throw new RelayNetworkError()
    }
    return {
      error: errorFromBody(result.body, ACK_REASONS.RELAY_UNREACHABLE),
    }
  }
  if ('error' in result.body && result.body.error) {
    return { error: result.body.error }
  }
  const body = result.body as { session: Session; data: PersistedRoom }
  saveCreateSettings(body.session.roomCode, input)
  const cached = cache(body.data)
  return { session: body.session, data: cached ?? body.data }
}

export async function relayClaimHostSeat(
  roomCode: string,
  seatId: string,
  name: string,
  settings?: RoomCreateInput | null,
): Promise<PersistedRoom | null> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode)}/claim-host`,
    {
      method: 'POST',
      body: JSON.stringify({ seatId, name, ...(settings ?? {}) }),
    },
  )
  if (!result.ok) {
    if (result.status >= 500 || result.status === 0) {
      throw new RelayNetworkError()
    }
    return null
  }
  return cache(result.body.data)
}

export async function relayJoinRoom(
  roomCode: string,
  name: string,
): Promise<{ session: Session; data: PersistedRoom } | { error: string }> {
  const result = await api<{ session: Session; data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode)}/join`,
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
  )
  if (!result.ok) {
    // 404 → room truly missing; 5xx / empty → network; 400 → server reason (满座等)
    if (result.status === 404) {
      return {
        error: errorFromBody(result.body, ACK_REASONS.ROOM_MISSING),
      }
    }
    if (result.status >= 500 || result.status === 0) {
      return { error: ACK_REASONS.RELAY_UNREACHABLE }
    }
    return {
      error: errorFromBody(result.body, ACK_REASONS.RELAY_UNREACHABLE),
    }
  }
  cache(result.body.data)
  return result.body
}

export async function relaySetPhase(
  roomCode: string,
  phase: Phase,
  settings?: RoomCreateInput | null,
): Promise<PersistedRoom | null> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode)}/phase`,
    { method: 'POST', body: JSON.stringify({ phase, ...(settings ?? {}) }) },
  )
  if (!result.ok) {
    // Distinguish wipe/404 so UI can toast 「房间服务已重启，请重新开桌」.
    if (result.status === 404) {
      const err = new Error(ACK_REASONS.ROOM_MISSING) as Error & {
        code?: string
      }
      err.name = 'RelayRoomMissingError'
      err.code = 'ROOM_MISSING'
      throw err
    }
    return null
  }
  return cache(result.body.data)
}

export async function relaySetMemberConnected(
  roomCode: string,
  seatId: string,
  connected: boolean,
): Promise<PersistedRoom | null> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode)}/member-connected`,
    {
      method: 'POST',
      body: JSON.stringify({ seatId, connected }),
    },
  )
  if (!result.ok) return null
  return cache(result.body.data)
}

export async function relayResumeAsHost(
  roomCode: string,
  hostSeatId: string,
): Promise<PersistedRoom | null> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode)}/resume`,
    {
      method: 'POST',
      body: JSON.stringify({ hostSeatId }),
    },
  )
  if (!result.ok) return null
  return cache(result.body.data)
}

export async function relayPickNewHost(
  roomCode: string,
  newHostSeatId: string,
): Promise<PersistedRoom | { error: string }> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode)}/pick-host`,
    {
      method: 'POST',
      body: JSON.stringify({ newHostSeatId }),
    },
  )
  if (!result.ok) {
    if (result.status >= 500 || result.status === 0) {
      return { error: ACK_REASONS.RELAY_UNREACHABLE }
    }
    return {
      error: errorFromBody(result.body, ACK_REASONS.INVALID),
    }
  }
  return cache(result.body.data)!
}

export async function relayFillSeatsToMax(
  roomCode: string,
): Promise<PersistedRoom | { error: string }> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode)}/fill-seats`,
    { method: 'POST', body: '{}' },
  )
  if (!result.ok) {
    if (result.status === 404) {
      return {
        error: errorFromBody(result.body, ACK_REASONS.ROOM_MISSING),
      }
    }
    if (result.status >= 500 || result.status === 0) {
      return { error: ACK_REASONS.RELAY_UNREACHABLE }
    }
    return {
      error: errorFromBody(result.body, ACK_REASONS.RELAY_UNREACHABLE),
    }
  }
  return cache(result.body.data)!
}

export async function relayRestoreSeat(
  roomCode: string,
  seatId: string,
): Promise<PersistedRoom | null> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode)}/restore`,
    {
      method: 'POST',
      body: JSON.stringify({ seatId }),
    },
  )
  if (!result.ok) return null
  return cache(result.body.data)
}

export async function relayDeleteRoom(roomCode: string): Promise<void> {
  await api(`/rooms/${encodeURIComponent(roomCode)}`, { method: 'DELETE' })
  notifyRoomUpdate(roomCode, null)
}

export async function relaySendOp(
  op: ChipOp,
): Promise<{ ack: ChipAck; data: PersistedRoom | null }> {
  const result = await api<{ ack: ChipAck; data: PersistedRoom | null }>(
    `/rooms/${encodeURIComponent(op.roomCode)}/ops`,
    {
      method: 'POST',
      body: JSON.stringify(op),
    },
  )
  if (!result.ok) {
    return {
      ack: { opId: op.opId, ok: false, reason: '以桌主为准' },
      data: null,
    }
  }
  if (result.body.data) cache(result.body.data)
  return result.body
}

export async function relayRequestSnapshot(
  roomCode: string,
): Promise<TableSnapshot | null> {
  const data = await relayGetRoom(roomCode)
  return data?.table ?? null
}

/** Live room subscription; writes through to localStorage cache. */
export function subscribeRelayRoom(
  roomCode: string,
  onUpdate?: (data: PersistedRoom | null) => void,
): () => void {
  const code = roomCode.toUpperCase()
  let closed = false
  let ws: WebSocket | null = null
  let retryTimer = 0
  let attempt = 0

  const connect = () => {
    if (closed) return
    const url = `${wsBase()}/ws?room=${encodeURIComponent(code)}`
    ws = new WebSocket(url)
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type: string
          data: PersistedRoom | null
        }
        if (msg.type !== 'room') return
        if (msg.data) {
          const normalized = saveRoom(msg.data)
          notifyRoomUpdate(code, normalized)
          onUpdate?.(normalized)
        } else {
          notifyRoomUpdate(code, null)
          onUpdate?.(null)
        }
      } catch {
        /* ignore */
      }
    }
    ws.onopen = () => {
      attempt = 0
    }
    ws.onclose = () => {
      if (closed) return
      attempt += 1
      const delay = Math.min(8000, 400 * 2 ** Math.min(attempt, 4))
      retryTimer = window.setTimeout(connect, delay)
    }
    ws.onerror = () => {
      ws?.close()
    }
  }

  connect()

  return () => {
    closed = true
    window.clearTimeout(retryTimer)
    ws?.close()
  }
}
