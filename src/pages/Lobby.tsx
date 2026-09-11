import { useRef, useState, type PointerEvent } from 'react'
import type { RoomState } from '../types'
import { MAX_SEATS } from '../types'
import type { Session } from '../store/localRoom'

interface LobbyProps {
  room: RoomState
  session: Session
  isHost: boolean
  onStart: () => void
}

export function Lobby({ room, session, isHost, onStart }: LobbyProps) {
  const [copied, setCopied] = useState(false)
  const pressLock = useRef(false)
  const full = room.members.length >= MAX_SEATS

  const start = () => {
    if (pressLock.current) return
    pressLock.current = true
    onStart()
    window.setTimeout(() => {
      pressLock.current = false
    }, 600)
  }

  const onStartPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') start()
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.roomCode.toUpperCase())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="page lobby">
      <header className="lobby-header">
        <p className="eyebrow">等候开桌</p>
        <h1>房间 {room.roomCode.toUpperCase()}</h1>
        <button type="button" className="btn ghost compact" onClick={copyCode}>
          {copied ? '已复制' : '复制房间码'}
        </button>
      </header>

      <section className="member-list" aria-label="成员">
        <h2>
          成员 · {room.members.length}/{MAX_SEATS}
        </h2>
        {full && <p className="hint">本桌已满（最多8人）</p>}
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
          <button
            type="button"
            className="btn primary wide"
            onClick={start}
            onPointerUp={onStartPointerUp}
          >
            开桌
          </button>
        ) : (
          <p className="waiting">等待桌主开桌…</p>
        )}
      </footer>
    </div>
  )
}
