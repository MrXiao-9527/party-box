import { useState } from 'react'
import { ACK_REASONS, type RoomState } from '../types'
import type { Session } from '../store/localRoom'

interface PausedTableProps {
  room: RoomState
  session: Session
  onResume: () => void
  onPickHost: (newHostSeatId: string) => void
}

export function PausedTable({
  room,
  session,
  onResume,
  onPickHost,
}: PausedTableProps) {
  const [picking, setPicking] = useState(false)
  const [pendingSeatId, setPendingSeatId] = useState<string | null>(null)
  const host = room.members.find((m) => m.seatId === room.hostSeatId)
  const viewer = room.members.find((m) => m.seatId === session.seatId)
  const viewerOnline = !!viewer?.connected

  // Any connected seated member may pick another connected member (not self).
  // Left host is excluded (pause list shows 桌主 · 已离开).
  const candidates = room.members.filter(
    (m) =>
      m.connected &&
      m.seatId !== room.hostSeatId &&
      m.seatId !== session.seatId,
  )
  const pending = candidates.find((m) => m.seatId === pendingSeatId) ?? null
  const canPick = viewerOnline && candidates.length > 0
  const noCandidate = candidates.length === 0

  const closePick = () => {
    setPicking(false)
    setPendingSeatId(null)
  }

  const confirmPick = () => {
    if (!pending) return
    const seatId = pending.seatId
    closePick()
    onPickHost(seatId)
  }

  return (
    <div className="page paused">
      <h1>桌主已离开 · 桌子已暂停</h1>
      <p className="hint">
        不会自动转让桌主。请等待
        {host ? `「${host.name}」` : '桌主'}
        重开一桌，或由在线成员选出新桌主。
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
        <button
          type="button"
          className="btn ghost wide"
          data-pick-host
          disabled={!canPick}
          onClick={() => {
            if (!canPick) return
            setPicking(true)
          }}
        >
          选新桌主
        </button>
        {noCandidate && (
          <p className="hint" data-no-host-candidate role="status">
            {ACK_REASONS.NO_HOST_CANDIDATE}
          </p>
        )}
      </div>

      {picking && !pending && (
        <div className="confirm-overlay" role="dialog" aria-label="选新桌主">
          <div className="confirm-box">
            <p>选择新桌主</p>
            <ul className="pick-host-list">
              {candidates.map((m) => (
                <li key={m.seatId}>
                  <button
                    type="button"
                    className="btn ghost wide"
                    onClick={() => setPendingSeatId(m.seatId)}
                  >
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn ghost wide"
              onClick={closePick}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {pending && (
        <div className="confirm-overlay" role="dialog" aria-label="确认转让桌主">
          <div className="confirm-box">
            <p>确认将桌主转让给「{pending.name}」？</p>
            <div className="cta-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setPendingSeatId(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                data-confirm-host
                onClick={confirmPick}
              >
                确认转让
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
