import { useMemo, useState } from 'react'
import { encode } from 'uqr'
import { roomJoinUrl } from '../types'
import { RoomSettingsReadout } from './RoomSettingsReadout'
import type { RoomState } from '../types'

interface JoinInviteProps {
  room: Pick<RoomState, 'roomCode' | 'buyInN' | 'maxSeats' | 'smallBlind' | 'bigBlind'>
  /** Smaller QR for menu / overlay. */
  compact?: boolean
  showSettings?: boolean
}

export function JoinInvite({
  room,
  compact = false,
  showSettings = false,
}: JoinInviteProps) {
  const url = roomJoinUrl(room.roomCode)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const qr = useMemo(() => encode(url, { ecc: 'M', border: 2 }), [url])

  const copy = async (kind: 'code' | 'link') => {
    const text = kind === 'code' ? room.roomCode.toUpperCase() : url
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      setCopied(null)
    }
  }

  const modules: boolean[][] = qr.data
  const size = qr.size
  const cell = compact ? 3 : 4

  return (
    <section className={`join-invite${compact ? ' compact' : ''}`} aria-label="扫码加入">
      <svg
        className="join-qr"
        data-join-url={url}
        width={size * cell}
        height={size * cell}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`房间二维码 ${room.roomCode.toUpperCase()}`}
      >
        <rect width={size} height={size} fill="#fff" />
        {modules.map((row, y) =>
          row.map((on, x) =>
            on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#111" /> : null,
          ),
        )}
      </svg>
      <p className="join-url" data-join-url={url}>
        {url}
      </p>
      <div className="cta-row">
        <button type="button" className="btn ghost compact" onClick={() => void copy('code')}>
          {copied === 'code' ? '已复制' : '复制房间码'}
        </button>
        <button type="button" className="btn ghost compact" onClick={() => void copy('link')}>
          {copied === 'link' ? '已复制' : '复制链接'}
        </button>
      </div>
      {showSettings && <RoomSettingsReadout room={room} />}
    </section>
  )
}
