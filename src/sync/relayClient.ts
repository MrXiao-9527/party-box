/**
 * Shared room relay client (HTTP + WebSocket).
 * Enabled when VITE_RELAY_URL is set (e.g. http://127.0.0.1:45322).
 */

import type { ChipAck, ChipOp, Phase, TableSnapshot } from '../types'
import type { PersistedRoom, Session } from '../store/localRoom'
import { saveRoom } from '../store/localRoom'

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
  const res = await fetch(`${httpBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
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
  saveRoom(data)
  notifyRoomUpdate(data.room.roomCode, data)
  return data
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

export async function relayGetRoom(
  roomCode: string,
): Promise<PersistedRoom | null> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode.toUpperCase())}`,
  )
  if (!result.ok) return null
  return cache(result.body.data)
}

export async function relayCreateEmptyHostRoom(preferredSeatId?: string): Promise<{
  session: Session
  data: PersistedRoom
}> {
  const result = await api<{ session: Session; data: PersistedRoom }>('/rooms', {
    method: 'POST',
    body: JSON.stringify(preferredSeatId ? { seatId: preferredSeatId } : {}),
  })
  if (!result.ok) throw new Error('无法创建房间')
  cache(result.body.data)
  return result.body
}

export async function relayClaimHostSeat(
  roomCode: string,
  seatId: string,
  name: string,
): Promise<PersistedRoom | null> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode)}/claim-host`,
    {
      method: 'POST',
      body: JSON.stringify({ seatId, name }),
    },
  )
  if (!result.ok) return null
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
    const err =
      result.body &&
      typeof result.body === 'object' &&
      'error' in result.body &&
      typeof (result.body as { error: unknown }).error === 'string'
        ? (result.body as { error: string }).error
        : '房间不存在或已解散'
    return { error: err }
  }
  cache(result.body.data)
  return result.body
}

export async function relaySetPhase(
  roomCode: string,
  phase: Phase,
): Promise<PersistedRoom | null> {
  const result = await api<{ data: PersistedRoom }>(
    `/rooms/${encodeURIComponent(roomCode)}/phase`,
    { method: 'POST', body: JSON.stringify({ phase }) },
  )
  if (!result.ok) return null
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
    const err =
      result.body &&
      typeof result.body === 'object' &&
      'error' in result.body &&
      typeof (result.body as { error: unknown }).error === 'string'
        ? (result.body as { error: string }).error
        : '操作无效'
    return { error: err }
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
    const err =
      result.body &&
      typeof result.body === 'object' &&
      'error' in result.body &&
      typeof (result.body as { error: unknown }).error === 'string'
        ? (result.body as { error: string }).error
        : '房间不存在或已解散'
    return { error: err }
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
        if (msg.data) saveRoom(msg.data)
        notifyRoomUpdate(code, msg.data)
        onUpdate?.(msg.data)
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
