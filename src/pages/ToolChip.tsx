import { useState } from 'react'
import { ChipCreateForm, ToolPageShell } from './toolCreate'
import { useHostRoomCreate } from './useHostRoomCreate'

const MODE = 'chip' as const

export function ToolChipPage() {
  const { busy, createError, toasts, dismissToast, runCreate } =
    useHostRoomCreate()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <ToolPageShell
      title="筹码桌"
      blurb="多人计数，进房同步"
      pageId="chip"
      toasts={toasts}
      onDismissToast={dismissToast}
    >
      <button
        type="button"
        className="btn primary tool-open-btn"
        data-chip-create="1"
        disabled={busy}
        aria-busy={busy && showCreate}
        onClick={() => setShowCreate((v) => !v)}
      >
        {busy && showCreate ? '开桌中…' : '开一桌'}
      </button>
      {showCreate && (
        <ChipCreateForm
          busy={busy}
          createError={createError}
          onSubmit={({ buyInN, maxSeats, smallBlind, bigBlind }) => {
            void runCreate(
              { buyInN, maxSeats, smallBlind, bigBlind, mode: MODE },
              { strictBuyIn: true },
            )
          }}
        />
      )}
    </ToolPageShell>
  )
}
