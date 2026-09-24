import { useState } from 'react'
import { PARTY_GAME_LABEL } from '../types'
import { PartyCreateForm, ToolPageShell } from './toolCreate'
import { useHostRoomCreate } from './useHostRoomCreate'

const MODE = 'partyGame' as const
const GAME_ID = 'undercover' as const

export function ToolUndercoverPage() {
  const { busy, createError, toasts, dismissToast, runCreate } =
    useHostRoomCreate()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <ToolPageShell
      title={PARTY_GAME_LABEL.undercover}
      blurb="私屏词语，桌内揭晓"
      pageId="undercover"
      toasts={toasts}
      onDismissToast={dismissToast}
    >
      <button
        type="button"
        className="btn primary tool-open-btn"
        disabled={busy}
        aria-busy={busy && showCreate}
        onClick={() => setShowCreate((v) => !v)}
      >
        {busy && showCreate ? '开局中…' : '开一桌'}
      </button>
      {showCreate && (
        <PartyCreateForm
          gameId={GAME_ID}
          hint="2–8 人 · 谁是卧底（满 3 人在线可发词）"
          busy={busy}
          createError={createError}
          onSubmit={(maxSeats) => {
            void runCreate({
              maxSeats,
              mode: MODE,
              gameId: GAME_ID,
            })
          }}
        />
      )}
    </ToolPageShell>
  )
}
