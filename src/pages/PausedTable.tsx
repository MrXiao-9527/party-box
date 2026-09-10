import { useState } from 'react'
import type { RoomState } from '../types'
import type { Session } from '../store/localRoom'

interface PausedTableProps {
  room: RoomState
  session: Session
  onResume: () => void
  onPickHost: (newHostSeatId: string) => void
  pushToast: (text: string) => void
}

export function PausedTable({
  room,
  session,
  onResume,
  onPickHost,
  pushToast,
}: PausedTableProps) {
  const [picking, setPicking] = useState(false)
  const host = room.members.find((m) => m.seatId === room.hostSeatId)

  // Connected members who can take over — exclude the left host seat.
  const candidates = room.members.filter(
    (m) => m.connected && m.seatId !== room.hostSeatId,
  )

  const openPickHost = () => {
    if (candidates.length === 0) {
      pushToast('暂无其他成员可接桌主')
      return
    }
    setPicking(true)
  }

  const chooseHost = (seatId: string) => {
    setPicking(false)
    onPickHost(seatId)
  }

  return (
    <div className="page paused">
      <h1>桌主已离开 · 桌子已暂停</h1>
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
              {isHostSeat ? (
                <span className="offline-dot">桌主 · 已离开</span>
              ) : (
                <span className={showOnline ? 'online-dot' : 'offline-dot'}>
                  {showOnline ? '在线' : '已离开'}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      <div className="paused-actions">
        <button type="button" className="btn primary wide" onClick={onResume}>
          重开一桌
        </button>
        <button type="button" className="btn ghost wide" onClick={openPickHost}>
          选新桌主
        </button>
      </div>

      {picking && (
        <div className="confirm-overlay" role="dialog" aria-label="选新桌主">
          <div className="confirm-box">
            <p>选择新桌主</p>
            <ul className="pick-host-list">
              {candidates.map((m) => (
                <li key={m.seatId}>
                  <button
                    type="button"
                    className="btn ghost wide"
                    onClick={() => chooseHost(m.seatId)}
                  >
                    {m.name}
                    {m.seatId === session.seatId ? '（我）' : ''}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn ghost wide"
              onClick={() => setPicking(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
