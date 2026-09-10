import { useSearchParams } from 'react-router-dom'

interface DevPanelProps {
  onHostPause: () => void
  onFillSeats: () => void
  onToggleOffline: () => void
  connectionState: 'online' | 'offline'
  seatCount: number
  maxSeats: number
}

/** DEV-only QA helpers: ?dev=1 */
export function DevPanel({
  onHostPause,
  onFillSeats,
  onToggleOffline,
  connectionState,
  seatCount,
  maxSeats,
}: DevPanelProps) {
  const [params] = useSearchParams()
  if (params.get('dev') !== '1') return null

  return (
    <aside className="dev-panel" aria-label="DEV">
      <p className="dev-title">DEV</p>
      <button type="button" onClick={onHostPause}>
        模拟桌主离线/暂停
      </button>
      <button type="button" onClick={onFillSeats}>
        填满座位 ({seatCount}/{maxSeats})
      </button>
      <button type="button" onClick={onToggleOffline}>
        {connectionState === 'offline' ? '恢复连接条' : '断开连接条'}
      </button>
    </aside>
  )
}
