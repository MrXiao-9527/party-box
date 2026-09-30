import { useState } from 'react'
import { PARTY_GAME_LABEL } from '../types'
import { PartyCreateForm, ToolPageShell } from './toolCreate'
import { useHostRoomCreate } from './useHostRoomCreate'

const MODE = 'partyGame' as const
const GAME_ID = 'werewolf-deal' as const

export function ToolWerewolfDealPage() {
  const { busy, createError, toasts, dismissToast, runCreate } =
    useHostRoomCreate()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <ToolPageShell
      title={PARTY_GAME_LABEL['werewolf-deal']}
      blurb="按人数配板，私密看自己，公屏只见构成"
      pageId="werewolf-deal"
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
          defaultMaxSeats="10"
          hint="2–10 人 · 按入座席自动配板，桌主可微调后发牌"
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
