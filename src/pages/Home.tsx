import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { A2HSHint } from '../components/A2HSHint'
import { ToastStack } from '../components/Toast'
import { createEmptyHostRoom, loadRoom, syncRoomFromRelay } from '../sync/roomApi'
import { parseRoomCode } from '../types'

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
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([])

  const toast = (text: string) => {
    const id = `t_${Date.now()}`
    setToasts((prev) => [...prev, { id, text }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 2800)
  }

  const openTable = () => {
    void (async () => {
      try {
        const { session } = await createEmptyHostRoom()
        navigate(`/r/${session.roomCode}`)
      } catch {
        toast('无法创建房间，请检查网络或中继服务')
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
      const remote = await syncRoomFromRelay(parsed.code)
      if (!remote && !loadRoom(parsed.code)) {
        toast('房间不存在或已解散')
        return
      }
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
          <button type="button" className="btn primary" onClick={openTable}>
            开一桌
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setShowJoin((v) => !v)}
          >
            加入
          </button>
        </div>
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
