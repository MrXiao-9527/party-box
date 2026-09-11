/**
 * Room API facade: relay when VITE_RELAY_URL is set, else localStorage.
 * Mutations cache into localStorage so existing UI/useRoom keep working.
 */

import {
  claimHostSeat as localClaimHostSeat,
  createEmptyHostRoom as localCreateEmptyHostRoom,
  deleteRoom as localDeleteRoom,
  fillSeatsToMax as localFillSeatsToMax,
  joinRoom as localJoinRoom,
  loadRoom,
  loadCreateSettings,
  pickNewHost as localPickNewHost,
  restoreSeat as localRestoreSeat,
  resumeAsHost as localResumeAsHost,
  saveSession,
  setMemberConnected as localSetMemberConnected,
  setPhase as localSetPhase,
  type PersistedRoom,
  type Session,
} from '../store/localRoom'
import type { Phase, RoomCreateInput } from '../types'
import { ACK_REASONS } from '../types'
import {
  clearHadSeat,
  loadIdentity,
  saveIdentity,
} from './seatRestore'
import {
  isRelayEnabled,
  notifyRoomUpdate,
  RelayNetworkError,
  relayClaimHostSeat,
  relayCreateEmptyHostRoom,
  relayDeleteRoom,
  relayFillSeatsToMax,
  relayGetRoom,
  relayJoinRoom,
  relayPickNewHost,
  relayRestoreSeat,
  relayResumeAsHost,
  relaySetMemberConnected,
  relaySetPhase,
} from './relayClient'

export { isRelayEnabled, loadRoom, RelayNetworkError }

export type SyncRoomResult =
  | { status: 'ok'; data: PersistedRoom }
  | { status: 'missing' }
  | { status: 'network' }

/** True if this browser had joined / cached a seat in this room (not a cold GET). */
export function wasInRoomLocally(roomCode: string): boolean {
  const code = roomCode.toUpperCase()
  try {
    const sessionRaw = localStorage.getItem('party-box:session')
    if (sessionRaw) {
      const session = JSON.parse(sessionRaw) as Session
      if (session?.roomCode?.toUpperCase() === code && session.seatId) return true
    }
  } catch {
    /* ignore */
  }
  const id = loadIdentity()
  if (id && id.roomCode.toUpperCase() === code) return true
  try {
    return localStorage.getItem(`party-box:had-seat:${code}`) !== null
  } catch {
    return false
  }
}

/**
 * Drop zombie local lobby after relay 404 / wipe.
 * Does not call remote DELETE (room already gone).
 */
export function clearLocalRoomArtifacts(roomCode: string): void {
  const code = roomCode.toUpperCase()
  localDeleteRoom(code)
  clearHadSeat(code)
  try {
    const sessionRaw = localStorage.getItem('party-box:session')
    if (sessionRaw) {
      const session = JSON.parse(sessionRaw) as Session
      if (session?.roomCode?.toUpperCase() === code) {
        saveSession(null)
      }
    }
  } catch {
    /* ignore */
  }
  const id = loadIdentity()
  if (id && id.roomCode.toUpperCase() === code) {
    saveIdentity(null, code)
  }
  notifyRoomUpdate(code, null)
}

/** Toast when relay room is gone: restart copy if we were seated, else missing. */
export function roomGoneToast(roomCode: string): string {
  return wasInRoomLocally(roomCode)
    ? ACK_REASONS.RELAY_RESTARTED
    : ACK_REASONS.ROOM_MISSING
}

/** Pull shared room into localStorage. Distinguishes missing vs network. */
export async function syncRoomFromRelay(
  roomCode: string,
): Promise<SyncRoomResult> {
  if (!isRelayEnabled()) {
    const local = loadRoom(roomCode)
    return local ? { status: 'ok', data: local } : { status: 'missing' }
  }
  try {
    const remote = await relayGetRoom(roomCode)
    if (remote) return { status: 'ok', data: remote }
    return { status: 'missing' }
  } catch (e) {
    if (e instanceof RelayNetworkError) return { status: 'network' }
    return { status: 'network' }
  }
}

export function syncStatusToast(status: SyncRoomResult['status']): string | null {
  if (status === 'missing') return ACK_REASONS.ROOM_MISSING
  if (status === 'network') return ACK_REASONS.RELAY_UNREACHABLE
  return null
}

export async function createEmptyHostRoom(
  input: RoomCreateInput = {},
): Promise<{ session: Session; data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localCreateEmptyHostRoom(input)
  const result = await relayCreateEmptyHostRoom(input)
  if ('error' in result) return result
  saveSession(result.session)
  return result
}

export async function claimHostSeat(
  roomCode: string,
  seatId: string,
  name: string,
): Promise<PersistedRoom | null> {
  if (!isRelayEnabled()) return localClaimHostSeat(roomCode, seatId, name)
  const data = await relayClaimHostSeat(
    roomCode,
    seatId,
    name,
    loadCreateSettings(roomCode),
  )
  if (data) saveSession({ seatId, name, roomCode: data.room.roomCode })
  return data
}

export async function joinRoom(
  roomCode: string,
  name: string,
): Promise<{ session: Session; data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localJoinRoom(roomCode, name)
  return relayJoinRoom(roomCode, name)
}

export async function setPhase(
  roomCode: string,
  phase: Phase,
): Promise<PersistedRoom | null> {
  if (!isRelayEnabled()) return localSetPhase(roomCode, phase)
  return relaySetPhase(roomCode, phase, loadCreateSettings(roomCode))
}

export async function setMemberConnected(
  roomCode: string,
  seatId: string,
  connected: boolean,
): Promise<PersistedRoom | null> {
  if (!isRelayEnabled()) {
    return localSetMemberConnected(roomCode, seatId, connected)
  }
  return relaySetMemberConnected(roomCode, seatId, connected)
}

export async function resumeAsHost(
  roomCode: string,
  hostSeatId: string,
): Promise<PersistedRoom | null> {
  if (!isRelayEnabled()) return localResumeAsHost(roomCode, hostSeatId)
  return relayResumeAsHost(roomCode, hostSeatId)
}

export async function pickNewHost(
  roomCode: string,
  newHostSeatId: string,
): Promise<PersistedRoom | { error: string }> {
  if (!isRelayEnabled()) return localPickNewHost(roomCode, newHostSeatId)
  return relayPickNewHost(roomCode, newHostSeatId)
}

export async function fillSeatsToMax(
  roomCode: string,
): Promise<PersistedRoom | { error: string }> {
  if (!isRelayEnabled()) return localFillSeatsToMax(roomCode)
  return relayFillSeatsToMax(roomCode)
}

export async function restoreSeat(
  roomCode: string,
  seatId: string,
): Promise<PersistedRoom | null> {
  if (!isRelayEnabled()) return localRestoreSeat(roomCode, seatId)
  return relayRestoreSeat(roomCode, seatId)
}

export async function deleteRoom(roomCode: string): Promise<void> {
  localDeleteRoom(roomCode)
  if (isRelayEnabled()) {
    try {
      await relayDeleteRoom(roomCode)
    } catch {
      /* ignore */
    }
  }
}
