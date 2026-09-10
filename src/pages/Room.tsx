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
  deleteRoom,
  loadRoom,
  restoreSeat,
  saveSession,
  type Session,
} from '../store/localRoom'
import { MAX_SEATS, parseRoomCode } from '../types'
import {
  decideRestore,
  hasHadSeat,
  loadIdentity,
  newTabId,
  openSeatTabChannel,
  RESTORE_COPY,
  saveIdentity,
  type SeatIdentity,
  type TabMessage,
} from '../sync/seatRestore'

type GateMode =
  | { type: 'booting' }
  | { type: 'nick'; prefill?: string; notice?: string }
  | { type: 'takeover'; identity: SeatIdentity }
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

  // BroadcastChannel: claim / kick / ping-pong for dual-tab
  useEffect(() => {
    if (!roomCode) return
    const ch = openSeatTabChannel((msg: TabMessage) => {
      if (msg.roomCode !== roomCode) return
      if (msg.tabId === tabIdRef.current) return

      if (msg.type === 'ping' && holdingSeatRef.current === msg.seatId && !readOnly) {
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
        !readOnly
      ) {
        setReadOnly(true)
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

    const roomData = loadRoom(roomCode)
    const identity = loadIdentity()
    const roomView = roomData
      ? {
          roomCode: roomData.room.roomCode,
          hostSeatId: roomData.room.hostSeatId,
          phase: roomData.room.phase,
          members: roomData.room.members,
          seats: roomData.table.seats,
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
        }, 180)
      })

    const run = async () => {
      // Fresh「开一桌」pending host claim (empty members + empty-name session)
      if (
        roomData &&
        roomData.room.members.length === 0 &&
        !identity
      ) {
        setGate({ type: 'nick' })
        return
      }

      if (!roomData) {
        roomApi.pushToast(RESTORE_COPY.ROOM_GONE)
        saveIdentity(null, roomCode)
        navigate('/', { replace: true })
        setGate({ type: 'gone' })
        return
      }

      let seatHeldByOtherTab = false
      if (identity?.roomCode === roomCode && identity.seatId) {
        seatHeldByOtherTab = await probeOtherTab(identity.seatId)
      }

      const decision = decideRestore({
        roomCode,
        room: roomView,
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
        const data = restoreSeat(roomCode, decision.identity.seatId)
        if (data) {
          const session: Session = {
            seatId: decision.identity.seatId,
            name: decision.identity.name,
            roomCode,
          }
          saveSession(session)
          roomApi.bindSession(session)
          roomApi.setPersisted(data)
          holdingSeatRef.current = session.seatId
          channelRef.current?.post({
            type: 'claim',
            roomCode,
            seatId: session.seatId,
            tabId: tabIdRef.current,
          })
          setGate({ type: 'ready' })
          return
        }
        // Fall through to seat_taken if restore failed
        setGate({
          type: 'nick',
          prefill: decision.identity.name,
          notice: RESTORE_COPY.SEAT_TAKEN,
        })
        roomApi.pushToast(RESTORE_COPY.SEAT_TAKEN)
        return
      }

      if (decision.kind === 'seat_taken') {
        roomApi.pushToast(decision.toast)
        setGate({
          type: 'nick',
          prefill: decision.prefillName,
          notice: decision.toast,
        })
        return
      }

      if (decision.kind === 'fresh_join') {
        setGate({ type: 'nick' })
        return
      }

      // identity_lost — prior seat mark exists but identity key is gone
      roomApi.pushToast(decision.toast)
      setGate({ type: 'nick', notice: decision.toast })
    }

    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode])

  const claimHold = (session: Session) => {
    holdingSeatRef.current = session.seatId
    setReadOnly(false)
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
    const data = restoreSeat(roomCode, id.seatId)
    if (!data) {
      roomApi.pushToast(RESTORE_COPY.SEAT_TAKEN)
      setGate({ type: 'nick', prefill: id.name, notice: RESTORE_COPY.SEAT_TAKEN })
      return
    }
    const session: Session = {
      seatId: id.seatId,
      name: id.name,
      roomCode,
    }
    saveSession(session)
    saveIdentity(id)
    roomApi.bindSession(session)
    roomApi.setPersisted(data)
    claimHold(session)
    setGate({ type: 'ready' })
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

  const exitRoom = () => {
    if (roomApi.isHost) deleteRoom(roomCode)
    saveIdentity(null, roomCode)
    roomApi.clearSession()
    roomApi.setOffline(false)
    holdingSeatRef.current = null
    navigate('/')
  }

  const guardedOp: typeof roomApi.submitOp = (...args) => {
    if (readOnly) {
      roomApi.pushToast(RESTORE_COPY.TAKEN_OVER)
      return Promise.resolve()
    }
    return roomApi.submitOp(...args)
  }

  const debug = roomApi.room ? (
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
            onClick={() =>
              setGate({
                type: 'nick',
                prefill: gate.identity.name,
                notice: RESTORE_COPY.SEAT_TAKEN,
              })
            }
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

  // ready
  if (
    !roomApi.session ||
    roomApi.session.roomCode !== roomCode ||
    !roomApi.session.name
  ) {
    return (
      <>
        <ToastStack toasts={roomApi.toasts} onDismiss={roomApi.dismissToast} />
        <NicknameGate
          roomCode={roomCode}
          onReady={onNickReady}
          onError={(msg) => roomApi.pushToast(msg)}
        />
      </>
    )
  }

  if (!roomApi.room) {
    return (
      <div className="page">
        <p className="error">房间已结束</p>
        <button type="button" className="btn primary" onClick={() => navigate('/')}>
          回首页
        </button>
      </div>
    )
  }

  const phase = roomApi.room.phase

  return (
    <>
      <ToastStack toasts={roomApi.toasts} onDismiss={roomApi.dismissToast} />
      {readOnly && (
        <div className="readonly-strip" role="status">
          {RESTORE_COPY.TAKEN_OVER}
        </div>
      )}
      {debug}
      {phase === 'lobby' ? (
        <Lobby
          room={roomApi.room}
          session={roomApi.session}
          isHost={roomApi.isHost}
          onStart={readOnly ? () => roomApi.pushToast(RESTORE_COPY.TAKEN_OVER) : roomApi.startPlaying}
        />
      ) : phase === 'paused' ? (
        <PausedTable
          room={roomApi.room}
          session={roomApi.session}
          isHost={roomApi.isHost}
          onResume={readOnly ? () => roomApi.pushToast(RESTORE_COPY.TAKEN_OVER) : roomApi.resumeTable}
          onPickHost={readOnly ? () => roomApi.pushToast(RESTORE_COPY.TAKEN_OVER) : roomApi.claimHost}
          onExit={exitRoom}
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
          onToggleOffline={() =>
            roomApi.setOffline(roomApi.connectionState !== 'offline')
          }
          onHostLeave={roomApi.signalHostDisconnect}
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
