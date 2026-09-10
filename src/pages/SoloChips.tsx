import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DEFAULT_DENOMS } from '../types'

/** Solo chip table — no room; can「开一桌」later from home. */
export function SoloChipsPage() {
  const navigate = useNavigate()
  const [balance, setBalance] = useState(0)
  const [locked, setLocked] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const longPressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const apply = (delta: number) => {
    if (locked) return
    setBalance((b) => Math.max(0, b + delta))
  }

  const onDown = (denom: number) => {
    longPressed.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      apply(batchMode ? -(denom * 5) : -denom)
    }, 450)
  }

  const onUp = (denom: number) => {
    clearLongPress()
    if (longPressed.current) return
    apply(batchMode ? denom * 5 : denom)
  }

  return (
    <div className="page table">
      <header className="table-top">
        <div className="top-meta">
          <span className="code">单人</span>
          <span className="dot">·</span>
          <span>可稍后进房</span>
        </div>
        <button type="button" className="icon-btn" onClick={() => navigate('/')}>
          ✕
        </button>
      </header>

      <article className={`seat seat-self${locked ? ' locked' : ''}`}>
        <p className="seat-label">我的座位</p>
        <p className="seat-name">
          单人练习
          {locked && <span className="lock-badge">已锁定</span>}
        </p>
        <p className="seat-balance hero-balance">{balance}</p>
        <p className="seat-hint">
          {batchMode ? '批量：点按 +5×面额，长按 −' : '点按加筹码，长按减'}
        </p>
      </article>

      <div className="cta-row" style={{ marginTop: '0.5rem' }}>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setLocked((v) => !v)}
        >
          {locked ? '解锁' : '锁定'}
        </button>
        <button type="button" className="btn ghost" onClick={() => setBalance(0)}>
          重置
        </button>
        <button type="button" className="btn primary" onClick={() => navigate('/')}>
          去开一桌
        </button>
      </div>

      <div className="denom-bar" role="toolbar" aria-label="筹码面额">
        <button
          type="button"
          className={`batch-toggle${batchMode ? ' on' : ''}`}
          onClick={() => setBatchMode((v) => !v)}
        >
          {batchMode ? '批量开' : '批量'}
        </button>
        {DEFAULT_DENOMS.map((d) => (
          <button
            key={d}
            type="button"
            className={`denom denom-${d}`}
            onPointerDown={() => onDown(d)}
            onPointerUp={() => onUp(d)}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            onContextMenu={(e) => e.preventDefault()}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  )
}
