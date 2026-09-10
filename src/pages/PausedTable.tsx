import type { RoomState } from '../types'
import type { Session } from '../store/localRoom'

interface PausedTableProps {
  room: RoomState
  session: Session
  isHost: boolean
  onResume: () => void
  onPickHost: () => void
  onExit: () => void
}

export function PausedTable({
  room,
  session,
  isHost,
  onResume,
  onPickHost,
  onExit,
}: PausedTableProps) {
  const host = room.members.find((m) => m.seatId === room.hostSeatId)

  return (
    <div className="page paused">
      <p className="eyebrow">牌桌已暂停</p>
      <h1>桌主已离开</h1>
      <p className="hint">
        不会自动转让桌主。请等待
        {host ? `「${host.name}」` : '桌主'}
        重新进入并重开，或由在线成员主动选出新桌主。
      </p>

      <ul className="member-list paused-members">
        {room.members.map((m) => {
          // Pause reason is host-left: host (and any disconnected seats) must
          // not show「在线」, even if the host reopened the page to resume.
          const isHostSeat = m.seatId === room.hostSeatId || m.isHost
          const showOnline = m.connected && !isHostSeat
          return (
            <li key={m.seatId} className={m.seatId === session.seatId ? 'self' : ''}>
              <span>
                {m.name}
                {m.seatId === session.seatId ? '（我）' : ''}
              </span>
              {isHostSeat && <span className="host-badge">桌主</span>}
              <span className={showOnline ? 'online-dot' : 'offline-dot'}>
                {showOnline ? '在线' : '已离开'}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="paused-actions">
        {isHost ? (
          <button type="button" className="btn primary wide" onClick={onResume}>
            重开牌桌
          </button>
        ) : (
          <button type="button" className="btn primary wide" onClick={onPickHost}>
            我来当桌主
          </button>
        )}
        <button type="button" className="btn ghost wide" onClick={onExit}>
          退出房间
        </button>
      </div>
    </div>
  )
}
