import { useState } from 'react'
import { PARTY_GAME_LABEL } from '../types'
import { PartyCreateForm, ToolPageShell } from './toolCreate'
import { useHostRoomCreate } from './useHostRoomCreate'

const MODE = 'partyGame' as const
const GAME_ID = 'truthDare' as const

export function ToolTruthDarePage() {
  const { busy, createError, toasts, dismissToast, runCreate } =
    useHostRoomCreate()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <ToolPageShell
      title={PARTY_GAME_LABEL.truthDare}
      blurb="轮流抽题，公屏同题"
      pageId="truthDare"
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
          hint="2–8 人 · 真心话大冒险（桌主抽题，双端同屏）"
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
