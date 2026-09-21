import { useState } from 'react'
import { JoinInvite } from '../components/JoinInvite'
import type { RoomMember, RoomState } from '../types'
import {
  PARTY_GAME_LABEL,
  PROMPT_TYPE_LABEL,
  isTruthDarePhase,
  normalizeMaxSeats,
  partyStubOf,
  tableFullReason,
} from '../types'
import type { Session } from '../store/localRoom'

interface TruthDareLobbyProps {
  room: RoomState
  session: Session
  isHost: boolean
  drawing?: boolean
  onDraw: () => void
  onAdvance: () => void
  onSetDrawer: (seatId: string) => void
  onSetAnswerer: (seatId: string) => void
  onDeniedDraw: () => void
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
  onAdvance,
  onSetDrawer,
  onSetAnswerer,
  onDeniedDraw,
}: TruthDareLobbyProps) {
  const cap = normalizeMaxSeats(room.maxSeats)
  const full = room.members.length >= cap
  const party = partyStubOf(room.party)
  const phase = isTruthDarePhase(party.phase) ? party.phase : 'idle'
  const prompt = party.prompt
  const drawerNick = nickOf(room.members, party.drawerSeatId)
  const answererNick = nickOf(room.members, party.answererSeatId)
  const isDrawer = session.seatId === party.drawerSeatId
  const isAnswerer = session.seatId === party.answererSeatId
  const canAdvance = isHost || isAnswerer
  const canSetDrawer = isHost && phase === 'drawing'
  const canSetAnswerer = (isHost || isDrawer) && phase === 'answering'
  const online = room.members.filter((m) => m.connected)
  const answerer = room.members.find((m) => m.seatId === party.answererSeatId)
  const answererOffline = phase === 'answering' && !!answerer && !answerer.connected
  const [picking, setPicking] = useState<'drawer' | 'answerer' | null>(null)

  const stage =
    phase === 'answering'
      ? `轮到 ${answererNick || '…'} 答`
      : `等待 ${drawerNick || '…'} 抽题`

  const hint = prompt
    ? `当前 · ${PROMPT_TYPE_LABEL[prompt.displayType]}`
    : stage

  function handleDraw() {
    if (!isDrawer) {
      onDeniedDraw()
      return
    }
    onDraw()
  }

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
    >
      <header className="lobby-header">
        <p className="eyebrow">局桌 · {PARTY_GAME_LABEL.truthDare}</p>
        <h1>房间 {room.roomCode.toUpperCase()}</h1>
        <p className="hint" data-stage="1">
          {hint}
        </p>
        <p className="stage-copy" data-stage-copy="1">
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

      <section className="member-list" aria-label="成员">
        <h2>
          成员 · {room.members.length}/{cap}
        </h2>
        {full && <p className="hint">{tableFullReason(cap)}</p>}
        <ul>
          {room.members.map((m) => {
            const drawer = m.seatId === party.drawerSeatId
            const answererSeat = m.seatId === party.answererSeatId
            return (
              <li
                key={m.seatId}
                className={[
                  m.seatId === session.seatId ? 'self' : '',
                  drawer ? 'turn-drawer' : '',
                  answererSeat ? 'turn-answerer' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-is-drawer={drawer ? 'true' : 'false'}
                data-is-answerer={answererSeat ? 'true' : 'false'}
              >
                <span className="member-name">
                  {m.name}
                  {m.seatId === session.seatId ? '（我）' : ''}
                </span>
                {m.isHost && <span className="host-badge">桌主</span>}
                {drawer && <span className="turn-badge">抽题人</span>}
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

      <footer className="lobby-footer">
        {phase === 'drawing' && (
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
      </footer>
    </div>
  )
}
