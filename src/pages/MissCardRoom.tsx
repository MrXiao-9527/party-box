import { useEffect, useMemo, useState } from 'react'
import { JoinInvite } from '../components/JoinInvite'
import {
  MISS_CARD_COMMAND_LIST,
  MISS_CARD_COPY,
  SUIT_GLYPH,
  commandOf,
} from '../games/missCard/commands'
import type { Session } from '../store/localRoom'
import type { RoomMember, RoomState } from '../types'
import {
  ACK_REASONS,
  PARTY_GAME_LABEL,
  isMissCardPhase,
  normalizeMaxSeats,
  partyStubOf,
  tableFullReason,
} from '../types'

interface MissCardRoomProps {
  room: RoomState
  session: Session
  isHost: boolean
  busy?: boolean
  onStart: () => void
  onDraw: () => void
  onComplete: () => void
  onPickTarget: (seatId: string) => void
  onSkipDrawer: () => void
  onSetKCups: (cups: number) => void
  onApplyK: () => void
  onUseToilet: () => void
  onReshuffle: () => void
  onEndGame: () => void
  onDeniedDraw: () => void
  onToast: (text: string) => void
}

function nickOf(members: RoomMember[], seatId: string | null | undefined) {
  if (!seatId) return ''
  return members.find((m) => m.seatId === seatId)?.name || ''
}

export function MissCardRoom({
  room,
  session,
  isHost,
  busy = false,
  onStart,
  onDraw,
  onComplete,
  onPickTarget,
  onSkipDrawer,
  onSetKCups,
  onApplyK,
  onUseToilet,
  onReshuffle,
  onEndGame,
  onDeniedDraw,
  onToast,
}: MissCardRoomProps) {
  const cap = normalizeMaxSeats(room.maxSeats)
  const full = room.members.length >= cap
  const party = partyStubOf(room.party)
  const phase = isMissCardPhase(party.phase) ? party.phase : 'lobby'
  const card = party.currentCard || null
  const cmd = card ? commandOf(card.rank) : null
  const remaining = Math.max(0, (party.deck?.length || 0) - (party.deckIndex || 0))
  const turnNick = nickOf(room.members, party.turnSeatId)
  const isDrawer = session.seatId === party.turnSeatId
  const online = room.members.filter((m) => m.connected)
  const missNick = nickOf(room.members, party.roles?.missSeatId)
  const psychoNick = nickOf(room.members, party.roles?.psychoSeatId)
  const myToilet = party.toiletRemaining?.[session.seatId] || 0
  const neighborNick = nickOf(room.members, party.resolvedNeighbor?.seatId)
  const targetNick = nickOf(room.members, party.targetSeatId)
  const [showRules, setShowRules] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [picking, setPicking] = useState(false)
  const [kCups, setKCups] = useState('3')
  const [confirmEnd, setConfirmEnd] = useState(false)

  const inPlay =
    phase === 'playing' ||
    phase === 'awaitComplete' ||
    phase === 'deckEmpty' ||
    phase === 'ended'
  const canStart =
    isHost &&
    (phase === 'lobby' || phase === 'ended') &&
    online.length >= 2
  const canDraw = phase === 'playing' && isDrawer
  const canComplete = phase === 'awaitComplete' && isDrawer
  const canSkip =
    isHost && (phase === 'playing' || phase === 'awaitComplete') && !!party.turnSeatId
  const showPick =
    phase === 'awaitComplete' && card?.rank === 'A' && (picking || party.needPickTarget)
  const kFirst = phase === 'awaitComplete' && card?.rank === 'K' && party.needSetK
  const kAgain =
    phase === 'awaitComplete' && card?.rank === 'K' && party.kExecuteCups != null

  useEffect(() => {
    if (card?.rank === 'A' && party.needPickTarget && isDrawer) setPicking(true)
    if (card?.rank !== 'A' || !party.needPickTarget) setPicking(false)
  }, [card?.rank, party.needPickTarget, isDrawer, card?.suit, party.deckIndex])

  const skipAt = party.skipNotice?.at || 0
  const skipText = party.skipNotice?.text || ''
  useEffect(() => {
    if (!skipText || !skipAt) return
    onToast(skipText)
    // only when at changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipAt, skipText])

  const stage = useMemo(() => {
    if (phase === 'lobby') return '大厅 · 尚未开局'
    if (phase === 'deckEmpty') return MISS_CARD_COPY.deckEmpty
    if (phase === 'ended') return MISS_CARD_COPY.ended
    if (phase === 'awaitComplete') {
      return isDrawer ? '执行后点「完成」' : `等待 ${turnNick || '…'} 完成`
    }
    if (isDrawer) return MISS_CARD_COPY.yourDraw
    return MISS_CARD_COPY.waitDraw(turnNick || '…')
  }, [phase, isDrawer, turnNick])

  function handleDraw() {
    if (!isDrawer) {
      onDeniedDraw()
      return
    }
    onDraw()
  }

  function submitK() {
    const n = Number(kCups)
    if (!Number.isInteger(n) || n <= 0) return
    onSetKCups(n)
  }

  const suitClass =
    card?.suit === 'heart' || card?.suit === 'diamond' ? 'red' : 'black'

  return (
    <div
      className="page lobby miss-card-room"
      data-mode="partyGame"
      data-party-phase={phase}
      data-game-id="miss-card"
      data-turn-seat={party.turnSeatId || ''}
      data-current-rank={card?.rank || ''}
      data-current-suit={card?.suit || ''}
      data-deck-remaining={String(remaining)}
      data-need-pick={party.needPickTarget ? 'true' : 'false'}
      data-need-set-k={party.needSetK ? 'true' : 'false'}
    >
      <header className="lobby-header">
        <p className="eyebrow">局桌 · {PARTY_GAME_LABEL['miss-card']}</p>
        <h1>房间 {room.roomCode.toUpperCase()}</h1>
        <p className="hint">{inPlay ? MISS_CARD_COPY.remaining(remaining) : '去王 52 张 · 轮流抽牌出令'}</p>
        <p className="stage-copy" data-stage="1" data-stage-copy="1">
          {stage}
        </p>
      </header>

      {(phase === 'lobby' || !inPlay) && <JoinInvite room={room} />}

      <section className="miss-roles" data-role-bar="1" aria-label="持续身份">
        <span
          className={missNick ? 'miss-badge on' : 'miss-badge'}
          data-role-miss={party.roles?.missSeatId || ''}
        >
          {MISS_CARD_COPY.miss}
          {missNick ? ` · ${missNick}` : ' · 无'}
        </span>
        <span
          className={psychoNick ? 'miss-badge psycho on' : 'miss-badge psycho'}
          data-role-psycho={party.roles?.psychoSeatId || ''}
        >
          {MISS_CARD_COPY.psycho}
          {psychoNick ? ` · ${psychoNick}` : ' · 无'}
        </span>
        {Object.entries(party.toiletRemaining || {}).map(([seatId, n]) => (
          <span key={seatId} className="miss-badge toilet on" data-toilet-seat={seatId}>
            {nickOf(room.members, seatId) || '席'} · {MISS_CARD_COPY.toilet(n)}
          </span>
        ))}
      </section>

      <section
        className="miss-card-face"
        data-card-area="1"
        data-command-name={cmd?.name || ''}
        data-command-kind={cmd?.kind || ''}
        aria-label="令面"
      >
        {card && cmd && phase === 'awaitComplete' ? (
          <>
            <p className={`miss-suit ${suitClass}`} data-card-suit={card.suit}>
              {SUIT_GLYPH[card.suit]}
            </p>
            <p className={`miss-rank ${suitClass}`} data-card-rank={card.rank}>
              {card.rank}
            </p>
            <p className="miss-cmd-name" data-command-title="1">
              {cmd.name}
            </p>
            <p className="miss-cmd-copy" data-command-copy={cmd.rank}>
              {cmd.instruction}
            </p>
            {card.rank === 'A' && (
              <p className="hint" data-pick-hint="1">
                {targetNick
                  ? `已指定 ${targetNick}`
                  : MISS_CARD_COPY.pickHint}
              </p>
            )}
            {(card.rank === 'J' || card.rank === 'Q') && (
              <p className="hint" data-neighbor="1" data-neighbor-side={party.resolvedNeighbor?.side || ''}>
                {neighborNick
                  ? `${party.resolvedNeighbor?.side === 'right' ? MISS_CARD_COPY.neighborRight : MISS_CARD_COPY.neighborLeft} · ${neighborNick}`
                  : MISS_CARD_COPY.noNeighbor}
              </p>
            )}
            {card.rank === '2' && missNick && (
              <p className="hint" data-role-now="miss">
                当前小姐：{missNick}
              </p>
            )}
            {card.rank === '10' && psychoNick && (
              <p className="hint" data-role-now="psycho">
                当前神经病：{psychoNick}
              </p>
            )}
            {card.rank === '8' && (
              <p className="hint" data-toilet-now="1">
                {MISS_CARD_COPY.toilet(party.toiletRemaining?.[party.turnSeatId || ''] || 0)}
              </p>
            )}
            {kFirst && (
              <div className="miss-k" data-k-first="1">
                <p className="hint">{MISS_CARD_COPY.kFirst}</p>
                <label>
                  杯数
                  <input
                    className="input"
                    data-k-cups="1"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={kCups}
                    onChange={(e) => setKCups(e.target.value)}
                    disabled={!isDrawer || busy}
                  />
                </label>
                {isDrawer && (
                  <button
                    type="button"
                    className="btn secondary wide"
                    data-set-k="1"
                    disabled={busy}
                    onClick={submitK}
                  >
                    {MISS_CARD_COPY.kSet}
                  </button>
                )}
              </div>
            )}
            {kAgain && (
              <div className="miss-k" data-k-again="1">
                <p className="hint" data-k-execute={String(party.kExecuteCups)}>
                  {MISS_CARD_COPY.kAgain(party.kExecuteCups || 0)}
                </p>
                {isDrawer && (
                  <>
                    <label>
                      重定杯数
                      <input
                        className="input"
                        data-k-cups="1"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={kCups}
                        onChange={(e) => setKCups(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn secondary wide"
                      data-set-k="1"
                      disabled={busy}
                      onClick={submitK}
                    >
                      {MISS_CARD_COPY.kReset}
                    </button>
                    <button
                      type="button"
                      className="btn ghost wide"
                      data-apply-k="1"
                      disabled={busy}
                      onClick={onApplyK}
                    >
                      {MISS_CARD_COPY.kApply}
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        ) : phase === 'deckEmpty' ? (
          <>
            <p className="prompt-placeholder">{MISS_CARD_COPY.deckEmpty}</p>
            <p className="hint">桌主可洗切重开或收局</p>
          </>
        ) : phase === 'ended' ? (
          <p className="prompt-placeholder">{MISS_CARD_COPY.ended}</p>
        ) : (
          <>
            <p className="prompt-placeholder">令面</p>
            <p className="hint">{stage}</p>
          </>
        )}
      </section>

      {phase === 'lobby' && (
        <section className="miss-rules-preview" data-rules-preview="1" aria-label="规则预览">
          <h2>十三令</h2>
          <ul>
            {MISS_CARD_COMMAND_LIST.map((row) => (
              <li key={row.rank} data-rule-rank={row.rank}>
                <strong>
                  {row.rank} {row.name}
                </strong>
                <span>{row.instruction}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="member-list" aria-label="成员">
        <h2>
          成员 · {room.members.length}/{cap}
        </h2>
        {full && <p className="hint">{tableFullReason(cap)}</p>}
        <ul>
          {room.members.map((m) => {
            const turn = m.seatId === party.turnSeatId
            const isMiss = m.seatId === party.roles?.missSeatId
            const isPsycho = m.seatId === party.roles?.psychoSeatId
            const toilet = party.toiletRemaining?.[m.seatId] || 0
            return (
              <li
                key={m.seatId}
                className={[
                  m.seatId === session.seatId ? 'self' : '',
                  turn ? 'turn-drawer' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-is-drawer={turn ? 'true' : 'false'}
              >
                <span className="member-name">
                  {m.name}
                  {m.seatId === session.seatId ? '（我）' : ''}
                </span>
                {m.isHost && <span className="host-badge">桌主</span>}
                {turn && inPlay && phase !== 'ended' && phase !== 'deckEmpty' && (
                  <span className="turn-badge">抽牌</span>
                )}
                {isMiss && <span className="turn-badge">{MISS_CARD_COPY.miss}</span>}
                {isPsycho && <span className="turn-badge">{MISS_CARD_COPY.psycho}</span>}
                {toilet > 0 && (
                  <span className="turn-badge" data-toilet={String(toilet)}>
                    {MISS_CARD_COPY.toilet(toilet)}
                  </span>
                )}
                {m.connected ? (
                  <span className="online-dot">在线</span>
                ) : (
                  <span className="offline-dot">离线</span>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {showPick && isDrawer && (
        <ul className="seat-picker" data-target-picker="1">
          {online.map((m) => (
            <li key={m.seatId}>
              <button
                type="button"
                className={
                  party.targetSeatId === m.seatId
                    ? 'btn secondary wide'
                    : 'btn ghost wide'
                }
                data-pick-target={m.seatId}
                disabled={busy}
                onClick={() => {
                  onPickTarget(m.seatId)
                  setPicking(false)
                }}
              >
                {MISS_CARD_COPY.pickAction} · {m.name}
                {m.seatId === session.seatId ? '（我）' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showRules && (
        <div className="confirm-overlay" data-rules-panel="1">
          <div className="confirm-box miss-rules-box">
            <h2>{MISS_CARD_COPY.rules}</h2>
            <ul>
              {MISS_CARD_COMMAND_LIST.map((row) => (
                <li key={row.rank} data-rule-rank={row.rank}>
                  <strong>
                    {row.rank} {row.name}
                  </strong>
                  <span>{row.instruction}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn primary wide"
              onClick={() => setShowRules(false)}
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="confirm-overlay" data-history-panel="1">
          <div className="confirm-box">
            <h2>{MISS_CARD_COPY.history}</h2>
            {(party.history || []).length === 0 ? (
              <p className="hint">暂无</p>
            ) : (
              <ul className="miss-history-list" data-prompt-history="1">
                {(party.history || []).map((item, i) => (
                  <li
                    key={`${item.seatId}-${item.at}-${i}`}
                    data-history-item={`${item.rank}-${i}`}
                    data-history-latest={i === 0 ? 'true' : 'false'}
                  >
                    {nickOf(room.members, item.seatId) || '…'} · {item.rank}
                    {item.suit ? SUIT_GLYPH[item.suit as keyof typeof SUIT_GLYPH] || '' : ''} ·{' '}
                    {item.commandName}
                    {item.targetSeatId
                      ? ` → ${nickOf(room.members, item.targetSeatId)}`
                      : ''}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="btn primary wide"
              onClick={() => setShowHistory(false)}
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {confirmEnd && (
        <div className="confirm-overlay" data-end-confirm="1">
          <div className="confirm-box">
            <p>确认收局？全员回到本房工具态。</p>
            <button
              type="button"
              className="btn primary wide"
              data-end-game="1"
              disabled={busy}
              onClick={() => {
                setConfirmEnd(false)
                onEndGame()
              }}
            >
              {MISS_CARD_COPY.endGame}
            </button>
            <button
              type="button"
              className="btn ghost wide"
              onClick={() => setConfirmEnd(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <footer className="lobby-footer">
        {(phase === 'lobby' || phase === 'ended') &&
          (isHost ? (
            <>
              <button
                type="button"
                className="btn primary wide"
                data-start-miss-card="1"
                disabled={!canStart || busy}
                aria-busy={busy}
                onClick={onStart}
              >
                {busy ? '开局中…' : MISS_CARD_COPY.start}
              </button>
              {!canStart && (
                <p className="hint">
                  {online.length < 2 ? ACK_REASONS.NEED_TWO_ONLINE : '等待开局'}
                </p>
              )}
            </>
          ) : (
            <p className="waiting">等待桌主开局</p>
          ))}

        {phase === 'playing' && (
          <button
            type="button"
            className={canDraw ? 'btn primary wide' : 'btn ghost wide'}
            data-draw-card="1"
            data-draw-self={isDrawer ? 'true' : 'false'}
            disabled={busy}
            aria-busy={busy}
            onClick={handleDraw}
          >
            {busy && isDrawer ? '抽牌中…' : MISS_CARD_COPY.draw}
          </button>
        )}

        {phase === 'awaitComplete' && canComplete && (
          <button
            type="button"
            className="btn primary wide"
            data-complete-turn="1"
            disabled={busy || party.needPickTarget || party.needSetK}
            onClick={onComplete}
          >
            {MISS_CARD_COPY.complete}
          </button>
        )}

        {phase === 'awaitComplete' && !isDrawer && (
          <p className="waiting">{`等待 ${turnNick || '…'} 完成`}</p>
        )}

        {card?.rank === 'A' && isDrawer && phase === 'awaitComplete' && !picking && (
          <button
            type="button"
            className="btn secondary wide"
            data-open-pick="1"
            disabled={busy}
            onClick={() => setPicking(true)}
          >
            {MISS_CARD_COPY.pickHint}
          </button>
        )}

        {myToilet > 0 && inPlay && phase !== 'ended' && (
          <button
            type="button"
            className="btn ghost wide"
            data-use-toilet="1"
            disabled={busy}
            onClick={onUseToilet}
          >
            {MISS_CARD_COPY.useToilet}
          </button>
        )}

        {canSkip && (
          <button
            type="button"
            className="btn ghost wide"
            data-skip-drawer="1"
            disabled={busy || online.length === 0}
            onClick={onSkipDrawer}
          >
            {MISS_CARD_COPY.skipDrawer}
          </button>
        )}

        {phase === 'deckEmpty' &&
          (isHost ? (
            <>
              <button
                type="button"
                className="btn primary wide"
                data-reshuffle="1"
                disabled={busy || online.length < 2}
                onClick={onReshuffle}
              >
                {MISS_CARD_COPY.reshuffle}
              </button>
              <button
                type="button"
                className="btn ghost wide"
                data-end-game-open="1"
                disabled={busy}
                onClick={() => setConfirmEnd(true)}
              >
                {MISS_CARD_COPY.endGame}
              </button>
            </>
          ) : (
            <p className="waiting">等待桌主洗切重开或收局</p>
          ))}

        {inPlay && (
          <>
            <button
              type="button"
              className="btn ghost wide"
              data-history="1"
              onClick={() => setShowHistory(true)}
            >
              {MISS_CARD_COPY.history}
            </button>
            <button
              type="button"
              className="btn ghost wide"
              data-rules="1"
              onClick={() => setShowRules(true)}
            >
              {MISS_CARD_COPY.rules}
            </button>
          </>
        )}

        {phase === 'playing' && !isDrawer && (
          <p className="waiting">{MISS_CARD_COPY.waitDraw(turnNick || '…')}</p>
        )}
      </footer>
    </div>
  )
}
