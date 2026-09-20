import { JoinInvite } from '../components/JoinInvite'
import type { RoomState } from '../types'
import { normalizeMaxSeats, partyStubOf, tableFullReason } from '../types'
import type { Session } from '../store/localRoom'

interface PartyLobbyProps {
  room: RoomState
  session: Session
}

/** Slice A shell: seats / invite / presence. No ChipTable, no dealing. */
export function PartyLobby({ room, session }: PartyLobbyProps) {
  const cap = normalizeMaxSeats(room.maxSeats)
  const full = room.members.length >= cap
  const party = partyStubOf(room.party)

  return (
    <div
      className="page lobby"
      data-mode="partyGame"
      data-party-phase={party.phase}
      data-game-id={party.gameId}
    >
      <header className="lobby-header">
        <p className="eyebrow">局桌 · 谁是卧底</p>
        <h1>房间 {room.roomCode.toUpperCase()}</h1>
        <p className="hint">大厅 · 尚未发词</p>
      </header>

      <JoinInvite room={room} />

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
        <p className="waiting">等待开始（本切片不发词）</p>
      </footer>
    </div>
  )
}
