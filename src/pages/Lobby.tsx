import { JoinInvite } from '../components/JoinInvite'
import type { RoomState } from '../types'
import { normalizeMaxSeats, tableFullReason } from '../types'
import type { Session } from '../store/localRoom'

interface LobbyProps {
  room: RoomState
  session: Session
  isHost: boolean
  onStart: () => void
}

export function Lobby({ room, session, isHost, onStart }: LobbyProps) {
  const cap = normalizeMaxSeats(room.maxSeats)
  const full = room.members.length >= cap

  return (
    <div className="page lobby">
      <header className="lobby-header">
        <p className="eyebrow">等候开桌</p>
        <h1>房间 {room.roomCode.toUpperCase()}</h1>
      </header>

      <JoinInvite room={room} showSettings />

      <section className="member-list" aria-label="成员">
        <h2>
          成员 · {room.members.length}/{cap}
        </h2>
        {full && <p className="hint">{tableFullReason(cap)}</p>}
        <ul>
          {room.members.map((m) => (
            <li key={m.seatId} className={m.seatId === session.seatId ? 'self' : ''}>
              <span className="member-name">
                {m.name}
                {m.seatId === session.seatId ? '（我）' : ''}
              </span>
              {m.isHost && <span className="host-badge">桌主</span>}
              {!m.connected && <span className="offline-dot">离线</span>}
            </li>
          ))}
        </ul>
      </section>

      <footer className="lobby-footer">
        {isHost ? (
          <button type="button" className="btn primary wide" onClick={onStart}>
            开桌
          </button>
        ) : (
          <p className="waiting">等待桌主开桌…</p>
        )}
      </footer>
    </div>
  )
}
