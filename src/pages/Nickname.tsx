import { useState } from 'react'
import {
  claimHostSeat,
  joinRoom,
  loadRoom,
  loadSession,
  type Session,
} from '../store/localRoom'
import type { PersistedRoom } from '../store/localRoom'
import { parseRoomCode } from '../types'
import { saveIdentity } from '../sync/seatRestore'

interface NicknameGateProps {
  roomCode: string
  prefillName?: string
  onReady: (session: Session, data: PersistedRoom) => void
  onError?: (msg: string) => void
}

export function NicknameGate({
  roomCode,
  prefillName = '',
  onReady,
  onError,
}: NicknameGateProps) {
  const [name, setName] = useState(prefillName)
  const [error, setError] = useState('')

  const fail = (msg: string) => {
    setError(msg)
    onError?.(msg)
  }

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      fail('请输入昵称')
      return
    }
    if (trimmed.length > 12) {
      fail('昵称最多 12 字')
      return
    }

    const parsed = parseRoomCode(roomCode)
    if (!parsed.ok) {
      fail(parsed.reason)
      return
    }

    const existing = loadRoom(parsed.code)
    if (!existing) {
      fail('房间已结束')
      return
    }

    const session = loadSession()
    // First claim after「开一桌」
    if (
      existing.room.members.length === 0 &&
      session?.roomCode === parsed.code &&
      session.seatId === existing.room.hostSeatId &&
      !session.name
    ) {
      const data = claimHostSeat(parsed.code, session.seatId, trimmed)
      if (data) {
        const next = {
          seatId: session.seatId,
          name: trimmed,
          roomCode: parsed.code,
        }
        saveIdentity({
          ...next,
          role: 'host',
        })
        onReady(next, data)
        return
      }
    }

    const result = joinRoom(parsed.code, trimmed)
    if ('error' in result) {
      fail(result.error)
      return
    }
    saveIdentity({
      roomCode: result.session.roomCode,
      seatId: result.session.seatId,
      name: result.session.name,
      role:
        result.data.room.hostSeatId === result.session.seatId ? 'host' : 'player',
    })
    onReady(result.session, result.data)
  }

  return (
    <div className="page nickname">
      <div className="nickname-card">
        <p className="eyebrow">房间 {roomCode.toUpperCase()}</p>
        <h1>怎么称呼你？</h1>
        <p className="hint">昵称只在这一桌显示，无需注册</p>
        <input
          className="input"
          autoFocus
          maxLength={12}
          placeholder="输入昵称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {error && <p className="error">{error}</p>}
        <button type="button" className="btn primary wide" onClick={submit}>
          进入
        </button>
      </div>
    </div>
  )
}
