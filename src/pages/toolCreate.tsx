import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ToastStack } from '../components/Toast'
import type { PartyGameId } from '../types'

export function ToolPageShell({
  title,
  blurb,
  pageId,
  toasts,
  onDismissToast,
  children,
}: {
  title: string
  blurb: string
  pageId: string
  toasts: { id: string; text: string }[]
  onDismissToast: (id: string) => void
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div className="page stub tool-landing" data-tool-page={pageId}>
      <ToastStack toasts={toasts} onDismiss={onDismissToast} />
      <p className="eyebrow">工具</p>
      <h1>{title}</h1>
      <p className="hint">{blurb}</p>
      {children}
      <div className="cta-row tool-back-row">
        <button type="button" className="btn ghost" onClick={() => navigate('/')}>
          回首页
        </button>
      </div>
    </div>
  )
}

export function ChipCreateForm({
  busy,
  createError,
  onSubmit,
}: {
  busy: boolean
  createError: string
  onSubmit: (input: {
    buyInN: string
    maxSeats: string
    smallBlind: string
    bigBlind: string
  }) => void
}) {
  const [buyInN, setBuyInN] = useState('')
  const [maxSeats, setMaxSeats] = useState('8')
  const [smallBlind, setSmallBlind] = useState('')
  const [bigBlind, setBigBlind] = useState('')

  return (
    <form
      className="create-room-form"
      data-create-room="1"
      data-mode="chip"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy) {
          onSubmit({ buyInN, maxSeats, smallBlind, bigBlind })
        }
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
  )
}

export function PartyCreateForm({
  gameId,
  hint,
  busy,
  createError,
  onSubmit,
}: {
  gameId: PartyGameId
  hint: string
  busy: boolean
  createError: string
  onSubmit: (maxSeats: string) => void
}) {
  const [maxSeats, setMaxSeats] = useState('8')

  return (
    <form
      className="create-room-form"
      data-create-party="1"
      data-selected-game={gameId}
      data-game-id={gameId}
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy) onSubmit(maxSeats)
      }}
    >
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
      <p className="hint">{hint}</p>
      <button
        type="submit"
        className="btn primary wide"
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? '开局中…' : '确认'}
      </button>
      {createError && <p className="error">{createError}</p>}
    </form>
  )
}
