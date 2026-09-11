import { useState } from 'react'
import { loadSession, type Session } from '../store/localRoom'
import type { PersistedRoom } from '../store/localRoom'
import { claimHostSeat, joinRoom, syncRoomFromRelay, syncStatusToast } from '../sync/roomApi'
import { ACK_REASONS, parseRoomCode } from '../types'
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
  const [busy, setBusy] = useState(false)

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

    void (async () => {
      setBusy(true)
      try {
        const synced = await syncRoomFromRelay(parsed.code)
        if (synced.status !== 'ok') {
          fail(syncStatusToast(synced.status)!)
          return
        }
        const existing = synced.data

        const session = loadSession()
        const reservedHost =
          session?.roomCode === parsed.code &&
          session.seatId === existing.room.hostSeatId
        const hostSeatTaken = existing.room.members.some(
          (m) => m.seatId === existing.room.hostSeatId && m.name,
        )
        // First claim after「开一桌」(host seat reserved on create).
        // Cold /r/{CODE} guests must joinRoom — never claim-host.
        if (session && reservedHost && !hostSeatTaken) {
          const data = await claimHostSeat(parsed.code, session.seatId, trimmed)
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

        const result = await joinRoom(parsed.code, trimmed)
        if ('error' in result) {
          fail(result.error)
          return
        }
        saveIdentity({
          roomCode: result.session.roomCode,
          seatId: result.session.seatId,
          name: result.session.name,
          role:
            result.data.room.hostSeatId === result.session.seatId
              ? 'host'
              : 'player',
        })
        onReady(result.session, result.data)
      } catch {
        fail(ACK_REASONS.RELAY_UNREACHABLE)
      } finally {
        setBusy(false)
      }
    })()
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
          onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}
          disabled={busy}
        />
        {error && <p className="error">{error}</p>}
        <button
          type="button"
          className="btn primary wide"
          onClick={submit}
          disabled={busy}
        >
          进入
        </button>
      </div>
    </div>
  )
}
