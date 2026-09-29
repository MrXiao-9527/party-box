import { useState } from 'react'
import { PARTY_GAME_LABEL } from '../types'
import { PartyCreateForm, ToolPageShell } from './toolCreate'
import { useHostRoomCreate } from './useHostRoomCreate'

const MODE = 'partyGame' as const
const GAME_ID = 'miss-card' as const

export function ToolMissCardPage() {
  const { busy, createError, toasts, dismissToast, runCreate } =
    useHostRoomCreate()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <ToolPageShell
      title={PARTY_GAME_LABEL['miss-card']}
      blurb="十三钗 · 轮流抽牌出令"
      pageId="miss-card"
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
          hint="2–8 人 · 小姐牌（去王 52 张，轮流抽牌出令）"
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
