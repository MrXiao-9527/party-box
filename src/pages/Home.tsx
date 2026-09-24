import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { A2HSHint } from '../components/A2HSHint'
import { ToastStack } from '../components/Toast'
import { syncRoomFromRelay, syncStatusToast } from '../sync/roomApi'
import { dropForeignSession } from '../store/localRoom'
import { takeFlashToast } from '../sync/flashToast'
import { PARTY_GAME_LABEL, parseRoomCode } from '../types'

const TOOLS = [
  {
    id: 'chip',
    path: '/tools/chip',
    title: '筹码桌',
    subtitle: '多人计数，进房同步',
  },
  {
    id: 'undercover',
    path: '/tools/undercover',
    title: PARTY_GAME_LABEL.undercover,
    subtitle: '私屏词语，桌内揭晓',
  },
  {
    id: 'truthDare',
    path: '/tools/truthDare',
    title: PARTY_GAME_LABEL.truthDare,
    subtitle: '轮流抽题，公屏同题',
  },
] as const

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

  useEffect(() => {
    const flash = takeFlashToast()
    if (flash) toast(flash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  return (
    <div className="page home">
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
      <header className="home-hero">
        <p className="brand-en">Party Box</p>
        <h1 className="brand">聚会盒子</h1>
        <p className="tagline">先选工具，再开一桌</p>
        <div className="cta-row">
          <button
            type="button"
            className="btn ghost"
            data-home-join="1"
            onClick={() => setShowJoin((v) => !v)}
          >
            加入
          </button>
        </div>
        {showJoin && (
          <div className="join-panel" data-join-panel="1">
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

      <section className="tool-wall" aria-label="工具">
        <h2>工具</h2>
        <ul className="tool-grid tool-grid-main">
          {TOOLS.map((tool) => (
            <li key={tool.id}>
              <button
                type="button"
                className="tool-tile"
                data-tool={tool.id}
                onClick={() => navigate(tool.path)}
              >
                <span className="tool-title">{tool.title}</span>
                <span className="tool-subtitle">{tool.subtitle}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <A2HSHint />
    </div>
  )
}
