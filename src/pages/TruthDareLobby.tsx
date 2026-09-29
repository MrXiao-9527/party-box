import { useEffect, useRef, useState } from 'react'
import { JoinInvite } from '../components/JoinInvite'
import type { PromptTypeChoice, RoomMember, RoomState } from '../types'
import {
  ACK_REASONS,
  PARTY_GAME_LABEL,
  PROMPT_TYPE_LABEL,
  isTruthDarePhase,
  normalizeMaxSeats,
  partyStubOf,
  tableFullReason,
} from '../types'
import type { Session } from '../store/localRoom'
import { TruthDareWheel } from './TruthDareWheel'

const WHEEL_SKIP_MS = 2000

const REDRAW_TYPES: { id: PromptTypeChoice; label: string }[] = [
  { id: 'truth', label: '真心话' },
  { id: 'dare', label: '大冒险' },
  { id: 'random', label: '随机' },
]

interface TruthDareLobbyProps {
  room: RoomState
  session: Session
  isHost: boolean
  drawing?: boolean
  onDraw: (mode?: 'direct' | 'wheel') => void
  onRedraw: (type?: PromptTypeChoice) => void
  onAdvance: () => void
  onSetDrawer: (seatId: string) => void
  onSetAnswerer: (seatId: string) => void
  onSkipDrawer: () => void
  onDeniedDraw: () => void
  onDeniedRedraw: () => void
}

function nickOf(members: RoomMember[], seatId: string | null | undefined) {
  if (!seatId) return ''
  return members.find((m) => m.seatId === seatId)?.name || ''
}

export function TruthDareLobby({
  room,
  session,
  isHost,
  drawing = false,
  onDraw,
  onRedraw,
  onAdvance,
  onSetDrawer,
  onSetAnswerer,
  onSkipDrawer,
  onDeniedDraw,
  onDeniedRedraw,
}: TruthDareLobbyProps) {
  const cap = normalizeMaxSeats(room.maxSeats)
  const full = room.members.length >= cap
  const party = partyStubOf(room.party)
  const phase = isTruthDarePhase(party.phase) ? party.phase : 'idle'
  const prompt = party.prompt
  const history = party.promptHistory || []
  const drawerNick = nickOf(room.members, party.drawerSeatId)
  const answererNick = nickOf(room.members, party.answererSeatId)
  const isDrawer = session.seatId === party.drawerSeatId
  const isAnswerer = session.seatId === party.answererSeatId
  const canAdvance = isHost || isAnswerer
  const canSetDrawer = isHost && phase === 'drawing'
  const canSkipDrawer = isHost && phase === 'drawing'
  const canSetAnswerer = (isHost || isDrawer) && phase === 'answering'
  const canRedraw = (isHost || isDrawer) && phase === 'answering'
  const redrawUsed = !!party.redrawUsedThisTurn
  const online = room.members.filter((m) => m.connected)
  const drawer = room.members.find((m) => m.seatId === party.drawerSeatId)
  const answerer = room.members.find((m) => m.seatId === party.answererSeatId)
  const drawerOffline = phase === 'answering' && (!drawer || !drawer.connected)
  const answererOffline = phase === 'answering' && !!answerer && !answerer.connected
  const [picking, setPicking] = useState<'drawer' | 'answerer' | null>(null)
  const [wheelSpin, setWheelSpin] = useState(false)
  const [redrawType, setRedrawType] = useState<PromptTypeChoice>('truth')
  const awaitingWheel = useRef(false)
  const wheelAt = useRef(0)

  useEffect(() => {
    if (!prompt) return
    const choice = prompt.typeChoice
    setRedrawType(
      choice === 'truth' || choice === 'dare' || choice === 'random'
        ? choice
        : prompt.displayType,
    )
  }, [prompt?.id, prompt?.typeChoice, prompt?.displayType])

  const stage =
    phase === 'answering'
      ? `轮到 ${answererNick || '…'} 答`
      : `等待 ${drawerNick || '…'} 抽题`

  const hint = prompt
    ? `当前 · ${PROMPT_TYPE_LABEL[prompt.displayType]}`
    : null

  function handleDraw() {
    if (!isDrawer) {
      onDeniedDraw()
      return
    }
    awaitingWheel.current = false
    onDraw('direct')
  }

  function handleWheel() {
    if (!isDrawer) {
      onDeniedDraw()
      return
    }
    awaitingWheel.current = true
    wheelAt.current = Date.now()
    onDraw('wheel')
  }

  function handleRedraw() {
    if (!canRedraw) return
    if (redrawUsed) {
      onDeniedRedraw()
      return
    }
    onRedraw(redrawType)
  }

  useEffect(() => {
    if (phase === 'drawing' && !drawing && !prompt) {
      awaitingWheel.current = false
      setWheelSpin(false)
    }
    if (phase !== 'answering' || !prompt || !awaitingWheel.current) return
    awaitingWheel.current = false
    const slow = Date.now() - wheelAt.current > WHEEL_SKIP_MS
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (slow || reduced) {
      setWheelSpin(false)
      return
    }
    setWheelSpin(true)
  }, [phase, prompt?.id, drawing])

  function pickDrawer(seatId: string) {
    setPicking(null)
    onSetDrawer(seatId)
  }

  function pickAnswerer(seatId: string) {
    setPicking(null)
    onSetAnswerer(seatId)
  }

  return (
    <div
      className="page lobby"
      data-mode="partyGame"
      data-party-phase={phase}
      data-game-id="truthDare"
      data-has-prompt={prompt ? 'true' : 'false'}
      data-drawer-seat={party.drawerSeatId || ''}
      data-answerer-seat={party.answererSeatId || ''}
      data-redraw-used={redrawUsed ? 'true' : 'false'}
    >
      <header className="lobby-header">
        <p className="eyebrow">局桌 · {PARTY_GAME_LABEL.truthDare}</p>
        <h1>房间 {room.roomCode.toUpperCase()}</h1>
        {hint ? <p className="hint">{hint}</p> : null}
        <p className="stage-copy" data-stage="1" data-stage-copy="1">
          {stage}
        </p>
      </header>

      <JoinInvite room={room} />

      <section
        className="prompt-area"
        data-prompt-area="1"
        data-prompt-id={prompt?.id || ''}
        data-prompt-type={prompt?.displayType || ''}
        aria-label="题目区"
      >
        {prompt && phase === 'answering' ? (
          <>
            <p className="prompt-type">{PROMPT_TYPE_LABEL[prompt.displayType]}</p>
            <p className="prompt-text" data-prompt-text={prompt.text}>
              {prompt.text}
            </p>
            {drawerOffline && (
              <p className="hint" data-drawer-offline="1">
                抽题人已离线，桌主可处理
              </p>
            )}
            {answererOffline && (
              <p className="hint" data-answerer-offline="1">
                答题人已离线，桌主可过题
              </p>
            )}
          </>
        ) : (
          <>
            <p className="prompt-placeholder">题目区</p>
            <p className="hint">{stage}</p>
          </>
        )}
      </section>

      {history.length > 0 && (
        <section
          className="prompt-history"
          data-prompt-history="1"
          aria-label="近史"
        >
          <h2>近史</h2>
          <ul>
            {history.map((item, i) => (
              <li
                key={`${item.id}-${item.closedAt}-${i}`}
                data-history-item={item.id}
                data-history-latest={i === 0 ? 'true' : 'false'}
              >
                {PROMPT_TYPE_LABEL[item.displayType]} · {item.text} ·{' '}
                {item.answererNickname || '…'}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="member-list" aria-label="成员">
        <h2>
          成员 · {room.members.length}/{cap}
        </h2>
        {full && <p className="hint">{tableFullReason(cap)}</p>}
        <ul>
          {room.members.map((m) => {
            const drawerSeat = m.seatId === party.drawerSeatId
            const answererSeat = m.seatId === party.answererSeatId
            return (
              <li
                key={m.seatId}
                className={[
                  m.seatId === session.seatId ? 'self' : '',
                  drawerSeat ? 'turn-drawer' : '',
                  answererSeat ? 'turn-answerer' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-is-drawer={drawerSeat ? 'true' : 'false'}
                data-is-answerer={answererSeat ? 'true' : 'false'}
              >
                <span className="member-name">
                  {m.name}
                  {m.seatId === session.seatId ? '（我）' : ''}
                </span>
                {m.isHost && <span className="host-badge">桌主</span>}
                {drawerSeat && <span className="turn-badge">抽题人</span>}
                {answererSeat && phase === 'answering' && (
                  <span className="turn-badge">答题人</span>
                )}
                {m.connected ? (
                  <span className="online-dot">在线</span>
                ) : (
                  <span className="offline-dot">离线</span>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {wheelSpin && prompt && (
        <TruthDareWheel
          promptId={prompt.id}
          displayType={prompt.displayType}
          onSettled={() => setWheelSpin(false)}
        />
      )}

      <footer className="lobby-footer">
        {phase === 'drawing' && (
          <>
            <button
              type="button"
              className={isDrawer ? 'btn primary wide' : 'btn ghost wide'}
              data-draw="1"
              data-draw-self={isDrawer ? 'true' : 'false'}
              disabled={drawing}
              aria-busy={drawing}
              onClick={handleDraw}
            >
              {drawing && isDrawer ? '抽题中…' : '直接出题'}
            </button>
            <button
              type="button"
              className={isDrawer ? 'btn secondary wide' : 'btn ghost wide'}
              data-draw-wheel="1"
              data-draw-wheel-self={isDrawer ? 'true' : 'false'}
              disabled={drawing}
              aria-busy={drawing}
              onClick={handleWheel}
            >
              {drawing && isDrawer ? '抽题中…' : '转盘抽题'}
            </button>
          </>
        )}
        {canSetDrawer && (
          <button
            type="button"
            className="btn ghost wide"
            data-set-drawer="1"
            disabled={drawing}
            onClick={() =>
              setPicking((cur) => (cur === 'drawer' ? null : 'drawer'))
            }
          >
            指定抽题人
          </button>
        )}
        {canSkipDrawer && (
          <button
            type="button"
            className="btn ghost wide"
            data-skip-drawer="1"
            disabled={drawing || online.length === 0}
            onClick={() => {
              if (online.length === 0) return
              onSkipDrawer()
            }}
          >
            跳过当前抽题人
          </button>
        )}
        {phase === 'answering' && canAdvance && (
          <button
            type="button"
            className="btn primary wide"
            data-advance="1"
            disabled={drawing}
            aria-busy={drawing}
            onClick={onAdvance}
          >
            {drawing ? '过题中…' : '过题'}
          </button>
        )}
        {canRedraw && (
          <>
            <div className="redraw-types" data-redraw-types="1">
              {REDRAW_TYPES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={
                    redrawType === opt.id ? 'btn secondary compact' : 'btn ghost compact'
                  }
                  data-redraw-type={opt.id}
                  disabled={drawing || redrawUsed}
                  onClick={() => setRedrawType(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn secondary wide"
              data-redraw="1"
              disabled={drawing}
              onClick={handleRedraw}
            >
              换一题
            </button>
          </>
        )}
        {canSetAnswerer && (
          <button
            type="button"
            className="btn ghost wide"
            data-set-answerer="1"
            disabled={drawing}
            onClick={() =>
              setPicking((cur) => (cur === 'answerer' ? null : 'answerer'))
            }
          >
            指定答题人
          </button>
        )}
        {picking === 'drawer' && (
          <ul className="seat-picker" data-drawer-picker="1">
            {online.map((m) => (
              <li key={m.seatId}>
                <button
                  type="button"
                  className="btn secondary wide"
                  data-pick-drawer={m.seatId}
                  onClick={() => pickDrawer(m.seatId)}
                >
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {picking === 'answerer' && (
          <ul className="seat-picker" data-answerer-picker="1">
            {online.map((m) => (
              <li key={m.seatId}>
                <button
                  type="button"
                  className="btn secondary wide"
                  data-pick-answerer={m.seatId}
                  onClick={() => pickAnswerer(m.seatId)}
                >
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {phase === 'drawing' && !isDrawer && (
          <p className="waiting">{`等待 ${drawerNick || '…'} 抽题`}</p>
        )}
        {phase === 'drawing' && online.length === 0 && (
          <p className="hint" data-wait-online="1">
            {ACK_REASONS.WAIT_ONLINE}
          </p>
        )}
      </footer>
    </div>
  )
}
