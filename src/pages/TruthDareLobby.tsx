import { JoinInvite } from '../components/JoinInvite'
import type { RoomState } from '../types'
import {
  PARTY_GAME_LABEL,
  PROMPT_TYPE_LABEL,
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
  onRedraw: () => void
}

export function TruthDareLobby({
  room,
  session,
  isHost,
  drawing = false,
  onDraw,
  onRedraw,
}: TruthDareLobbyProps) {
  const cap = normalizeMaxSeats(room.maxSeats)
  const full = room.members.length >= cap
  const party = partyStubOf(room.party)
  const prompt = party.prompt
  const hint = prompt
    ? `当前 · ${PROMPT_TYPE_LABEL[prompt.displayType]}`
    : '大厅 · 尚未抽题'

  return (
    <div
      className="page lobby"
      data-mode="partyGame"
      data-party-phase={party.phase}
      data-game-id="truthDare"
      data-has-prompt={prompt ? 'true' : 'false'}
    >
      <header className="lobby-header">
        <p className="eyebrow">局桌 · {PARTY_GAME_LABEL.truthDare}</p>
        <h1>房间 {room.roomCode.toUpperCase()}</h1>
        <p className="hint">{hint}</p>
      </header>

      <JoinInvite room={room} />

      <section
        className="prompt-area"
        data-prompt-area="1"
        data-prompt-id={prompt?.id || ''}
        data-prompt-type={prompt?.displayType || ''}
        aria-label="题目区"
      >
        {prompt ? (
          <>
            <p className="prompt-type">{PROMPT_TYPE_LABEL[prompt.displayType]}</p>
            <p className="prompt-text" data-prompt-text={prompt.text}>
              {prompt.text}
            </p>
          </>
        ) : (
          <>
            <p className="prompt-placeholder">题目区</p>
            <p className="hint">抽题后题目会显示在这里</p>
          </>
        )}
      </section>

      <section className="member-list" aria-label="成员">
        <h2>
          成员 · {room.members.length}/{cap}
        </h2>
        {full && <p className="hint">{tableFullReason(cap)}</p>}
        <ul>
          {room.members.map((m) => (
            <li
              key={m.seatId}
              className={m.seatId === session.seatId ? 'self' : ''}
            >
              <span className="member-name">
                {m.name}
                {m.seatId === session.seatId ? '（我）' : ''}
              </span>
              {m.isHost && <span className="host-badge">桌主</span>}
              {m.connected ? (
                <span className="online-dot">在线</span>
              ) : (
                <span className="offline-dot">离线</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <footer className="lobby-footer">
        {isHost ? (
          prompt ? (
            <button
              type="button"
              className="btn primary wide"
              data-redraw="1"
              disabled={drawing}
              aria-busy={drawing}
              onClick={onRedraw}
            >
              {drawing ? '重抽中…' : '重抽'}
            </button>
          ) : (
            <button
              type="button"
              className="btn primary wide"
              data-draw="1"
              disabled={drawing}
              aria-busy={drawing}
              onClick={onDraw}
            >
              {drawing ? '抽题中…' : '抽题'}
            </button>
          )
        ) : (
          <p className="waiting">{prompt ? '等待桌主重抽' : '等待桌主抽题'}</p>
        )}
      </footer>
    </div>
  )
}
