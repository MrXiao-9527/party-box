import { useEffect, useState } from 'react'

const DISMISS_KEY = 'party-box:a2hs-dismissed'

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    ('standalone' in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  )
}

/** Soft add-to-home hint — never blocks first entry. */
export function A2HSHint() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    if (localStorage.getItem(DISMISS_KEY)) return
    const t = window.setTimeout(() => setVisible(true), 4000)
    return () => window.clearTimeout(t)
  }, [])

  if (!visible) return null

  return (
    <div className="a2hs" role="note">
      <p>添加到主屏幕，开局更快</p>
      <button
        type="button"
        className="a2hs-dismiss"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1')
          setVisible(false)
        }}
      >
        知道了
      </button>
    </div>
  )
}
