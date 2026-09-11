import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ToastStack } from '../components/Toast'
import { DevPanel } from '../components/DevPanel'
import { useRoom } from '../sync/useRoom'
import { NicknameGate } from './Nickname'
import { Lobby } from './Lobby'
import { ChipTable } from './ChipTable'
import { PausedTable } from './PausedTable'
import {
  loadRoom,
  loadSession,
  saveSession,
  type PersistedRoom,
  type Session,
} from '../store/localRoom'
import {
  deleteRoom,
  isRelayEnabled,
  restoreSeat,
  setMemberConnected,
  syncRoomFromRelay,
  clearLocalRoomArtifacts,
  wasInRoomLocally,
} from '../sync/roomApi'
import { setFlashToast } from '../sync/flashToast'
import { ACK_REASONS, MAX_SEATS, parseRoomCode } from '../types'
import {
  decideRestore,
  hasHadSeat,
  invalidateStoredSeatId,
  loadIdentity,
  newTabId,
  openSeatTabChannel,
  RESTORE_COPY,
  roleForSeat,
  saveIdentity,
  type SeatIdentity,
  type TabMessage,
} from '../sync/seatRestore'

type GateMode =
  | { type: 'booting' }
  | { type: 'nick'; prefill?: string; notice?: string }
  | { type: 'takeover'; identity: SeatIdentity }
  | { type: 'blocked'; reason: 'full' }
  | { type: 'ready' }
  | { type: 'gone' }

function identityFromSession(session: Session, isHost: boolean): SeatIdentity {
  return {
    roomCode: session.roomCode.toUpperCase(),
    seatId: session.seatId,
    name: session.name,
    role: isHost ? 'host' : 'player',
  }
}

function isTableFull(memberCount: number): boolean {
  return memberCount >= MAX_SEATS
}

export function RoomPage() {
  const { roomCode: raw } = useParams()
  const navigate = useNavigate()
  const parsed = useMemo(() => parseRoomCode(raw ?? ''), [raw])
  const roomCode = parsed.ok ? parsed.code : undefined
  const roomApi = useRoom(roomCode)

  const [gate, setGate] = useState<GateMode>({ type: 'booting' })
  const [readOnly, setReadOnly] = useState(false)
  const tabIdRef = useRef(newTabId())
  const channelRef = useRef<ReturnType<typeof openSeatTabChannel> | null>(null)
  const holdingSeatRef = useRef<string | null>(null)
  const readOnlyRef = useRef(false)

  const setTabReadOnly = (next: boolean) => {
    readOnlyRef.current = next
    setReadOnly(next)
  }

  // BroadcastChannel: claim / kick / ping-pong for dual-tab
  useEffect(() => {
    if (!roomCode) return
    const ch = openSeatTabChannel((msg: TabMessage) => {
      if (msg.roomCode !== roomCode) return
      if (msg.tabId === tabIdRef.current) return

      if (
        msg.type === 'ping' &&
        holdingSeatRef.current === msg.seatId &&
        !readOnlyRef.current
      ) {
        ch.post({
          type: 'pong',
          roomCode,
          seatId: msg.seatId,
          tabId: tabIdRef.current,
        })
      }
      if (
        msg.type === 'kick' &&
        holdingSeatRef.current === msg.seatId &&
        !readOnlyRef.current
      ) {
        setTabReadOnly(true)
        holdingSeatRef.current = null
        roomApi.pushToast(RESTORE_COPY.TAKEN_OVER)
      }
    })
    channelRef.current = ch
    return () => ch.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode])

  // Restore decision on enter / refresh
  useEffect(() => {
    if (!parsed.ok) {
      roomApi.pushToast(parsed.reason)
      navigate('/', { replace: true })
      return
    }
    if (!roomCode) return

    // Prefer identity key; fall back to session for same room (refresh resilience).
    const storedIdentity = loadIdentity()
    const storedSession = loadSession()
    const identity: SeatIdentity | null =
      storedIdentity && storedIdentity.roomCode.toUpperCase() === roomCode
        ? storedIdentity
        : storedSession &&
            storedSession.roomCode.toUpperCase() === roomCode &&
            storedSession.seatId &&
            storedSession.name
          ? {
              roomCode,
              seatId: storedSession.seatId,
              name: storedSession.name,
              role: 'player',
            }
          : null

    // Probe other tabs for same seat before silent restore
    const probeOtherTab = (seatId: string): Promise<boolean> =>
      new Promise((resolve) => {
        let answered = false
        const ch = openSeatTabChannel((msg) => {
          if (
            msg.type === 'pong' &&
            msg.roomCode === roomCode &&
            msg.seatId === seatId &&
            msg.tabId !== tabIdRef.current
          ) {
            answered = true
            resolve(true)
            ch.close()
          }
        })
        ch.post({
          type: 'ping',
          roomCode,
          seatId,
          tabId: tabIdRef.current,
        })
        window.setTimeout(() => {
          if (!answered) {
            ch.close()
            resolve(false)
          }
        }, 280)
      })

    const enterNickForNewSeat = (prefill?: string, notice?: string) => {
      // Invalidate old seatId in localStorage before allocating a new one.
      invalidateStoredSeatId(roomCode)
      saveSession(null)
      setGate({ type: 'nick', prefill, notice })
    }

    const bindSilentSeat = (data: PersistedRoom, id: SeatIdentity) => {
      const member = data.room.members.find((m) => m.seatId === id.seatId)
      const session: Session = {
        seatId: id.seatId,
        name: member?.name ?? id.name,
        roomCode,
      }
      const nextIdentity: SeatIdentity = {
        roomCode,
        seatId: session.seatId,
        name: session.name,
        role: roleForSeat(data.room.hostSeatId, session.seatId),
      }
      saveSession(session)
      saveIdentity(nextIdentity)
      roomApi.bindSession(session)
      // Host TableSnapshot wins: balances + phase (paused stays paused).
      roomApi.setPersisted(data)
      setTabReadOnly(false)
      holdingSeatRef.current = session.seatId
      channelRef.current?.post({
        type: 'claim',
        roomCode,
        seatId: session.seatId,
        tabId: tabIdRef.current,
      })
      setGate({ type: 'ready' })
    }

    const run = async () => {
      // Capture before await — WS null may clear local during sync.
      const hadLocal = wasInRoomLocally(roomCode)
      // Cross-device: pull shared RoomState before restore / nick gate.
      // Never fall back to localStorage when relay says missing — that is the
      // zombie「等候开桌」path after Node remount without durable restore.
      const synced = await syncRoomFromRelay(roomCode)
      if (synced.status === 'network') {
        roomApi.pushToast(ACK_REASONS.RELAY_UNREACHABLE)
        navigate('/', { replace: true })
        setGate({ type: 'gone' })
        return
      }
      if (synced.status === 'missing') {
        const toast = !isRelayEnabled()
          ? RESTORE_COPY.ROOM_GONE
          : hadLocal
            ? ACK_REASONS.RELAY_RESTARTED
            : ACK_REASONS.ROOM_MISSING
        clearLocalRoomArtifacts(roomCode)
        setFlashToast(toast)
        roomApi.pushToast(toast)
        saveIdentity(null, roomCode)
        navigate('/', { replace: true })
        setGate({ type: 'gone' })
        return
      }
      const roomDataNow = synced.data
      const roomViewNow = roomDataNow
        ? {
            roomCode: roomDataNow.room.roomCode,
            hostSeatId: roomDataNow.room.hostSeatId,
            phase: roomDataNow.room.phase,
            members: roomDataNow.room.members,
            seats: roomDataNow.table.seats,
          }
        : null

      const blockIfFullNow = (): boolean => {
        if (!roomDataNow || !isTableFull(roomDataNow.room.members.length)) {
          return false
        }
        invalidateStoredSeatId(roomCode)
        saveSession(null)
        roomApi.pushToast(RESTORE_COPY.TABLE_FULL)
        setGate({ type: 'blocked', reason: 'full' })
        return true
      }

      // Fresh「开一桌」pending host claim (empty members + empty-name session)
      if (
        roomDataNow &&
        roomDataNow.room.members.length === 0 &&
        !identity
      ) {
        setGate({ type: 'nick' })
        return
      }

      if (!roomDataNow) {
        roomApi.pushToast(RESTORE_COPY.ROOM_GONE)
        saveIdentity(null, roomCode)
        navigate('/', { replace: true })
        setGate({ type: 'gone' })
        return
      }

      let seatHeldByOtherTab = false
      if (identity?.seatId) {
        seatHeldByOtherTab = await probeOtherTab(identity.seatId)
      }

      const decision = decideRestore({
        roomCode,
        room: roomViewNow,
        identity,
        seatHeldByOtherTab,
        hadPriorSeat: hasHadSeat(roomCode),
      })

      if (decision.kind === 'room_gone') {
        roomApi.pushToast(decision.toast)
        saveIdentity(null, roomCode)
        navigate('/', { replace: true })
        setGate({ type: 'gone' })
        return
      }

      if (decision.kind === 'other_tab') {
        setGate({ type: 'takeover', identity: decision.identity })
        roomApi.pushToast(decision.toast)
        return
      }

      if (decision.kind === 'silent') {
        // Acceptance: silent reseat + host TableSnapshot balances + phase.
        // Paused host: restoreSeat leaves phase=paused / connected=false —
        // never auto「重开一桌」/ resumeTable.
        let data: PersistedRoom | null = null
        try {
          data = await restoreSeat(roomCode, decision.identity.seatId)
        } catch {
          data = null
        }
        // Sync already proved seat is still ours — do not drop to nick if
        // /restore blips. Bind the synced host snapshot; reconnect best-effort
        // (skipped for paused host so UI stays「桌主已离开 · 桌子已暂停」).
        if (
          !data &&
          roomDataNow.room.members.some(
            (m) => m.seatId === decision.identity.seatId,
          )
        ) {
          data = roomDataNow
          const pausedHost =
            roomDataNow.room.phase === 'paused' &&
            decision.identity.seatId === roomDataNow.room.hostSeatId
          if (!pausedHost) {
            void setMemberConnected(
              roomCode,
              decision.identity.seatId,
              true,
            ).then((next) => {
              if (next) roomApi.setPersisted(next)
            })
          }
        }
        if (data) {
          bindSilentSeat(data, decision.identity)
          return
        }
        // Seat gone between sync and restore → occupied
        if (blockIfFullNow()) return
        roomApi.pushToast(RESTORE_COPY.SEAT_TAKEN)
        enterNickForNewSeat(decision.identity.name, RESTORE_COPY.SEAT_TAKEN)
        return
      }

      if (decision.kind === 'seat_taken') {
        // Occupied + full → only「本桌已满（最多8人）」; do not enter nick / new seat.
        if (blockIfFullNow()) return
        roomApi.pushToast(decision.toast)
        enterNickForNewSeat(decision.prefillName, decision.toast)
        return
      }

      if (decision.kind === 'fresh_join') {
        setGate({ type: 'nick' })
        return
      }

      // identity_lost — prior seat mark exists but identity key is gone
      if (blockIfFullNow()) return
      roomApi.pushToast(decision.toast)
      enterNickForNewSeat(undefined, decision.toast)
    }

    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode])

  // Mid-session relay wipe: leave page (toast already from useRoom).
  // FORBIDDEN: stay on zombie「等候开桌」with dead 开桌.
  useEffect(() => {
    if (gate.type !== 'ready' || !roomCode) return
    if (roomApi.room) return
    // Still booting into ready — room apply may lag one frame.
    if (roomApi.session?.roomCode?.toUpperCase() === roomCode) return
    setGate({ type: 'gone' })
    navigate('/', { replace: true })
  }, [gate.type, roomCode, roomApi.room, roomApi.session, navigate])

  const claimHold = (session: Session) => {
    holdingSeatRef.current = session.seatId
    setTabReadOnly(false)
    channelRef.current?.post({
      type: 'claim',
      roomCode: session.roomCode.toUpperCase(),
      seatId: session.seatId,
      tabId: tabIdRef.current,
    })
  }

  const onNickReady = (
    session: Session,
    data: Parameters<typeof roomApi.setPersisted>[0],
  ) => {
    const isHost = data.room.hostSeatId === session.seatId
    saveIdentity(identityFromSession(session, isHost))
    roomApi.bindSession(session)
    roomApi.setPersisted(data)
    claimHold(session)
    setGate({ type: 'ready' })
  }

  const takeover = () => {
    if (gate.type !== 'takeover' || !roomCode) return
    const id = gate.identity
    channelRef.current?.post({
      type: 'kick',
      roomCode,
      seatId: id.seatId,
      tabId: tabIdRef.current,
    })
    void (async () => {
      const data = await restoreSeat(roomCode, id.seatId)
      if (!data) {
        const roomNow = loadRoom(roomCode)
        if (roomNow && isTableFull(roomNow.room.members.length)) {
          invalidateStoredSeatId(roomCode)
          saveSession(null)
          roomApi.pushToast(RESTORE_COPY.TABLE_FULL)
          setGate({ type: 'blocked', reason: 'full' })
          return
        }
        roomApi.pushToast(RESTORE_COPY.SEAT_TAKEN)
        invalidateStoredSeatId(roomCode)
        saveSession(null)
        setGate({ type: 'nick', prefill: id.name, notice: RESTORE_COPY.SEAT_TAKEN })
        return
      }
      const member = data.room.members.find((m) => m.seatId === id.seatId)
      const session: Session = {
        seatId: id.seatId,
        name: member?.name ?? id.name,
        roomCode,
      }
      const nextIdentity: SeatIdentity = {
        roomCode,
        seatId: session.seatId,
        name: session.name,
        role: roleForSeat(data.room.hostSeatId, session.seatId),
      }
      saveSession(session)
      saveIdentity(nextIdentity)
      roomApi.bindSession(session)
      roomApi.setPersisted(data)
      claimHold(session)
      setGate({ type: 'ready' })
    })()
  }

  const tryNewSeatFromTakeover = () => {
    if (gate.type !== 'takeover' || !roomCode) return
    const roomNow = loadRoom(roomCode)
    if (roomNow && isTableFull(roomNow.room.members.length)) {
      invalidateStoredSeatId(roomCode)
      saveSession(null)
      roomApi.pushToast(RESTORE_COPY.TABLE_FULL)
      setGate({ type: 'blocked', reason: 'full' })
      return
    }
    const name = gate.identity.name
    invalidateStoredSeatId(roomCode)
    saveSession(null)
    roomApi.pushToast(RESTORE_COPY.SEAT_TAKEN)
    setGate({ type: 'nick', prefill: name, notice: RESTORE_COPY.SEAT_TAKEN })
  }

  if (gate.type === 'booting' || gate.type === 'gone') {
    return <div className="page" />
  }

  if (!roomCode) {
    return (
      <div className="page">
        <p className="error">房码无效</p>
      </div>
    )
  }

  /** Active host exit may dissolve the room; read-only only clears local identity. */
  const exitLocalIdentity = () => {
    roomApi.markLeaving()
    saveIdentity(null, roomCode)
    roomApi.clearSession()
    roomApi.setOffline(false)
    holdingSeatRef.current = null
    setTabReadOnly(false)
    navigate('/')
  }

  const exitRoom = () => {
    if (readOnly) {
      exitLocalIdentity()
      return
    }
    roomApi.markLeaving()
    if (roomApi.isHost) void deleteRoom(roomCode)
    exitLocalIdentity()
  }

  const guardedOp: typeof roomApi.submitOp = (...args) => {
    if (readOnlyRef.current || readOnly) {
      roomApi.pushToast(RESTORE_COPY.TAKEN_OVER)
      return Promise.resolve()
    }
    return roomApi.submitOp(...args)
  }

  const denyIfReadOnly = (fn: () => void) => () => {
    if (readOnlyRef.current || readOnly) {
      roomApi.pushToast(RESTORE_COPY.TAKEN_OVER)
      return
    }
    fn()
  }

  const debug =
    roomApi.room && !readOnly ? (
      <DevPanel
        onHostPause={roomApi.signalHostDisconnect}
        onFillSeats={roomApi.fillSeats}
        onToggleOffline={() =>
          roomApi.setOffline(roomApi.connectionState !== 'offline')
        }
        connectionState={roomApi.connectionState}
        seatCount={roomApi.room.members.length}
        maxSeats={roomApi.room.maxSeats ?? MAX_SEATS}
      />
    ) : null

  if (gate.type === 'blocked') {
    return (
      <div className="page nickname">
        <ToastStack toasts={roomApi.toasts} onDismiss={roomApi.dismissToast} />
        <div className="nickname-card">
          <p className="eyebrow">房间 {roomCode}</p>
          <h1>{RESTORE_COPY.TABLE_FULL}</h1>
          <p className="hint">原席不可用且本桌已满，无法新坐一席。</p>
          <button
            type="button"
            className="btn primary wide"
            onClick={() => {
              saveIdentity(null, roomCode)
              roomApi.clearSession()
              navigate('/')
            }}
          >
            回首页
          </button>
        </div>
      </div>
    )
  }

  if (gate.type === 'takeover') {
    return (
      <div className="page nickname">
        <ToastStack toasts={roomApi.toasts} onDismiss={roomApi.dismissToast} />
        <div className="nickname-card">
          <p className="eyebrow">房间 {roomCode}</p>
          <h1>{RESTORE_COPY.OTHER_TAB}</h1>
          <p className="hint">可接管此席继续，原标签将变为只读。</p>
          <button type="button" className="btn primary wide" onClick={takeover}>
            接管
          </button>
          <button
            type="button"
            className="btn ghost wide"
            onClick={tryNewSeatFromTakeover}
          >
            新坐一席
          </button>
        </div>
      </div>
    )
  }

  if (gate.type === 'nick') {
    return (
      <>
        <ToastStack toasts={roomApi.toasts} onDismiss={roomApi.dismissToast} />
        <NicknameGate
          key={`nick-${roomCode}-${gate.prefill ?? ''}`}
          roomCode={roomCode}
          prefillName={gate.prefill}
          onReady={onNickReady}
          onError={(msg) => roomApi.pushToast(msg)}
        />
      </>
    )
  }

  // ready — session must be bound by silent restore / nick / takeover.
  // Do NOT fall through to NicknameGate: that bypasses decideRestore and
  // can flash the nick page after a same-code refresh.
  if (
    !roomApi.session ||
    roomApi.session.roomCode.toUpperCase() !== roomCode ||
    !roomApi.session.name
  ) {
    // Mid-session relay wipe: useRoom cleared session + toasted restart.
    if (gate.type === 'ready' && !roomApi.room) {
      return (
        <>
          <ToastStack toasts={roomApi.toasts} onDismiss={roomApi.dismissToast} />
          <div className="page" />
        </>
      )
    }
    return <div className="page" />
  }

  if (!roomApi.room) {
    // Prefer navigate-home via effect when relay wiped; avoid zombie lobby.
    return (
      <>
        <ToastStack toasts={roomApi.toasts} onDismiss={roomApi.dismissToast} />
        <div className="page" />
      </>
    )
  }

  const phase = roomApi.room.phase

  return (
    <>
      <ToastStack toasts={roomApi.toasts} onDismiss={roomApi.dismissToast} />
      {readOnly && (
        <div className="readonly-strip" role="status">
          <span>{RESTORE_COPY.TAKEN_OVER}</span>
          <button type="button" className="btn ghost compact" onClick={exitRoom}>
            退出房间
          </button>
        </div>
      )}
      {debug}
      {phase === 'lobby' ? (
        <Lobby
          room={roomApi.room}
          session={roomApi.session}
          isHost={roomApi.isHost}
          onStart={denyIfReadOnly(roomApi.startPlaying)}
        />
      ) : phase === 'paused' ? (
        <PausedTable
          room={roomApi.room}
          session={roomApi.session}
          onResume={denyIfReadOnly(roomApi.resumeTable)}
          onPickHost={
            readOnly
              ? () => {
                  roomApi.pushToast(RESTORE_COPY.TAKEN_OVER)
                }
              : roomApi.claimHost
          }
          pushToast={roomApi.pushToast}
        />
      ) : roomApi.table ? (
        <ChipTable
          room={roomApi.room}
          table={roomApi.table}
          seats={roomApi.seats}
          isHost={roomApi.isHost}
          connectionState={roomApi.connectionState}
          onOp={guardedOp}
          pushToast={roomApi.pushToast}
          onToggleOffline={denyIfReadOnly(() =>
            roomApi.setOffline(roomApi.connectionState !== 'offline'),
          )}
          onHostLeave={denyIfReadOnly(roomApi.signalHostDisconnect)}
          onExit={exitRoom}
        />
      ) : (
        <div className="page">
          <p>加载桌面…</p>
        </div>
      )}
    </>
  )
}
