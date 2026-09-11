import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { A2HSHint } from '../components/A2HSHint'
import { ToastStack } from '../components/Toast'
import { createEmptyHostRoom, syncRoomFromRelay, syncStatusToast } from '../sync/roomApi'
import { dropForeignSession } from '../store/localRoom'
import { takeFlashToast } from '../sync/flashToast'
import { ACK_REASONS, parseRoomCode, parseRoomCreate } from '../types'

const TOOLS = [
  {
    id: 'chips',
    title: '筹码桌',
    subtitle: '多人计数 · 可进房同步',
    badge: '可稍后进房',
    ready: true,
  },
  {
    id: 'random',
    title: '随机工具',
    subtitle: '骰子 / 抽签 / 转盘',
    badge: '即将开放',
    ready: false,
  },
  {
    id: 'timer',
    title: '计时回合',
    subtitle: '倒计时 · 轮流计时',
    badge: '即将开放',
    ready: false,
  },
  {
    id: 'split',
    title: '分账助手',
    subtitle: 'AA · 按人按项',
    badge: '即将开放',
    ready: false,
  },
] as const

const COMING_SOON = '这版先做筹码桌，下一刀开放'

export function HomePage() {
  const navigate = useNavigate()
  const [joinCode, setJoinCode] = useState('')
  const [showJoin, setShowJoin] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [buyInN, setBuyInN] = useState('')
  const [maxSeats, setMaxSeats] = useState('8')
  const [smallBlind, setSmallBlind] = useState('')
  const [bigBlind, setBigBlind] = useState('')
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([])
  const busyRef = useRef(false)

  const toast = (text: string) => {
    const id = `t_${Date.now()}`
    setToasts((prev) => [...prev, { id, text }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 2800)
  }

  useEffect(() => {
    const flash = takeFlashToast()
    if (flash) toast(flash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const confirmCreate = () => {
    const parsed = parseRoomCreate(
      { buyInN, maxSeats, smallBlind, bigBlind },
      { strictBuyIn: true },
    )
    if (!parsed.ok) {
      setCreateError(parsed.error)
      toast(parsed.error)
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setCreateError('')
    void (async () => {
      try {
        const result = await createEmptyHostRoom({
          buyInN: parsed.buyInN,
          maxSeats: parsed.maxSeats,
          smallBlind: parsed.smallBlind,
          bigBlind: parsed.bigBlind,
        })
        if ('error' in result) {
          setCreateError(result.error)
          toast(result.error)
          return
        }
        navigate(`/r/${result.session.roomCode}`)
      } catch {
        const msg = ACK_REASONS.RELAY_UNREACHABLE
        setCreateError(msg)
        toast(msg)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    })()
  }

  const joinTable = () => {
    const parsed = parseRoomCode(joinCode)
    if (!parsed.ok) {
      toast(parsed.reason)
      return
    }
    void (async () => {
      const synced = await syncRoomFromRelay(parsed.code)
      if (synced.status !== 'ok') {
        toast(syncStatusToast(synced.status)!)
        return
      }
      dropForeignSession(parsed.code)
      navigate(`/r/${parsed.code}`)
    })()
  }

  const onTool = (id: (typeof TOOLS)[number]['id'], ready: boolean) => {
    if (!ready) {
      toast(COMING_SOON)
      return
    }
    if (id === 'chips') {
      navigate('/tools/chips')
    }
  }

  return (
    <div className="page home">
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
      <header className="home-hero">
        <p className="brand-en">Party Box</p>
        <h1 className="brand">聚会盒子</h1>
        <p className="tagline">开一桌，筹码、计时、分账随身带</p>
        <div className="cta-row">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              setShowJoin(false)
              setShowCreate((v) => !v)
            }}
          >
            {busy ? '开桌中…' : '开一桌'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setShowCreate(false)
              setShowJoin((v) => !v)
            }}
          >
            加入
          </button>
        </div>
        {showCreate && (
          <form
            className="create-room-form"
            data-create-room="1"
            onSubmit={(e) => {
              e.preventDefault()
              if (!busy) confirmCreate()
            }}
          >
            <label>
              买入
              <input
                className="input"
                name="buyInN"
                type="number"
                inputMode="numeric"
                step={1}
                placeholder="正整数"
                value={buyInN}
                onChange={(e) => setBuyInN(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              人数
              <input
                className="input"
                name="maxSeats"
                type="number"
                inputMode="numeric"
                step={1}
                value={maxSeats}
                onChange={(e) => setMaxSeats(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              小盲（选填）
              <input
                className="input"
                name="smallBlind"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="仅展示"
                value={smallBlind}
                onChange={(e) => setSmallBlind(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              大盲（选填）
              <input
                className="input"
                name="bigBlind"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="仅展示"
                value={bigBlind}
                onChange={(e) => setBigBlind(e.target.value)}
                disabled={busy}
              />
            </label>
            <p className="hint">盲注仅展示，不会自动扣除</p>
            <button
              type="submit"
              className="btn primary wide"
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? '开桌中…' : '确认'}
            </button>
            {createError && <p className="error">{createError}</p>}
          </form>
        )}
        {showJoin && (
          <div className="join-panel">
            <input
              className="input code-input"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="输入房间码"
              maxLength={8}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && joinTable()}
            />
            <button type="button" className="btn secondary" onClick={joinTable}>
              进入
            </button>
          </div>
        )}
      </header>

      <section className="tool-wall" aria-label="工具墙">
        <h2>工具墙</h2>
        <ul className="tool-grid">
          {TOOLS.map((tool) => (
            <li key={tool.id}>
              <button
                type="button"
                className="tool-tile"
                onClick={() => onTool(tool.id, tool.ready)}
              >
                <span className="tool-title">{tool.title}</span>
                <span className="tool-subtitle">{tool.subtitle}</span>
                <span className="badge">{tool.badge}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <A2HSHint />
    </div>
  )
}
