import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RoomState, Seat, TableSnapshot } from '../types'
import type { ChipOpType } from '../types'

interface ChipTableProps {
  room: RoomState
  table: TableSnapshot
  seats: Seat[]
  isHost: boolean
  connectionState: 'online' | 'offline'
  onOp: (
    type: ChipOpType,
    targetSeatId: string,
    extra?: { denom?: number; amount?: number },
  ) => void
  onExit: () => void
  onToggleOffline: () => void
  onHostLeave: () => void
  pushToast: (text: string) => void
}

export function ChipTable({
  room,
  table,
  seats,
  isHost,
  connectionState,
  onOp,
  onExit,
  onToggleOffline,
  onHostLeave,
  pushToast,
}: ChipTableProps) {
  const navigate = useNavigate()
  const self = seats.find((s) => s.isSelf) ?? seats[0]
  const others = seats.filter((s) => !s.isSelf)
  const [menuOpen, setMenuOpen] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const longPressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)

  if (!self) {
    return (
      <div className="page table">
        <p className="error">座位数据缺失</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          回首页
        </button>
      </div>
    )
  }

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const onDenomPointerDown = (denom: number) => {
    longPressed.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      if (batchMode) {
        onOp('-batch', self.seatId, { amount: denom * 5 })
      } else {
        onOp('-denom', self.seatId, { denom })
      }
    }, 450)
  }

  const onDenomPointerUp = (denom: number) => {
    clearLongPress()
    if (longPressed.current) return
    if (batchMode) {
      onOp('+batch', self.seatId, { amount: denom * 5 })
    } else {
      onOp('+denom', self.seatId, { denom })
    }
  }

  const toggleLock = () => {
    onOp(self.locked ? 'unlock' : 'lock', self.seatId)
    setMenuOpen(false)
  }

  const resetSeat = () => {
    if (!isHost) {
      pushToast('仅桌主可执行此操作')
      return
    }
    onOp('resetSeat', self.seatId)
    setMenuOpen(false)
  }

  const resetTable = () => {
    if (!isHost) {
      pushToast('仅桌主可执行此操作')
      return
    }
    onOp('resetTable', self.seatId)
    setConfirmReset(false)
    setMenuOpen(false)
  }

  return (
    <div className="page table">
      <header className="table-top">
        <div className="top-meta">
          <span className="code">{room.roomCode.toUpperCase()}</span>
          <span className="dot">·</span>
          <span>{seats.length} 人</span>
          <span className="dot">·</span>
          <span>{isHost ? '桌主' : '玩家'}</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="菜单"
          onClick={() => setMenuOpen((v) => !v)}
        >
          ☰
        </button>
      </header>

      {connectionState === 'offline' && (
        <div className="offline-strip" role="status">
          已离线·以桌主为准
        </div>
      )}

      <div className="seats-rail" aria-label="座位">
        {others.map((s) => (
          <article key={s.seatId} className={`seat seat-other${s.locked ? ' locked' : ''}`}>
            <p className="seat-name">
              {s.name}
              {s.isHost && <span className="host-badge">桌主</span>}
            </p>
            <p className="seat-balance">{s.balance}</p>
          </article>
        ))}
      </div>

      <article className={`seat seat-self${self.locked ? ' locked' : ''}`}>
        <p className="seat-label">我的座位</p>
        <p className="seat-name">
          {self.name}
          {self.isHost && <span className="host-badge">桌主</span>}
          {self.locked && <span className="lock-badge">已锁定</span>}
        </p>
        <p className="seat-balance hero-balance">{self.balance}</p>
        <p className="seat-hint">
          {batchMode ? '批量：点按 +5×面额，长按 −' : '点按加筹码，长按减'}
        </p>
      </article>

      <div className="denom-bar" role="toolbar" aria-label="筹码面额">
        <button
          type="button"
          className={`batch-toggle${batchMode ? ' on' : ''}`}
          onClick={() => setBatchMode((v) => !v)}
        >
          {batchMode ? '批量开' : '批量'}
        </button>
        {table.denoms.map((d) => (
          <button
            key={d}
            type="button"
            className={`denom denom-${d}`}
            onPointerDown={() => onDenomPointerDown(d)}
            onPointerUp={() => onDenomPointerUp(d)}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            onContextMenu={(e) => e.preventDefault()}
          >
            {d}
          </button>
        ))}
      </div>

      {menuOpen && (
        <div className="menu-sheet" role="dialog" aria-label="桌面菜单">
          <button type="button" onClick={toggleLock}>
            {self.locked ? '解锁座位' : '锁定座位'}
          </button>
          <button type="button" onClick={resetSeat} disabled={!isHost}>
            重置我的筹码
          </button>
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            disabled={!isHost}
          >
            重置整桌
          </button>
          <button
            type="button"
            onClick={() => {
              onToggleOffline()
              setMenuOpen(false)
            }}
          >
            {connectionState === 'offline' ? '恢复连接' : '模拟离线'}
          </button>
          {isHost && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onHostLeave()
              }}
            >
              模拟桌主离开
            </button>
          )}
          <button
            type="button"
            className="danger"
            onClick={() => {
              setMenuOpen(false)
              onExit()
            }}
          >
            退出房间
          </button>
          <button type="button" className="muted" onClick={() => setMenuOpen(false)}>
            取消
          </button>
        </div>
      )}

      {confirmReset && (
        <div className="confirm-overlay" role="alertdialog">
          <div className="confirm-box">
            <p>确认重置整桌筹码？此操作不可撤销。</p>
            <div className="cta-row">
              <button type="button" className="btn ghost" onClick={() => setConfirmReset(false)}>
                取消
              </button>
              <button type="button" className="btn primary" onClick={resetTable}>
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
