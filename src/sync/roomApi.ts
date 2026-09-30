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
  loadSession,
  pickNewHost as localPickNewHost,
  restoreSeat as localRestoreSeat,
  resumeAsHost as localResumeAsHost,
  saveSession,
  setMemberConnected as localSetMemberConnected,
  setPhase as localSetPhase,
  startUndercover as localStartUndercover,
  revealUndercover as localRevealUndercover,
  nextRoundUndercover as localNextRoundUndercover,
  speakDoneUndercover as localSpeakDoneUndercover,
  castVoteUndercover as localCastVoteUndercover,
  getSeatPrivate as localGetSeatPrivate,
  drawPrompt as localDrawPrompt,
  redrawPrompt as localRedrawPrompt,
  skipDrawer as localSkipDrawer,
  setDrawer as localSetDrawer,
  setAnswerer as localSetAnswerer,
  advancePrompt as localAdvancePrompt,
  startMissCard as localStartMissCard,
  drawMissCard as localDrawMissCard,
  pickMissTarget as localPickMissTarget,
  completeMissTurn as localCompleteMissTurn,
  setMissKCups as localSetMissKCups,
  applyMissK as localApplyMissK,
  spendMissToilet as localSpendMissToilet,
  reshuffleMissCard as localReshuffleMissCard,
  endMissCard as localEndMissCard,
  tweakWerewolfBoard as localTweakWerewolfBoard,
  resetWerewolfBoard as localResetWerewolfBoard,
  dealWerewolf as localDealWerewolf,
  redealWerewolf as localRedealWerewolf,
  setWerewolfStage as localSetWerewolfStage,
  type PersistedRoom,
  type Session,
} from '../store/localRoom'
import type { SeatPrivate } from '../games/undercover/deal'
import type { WerewolfSeatPrivate } from '../games/werewolfDeal/roles'
import type { Phase, RoomCreateInput, WerewolfBoard, WerewolfDealStage } from '../types'
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
  relayStartUndercover,
  relayRevealUndercover,
  relayNextRoundUndercover,
  relaySpeakDoneUndercover,
  relayCastVoteUndercover,
  relayGetSeatPrivate,
  relayDrawPrompt,
  relayRedrawPrompt,
  relaySkipDrawer,
  relaySetDrawer,
  relaySetAnswerer,
  relayAdvancePrompt,
  relayStartMissCard,
  relayDrawMissCard,
  relayPickMissTarget,
  relayCompleteMissTurn,
  relaySetMissKCups,
  relayApplyMissK,
  relayUseMissToilet,
  relayReshuffleMissCard,
  relayEndMissCard,
  relayTweakWerewolfBoard,
  relayResetWerewolfBoard,
  relayDealWerewolf,
  relayRedealWerewolf,
  relaySetWerewolfStage,
} from './relayClient'

type AnySeatPrivate = SeatPrivate | WerewolfSeatPrivate

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
  if (data) {
    const prev = loadSession()
    saveSession({
      seatId,
      name,
      roomCode: data.room.roomCode,
      seatToken: prev?.seatToken,
    })
  }
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
  fromSeatId: string,
): Promise<PersistedRoom | { error: string }> {
  if (!isRelayEnabled()) {
    return localPickNewHost(roomCode, newHostSeatId, fromSeatId)
  }
  return relayPickNewHost(roomCode, newHostSeatId, fromSeatId)
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

export async function startUndercover(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<
  | { data: PersistedRoom; private: SeatPrivate | null }
  | { error: string }
> {
  if (!isRelayEnabled()) return localStartUndercover(roomCode, fromSeatId, seatToken)
  return relayStartUndercover(roomCode, fromSeatId, seatToken)
}

export async function fetchSeatPrivate(
  roomCode: string,
  seatId: string,
  seatToken?: string,
): Promise<{ private: AnySeatPrivate | null; hasWord: boolean } | { error: string }> {
  if (!isRelayEnabled()) return localGetSeatPrivate(roomCode, seatId, seatToken)
  return relayGetSeatPrivate(roomCode, seatId, seatToken)
}

export async function revealUndercover(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localRevealUndercover(roomCode, fromSeatId, seatToken)
  return relayRevealUndercover(roomCode, fromSeatId, seatToken)
}

export async function nextRoundUndercover(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<
  | { data: PersistedRoom; private: SeatPrivate | null }
  | { error: string }
> {
  if (!isRelayEnabled()) {
    return localNextRoundUndercover(roomCode, fromSeatId, seatToken)
  }
  return relayNextRoundUndercover(roomCode, fromSeatId, seatToken)
}

export async function speakDoneUndercover(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localSpeakDoneUndercover(roomCode, fromSeatId, seatToken)
  }
  return relaySpeakDoneUndercover(roomCode, fromSeatId, seatToken)
}

export async function castVoteUndercover(
  roomCode: string,
  fromSeatId: string,
  seatToken: string | undefined,
  targetSeatId: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localCastVoteUndercover(roomCode, fromSeatId, seatToken, targetSeatId)
  }
  return relayCastVoteUndercover(roomCode, fromSeatId, seatToken, targetSeatId)
}

export async function drawPrompt(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
  mode: 'direct' | 'wheel' = 'direct',
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localDrawPrompt(roomCode, fromSeatId, seatToken, mode)
  }
  return relayDrawPrompt(roomCode, fromSeatId, seatToken, mode)
}

export async function redrawPrompt(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
  type?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localRedrawPrompt(roomCode, fromSeatId, seatToken, type)
  }
  return relayRedrawPrompt(roomCode, fromSeatId, seatToken, type)
}

export async function skipDrawer(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localSkipDrawer(roomCode, fromSeatId, seatToken)
  return relaySkipDrawer(roomCode, fromSeatId, seatToken)
}

export async function setDrawer(
  roomCode: string,
  fromSeatId: string,
  seatToken: string | undefined,
  seatId: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localSetDrawer(roomCode, fromSeatId, seatToken, seatId)
  }
  return relaySetDrawer(roomCode, fromSeatId, seatToken, seatId)
}

export async function setAnswerer(
  roomCode: string,
  fromSeatId: string,
  seatToken: string | undefined,
  seatId: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localSetAnswerer(roomCode, fromSeatId, seatToken, seatId)
  }
  return relaySetAnswerer(roomCode, fromSeatId, seatToken, seatId)
}

export async function advancePrompt(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localAdvancePrompt(roomCode, fromSeatId, seatToken)
  return relayAdvancePrompt(roomCode, fromSeatId, seatToken)
}

export async function startMissCard(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localStartMissCard(roomCode, fromSeatId, seatToken)
  return relayStartMissCard(roomCode, fromSeatId, seatToken)
}

export async function drawMissCard(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localDrawMissCard(roomCode, fromSeatId, seatToken)
  return relayDrawMissCard(roomCode, fromSeatId, seatToken)
}

export async function pickMissTarget(
  roomCode: string,
  fromSeatId: string,
  seatToken: string | undefined,
  targetSeatId: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localPickMissTarget(roomCode, fromSeatId, seatToken, targetSeatId)
  }
  return relayPickMissTarget(roomCode, fromSeatId, seatToken, targetSeatId)
}

export async function completeMissTurn(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localCompleteMissTurn(roomCode, fromSeatId, seatToken)
  return relayCompleteMissTurn(roomCode, fromSeatId, seatToken)
}

export async function setMissKCups(
  roomCode: string,
  fromSeatId: string,
  seatToken: string | undefined,
  cups: number,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localSetMissKCups(roomCode, fromSeatId, seatToken, cups)
  }
  return relaySetMissKCups(roomCode, fromSeatId, seatToken, cups)
}

export async function applyMissK(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localApplyMissK(roomCode, fromSeatId, seatToken)
  return relayApplyMissK(roomCode, fromSeatId, seatToken)
}

export async function spendMissToilet(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localSpendMissToilet(roomCode, fromSeatId, seatToken)
  return relayUseMissToilet(roomCode, fromSeatId, seatToken)
}

export async function reshuffleMissCard(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localReshuffleMissCard(roomCode, fromSeatId, seatToken)
  }
  return relayReshuffleMissCard(roomCode, fromSeatId, seatToken)
}

export async function endMissCard(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) return localEndMissCard(roomCode, fromSeatId, seatToken)
  return relayEndMissCard(roomCode, fromSeatId, seatToken)
}

export async function tweakWerewolfBoard(
  roomCode: string,
  fromSeatId: string,
  seatToken: string | undefined,
  board: WerewolfBoard,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localTweakWerewolfBoard(roomCode, fromSeatId, seatToken, board)
  }
  return relayTweakWerewolfBoard(roomCode, fromSeatId, seatToken, board)
}

export async function resetWerewolfBoard(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localResetWerewolfBoard(roomCode, fromSeatId, seatToken)
  }
  return relayResetWerewolfBoard(roomCode, fromSeatId, seatToken)
}

export async function dealWerewolf(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<
  | { data: PersistedRoom; private: AnySeatPrivate | null }
  | { error: string }
> {
  if (!isRelayEnabled()) return localDealWerewolf(roomCode, fromSeatId, seatToken)
  return relayDealWerewolf(roomCode, fromSeatId, seatToken)
}

export async function redealWerewolf(
  roomCode: string,
  fromSeatId: string,
  seatToken?: string,
): Promise<
  | { data: PersistedRoom; private: AnySeatPrivate | null }
  | { error: string }
> {
  if (!isRelayEnabled()) return localRedealWerewolf(roomCode, fromSeatId, seatToken)
  return relayRedealWerewolf(roomCode, fromSeatId, seatToken)
}

export async function setWerewolfStage(
  roomCode: string,
  fromSeatId: string,
  seatToken: string | undefined,
  stage: WerewolfDealStage,
): Promise<{ data: PersistedRoom } | { error: string }> {
  if (!isRelayEnabled()) {
    return localSetWerewolfStage(roomCode, fromSeatId, seatToken, stage)
  }
  return relaySetWerewolfStage(roomCode, fromSeatId, seatToken, stage)
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
