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
  pickNewHost as localPickNewHost,
  restoreSeat as localRestoreSeat,
  resumeAsHost as localResumeAsHost,
  saveSession,
  setMemberConnected as localSetMemberConnected,
  setPhase as localSetPhase,
  type PersistedRoom,
  type Session,
} from '../store/localRoom'
import type { Phase } from '../types'
import { ACK_REASONS } from '../types'
import {
  isRelayEnabled,
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

export async function createEmptyHostRoom(): Promise<{
  session: Session
  data: PersistedRoom
}> {
  if (!isRelayEnabled()) return localCreateEmptyHostRoom()
  const result = await relayCreateEmptyHostRoom()
  saveSession(result.session)
  return result
}

export async function claimHostSeat(
  roomCode: string,
  seatId: string,
  name: string,
): Promise<PersistedRoom | null> {
  if (!isRelayEnabled()) return localClaimHostSeat(roomCode, seatId, name)
  const data = await relayClaimHostSeat(roomCode, seatId, name)
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
  return relaySetPhase(roomCode, phase)
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
