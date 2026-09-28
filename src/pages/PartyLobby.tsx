import { JoinInvite } from '../components/JoinInvite'
import type { SeatPrivate } from '../games/undercover/deal'
import { VOTE_ABSTAIN } from '../games/undercover/speak'
import type { RoomMember, RoomState } from '../types'
import {
  UNDERCOVER_ROLE_LABEL,
  isUndercoverPrivatePhase,
  normalizeMaxSeats,
  partyHasWord,
  partyStubOf,
  tableFullReason,
} from '../types'
import type { Session } from '../store/localRoom'

interface PartyLobbyProps {
  room: RoomState
  session: Session
  isHost: boolean
  starting?: boolean
  seatPrivate: SeatPrivate | null
  onStart: () => void
  onReveal: () => void
  onNextRound: () => void
  onSpeakDone: () => void
  onCastVote: (targetSeatId: string) => void
}

const MIDJOIN = '本局已开始，本席未发词，请等下一局'

const PHASE_STEPS = [
  { id: 'speaking', label: '发言中' },
  { id: 'voting', label: '投票中' },
  { id: 'revealed', label: '揭晓' },
] as const

function nickOf(members: RoomMember[], seatId: string | null | undefined) {
  if (!seatId) return ''
  return members.find((m) => m.seatId === seatId)?.name || ''
}

function phaseBarId(phase: string) {
  if (phase === 'voting') return 'voting'
  if (phase === 'revealed') return 'revealed'
  if (phase === 'speaking' || phase === 'playing') return 'speaking'
  return ''
}

export function PartyLobby({
  room,
  session,
  isHost,
  starting = false,
  seatPrivate,
  onStart,
  onReveal,
  onNextRound,
  onSpeakDone,
  onCastVote,
}: PartyLobbyProps) {
  const cap = normalizeMaxSeats(room.maxSeats)
  const full = room.members.length >= cap
  const party = partyStubOf(room.party)
  const speaking = party.phase === 'speaking'
  const voting = party.phase === 'voting'
  const revealed = party.phase === 'revealed'
  const legacyPlaying = party.phase === 'playing'
  const inPrivate = isUndercoverPrivatePhase(party.phase)
  const online = room.members.filter((m) => m.connected).length
  const canStart = isHost && party.phase === 'lobby' && online >= 3
  const selfHasWord = partyHasWord(party, session.seatId)
  const showWord =
    inPrivate &&
    selfHasWord &&
    seatPrivate &&
    seatPrivate.seatId === session.seatId
  const round = party.round ?? 1
  const speakerNick = nickOf(room.members, party.speakerSeatId)
  const canSpeakDone =
    speaking && (isHost || session.seatId === party.speakerSeatId)
  const eliminated = new Set(party.eliminatedSeatIds || [])
  const selfOut = eliminated.has(session.seatId)
  const canVote = voting && selfHasWord && !selfOut
  const myVote = party.votes?.[session.seatId]
  const voteCounts: Record<string, number> = {}
  for (const target of Object.values(party.votes || {})) {
    if (target && target !== VOTE_ABSTAIN) {
      voteCounts[target] = (voteCounts[target] || 0) + 1
    }
  }
  const voteTargets = room.members.filter(
    (m) =>
      partyHasWord(party, m.seatId) &&
      !eliminated.has(m.seatId) &&
      m.seatId !== session.seatId,
  )
  const civWord =
    party.seats?.find((s) => s.role === 'civilian' && s.word)?.word || ''
  const ucWord =
    party.seats?.find((s) => s.role === 'undercover' && s.word)?.word || ''
  const barId = phaseBarId(party.phase)
  const hint = revealed
    ? `已揭晓 · 第${round}局`
    : voting
      ? `投票中 · 第${round}局`
      : speaking
        ? `发言中 · 第${round}局`
        : legacyPlaying
          ? `进行中 · 第${round}局`
          : '大厅 · 尚未发词'

  return (
    <div
      className="page lobby"
      data-mode="partyGame"
      data-party-phase={party.phase}
      data-game-id={party.gameId}
      data-has-word={selfHasWord ? 'true' : 'false'}
      data-party-round={inPrivate || revealed ? String(round) : ''}
      data-speaker-seat={party.speakerSeatId || ''}
      data-vote-round={voting ? String(party.voteRound ?? 0) : ''}
      data-winner={revealed && party.winner ? party.winner : ''}
    >
      <header className="lobby-header">
        <p className="eyebrow">局桌 · 谁是卧底</p>
        <h1>房间 {room.roomCode.toUpperCase()}</h1>
        <p className="hint">{hint}</p>
        <ol className="phase-bar" data-phase-bar="1" aria-label="阶段">
          {PHASE_STEPS.map((step) => (
            <li
              key={step.id}
              className={barId === step.id ? 'current' : ''}
              data-phase-step={step.id}
              aria-current={barId === step.id ? 'step' : undefined}
            >
              {step.label}
            </li>
          ))}
        </ol>
        {speaking && (
          <p className="stage-copy" data-turn-copy="1">
            {speakerNick ? `轮到 ${speakerNick} 描述` : '等待下一位发言'}
          </p>
        )}
        {voting && (
          <p className="stage-copy" data-vote-copy="1">
            投票中
          </p>
        )}
        {party.voteNotice && (voting || speaking) && (
          <p className="stage-copy" data-vote-notice="1">
            {party.voteNotice}
          </p>
        )}
      </header>

      <JoinInvite room={room} />

      {inPrivate && (
        <section className="private-screen" aria-label="私屏">
          {showWord ? (
            <div className="private-word-card" data-private-word={seatPrivate.word}>
              <p className="private-label">你的词</p>
              <p className="private-word">{seatPrivate.word}</p>
            </div>
          ) : selfHasWord ? (
            <p className="hint">发词中…</p>
          ) : (
            <p className="midjoin-hint" data-midjoin="1">
              {MIDJOIN}
            </p>
          )}
        </section>
      )}

      {revealed && !selfHasWord && (
        <p className="midjoin-hint" data-midjoin="1">
          {MIDJOIN}
        </p>
      )}

      {revealed && civWord && ucWord && (
        <section className="reveal-ritual" data-reveal-ritual="1" aria-label="揭晓">
          <p className="reveal-pair" data-reveal-civilian={civWord}>
            平民词 {civWord}
          </p>
          <p className="reveal-pair" data-reveal-undercover={ucWord}>
            卧底词 {ucWord}
          </p>
          {party.winner ? (
            <p className="reveal-winner" data-winner-copy="1">
              {party.winner === 'civilian' ? '平民胜' : '卧底胜'}
            </p>
          ) : null}
        </section>
      )}

      {voting && (
        <section className="vote-area" data-vote-area="1" aria-label="投票">
          <p className="prompt-placeholder">投票中</p>
          {party.voteNotice ? (
            <p className="hint" data-vote-notice="1">
              {party.voteNotice}
            </p>
          ) : null}
          {canVote ? (
            <>
              <ul className="vote-targets">
                {voteTargets.map((m) => {
                  const n = voteCounts[m.seatId] || 0
                  const picked = myVote === m.seatId
                  return (
                    <li key={m.seatId}>
                      <button
                        type="button"
                        className={picked ? 'picked' : ''}
                        data-vote-target={m.seatId}
                        data-vote-count={String(n)}
                        disabled={starting}
                        onClick={() => onCastVote(m.seatId)}
                      >
                        {m.name}
                        {n ? ` · ${n}票` : ''}
                        {picked ? ' · 已投' : ''}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <button
                type="button"
                className={myVote === VOTE_ABSTAIN ? 'picked wide' : 'wide'}
                data-vote-abstain="1"
                disabled={starting}
                onClick={() => onCastVote(VOTE_ABSTAIN)}
              >
                {myVote === VOTE_ABSTAIN ? '已弃权' : '弃权'}
              </button>
            </>
          ) : (
            <p className="hint">{selfOut ? '已出局' : '旁观投票'}</p>
          )}
        </section>
      )}

      <section
        className="member-list"
        aria-label={revealed ? '揭晓' : '成员'}
        data-reveal-list={revealed ? '1' : undefined}
      >
        <h2>
          {revealed ? `揭晓 · 第${round}局` : `成员 · ${room.members.length}/${cap}`}
        </h2>
        {full && <p className="hint">{tableFullReason(cap)}</p>}
        <ul>
          {room.members.map((m) => {
            const flagged = partyHasWord(party, m.seatId)
            const seat = party.seats?.find((s) => s.seatId === m.seatId)
            const isOut = eliminated.has(m.seatId) || seat?.alive === false
            const isSpeaker = speaking && !isOut && m.seatId === party.speakerSeatId
            const spoke = speaking && (party.spokeSeatIds || []).includes(m.seatId)
            return (
              <li
                key={m.seatId}
                className={[
                  m.seatId === session.seatId ? 'self' : '',
                  isSpeaker ? 'turn-speaker' : '',
                  isOut ? 'eliminated' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-seat-has-word={flagged ? 'true' : 'false'}
                data-speaking={isSpeaker ? '1' : undefined}
                data-spoke={spoke ? '1' : undefined}
                data-elim={isOut ? '1' : undefined}
                data-reveal-seat={revealed ? m.seatId : undefined}
                data-reveal-word={revealed ? seat?.word || '' : undefined}
                data-reveal-role={revealed ? seat?.role || '' : undefined}
              >
                <span className="member-name">
                  {m.name}
                  {m.seatId === session.seatId ? '（我）' : ''}
                </span>
                {m.isHost && <span className="host-badge">桌主</span>}
                {isSpeaker && <span className="turn-badge">发言</span>}
                {isOut && (
                  <span className="out-badge" data-out-badge="1">
                    已出局
                  </span>
                )}
                {m.connected ? (
                  <span className="online-dot">在线</span>
                ) : (
                  <span className="offline-dot">离线</span>
                )}
                {inPrivate && (
                  <span className={flagged ? 'word-dot' : 'noword-dot'}>
                    {flagged ? '已拿词' : '未发词'}
                  </span>
                )}
                {revealed && seat?.hasWord && seat.word && seat.role ? (
                  <>
                    <span className="reveal-word">{seat.word}</span>
                    <span className="reveal-role" data-role={seat.role}>
                      {UNDERCOVER_ROLE_LABEL[seat.role]}
                    </span>
                  </>
                ) : null}
                {revealed && !seat?.hasWord && (
                  <span className="noword-dot">未发词</span>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <footer className="lobby-footer">
        {revealed ? (
          isHost ? (
            <button
              type="button"
              className="btn primary wide"
              data-next-round="1"
              disabled={starting}
              aria-busy={starting}
              onClick={onNextRound}
            >
              {starting ? '发词中…' : '再来一局'}
            </button>
          ) : (
            <p className="waiting">等待桌主再来一局</p>
          )
        ) : speaking ? (
          canSpeakDone ? (
            <button
              type="button"
              className="btn primary wide"
              data-speak-done="1"
              disabled={starting}
              aria-busy={starting}
              onClick={onSpeakDone}
            >
              说完了
            </button>
          ) : (
            <p className="waiting">
              {speakerNick ? `等待 ${speakerNick} 说完` : '等待发言'}
            </p>
          )
        ) : voting ? (
          <p className="waiting">
            {canVote ? '点选一名存活席或弃权' : selfOut ? '已出局' : '投票中'}
          </p>
        ) : legacyPlaying ? (
          isHost ? (
            <button
              type="button"
              className="btn primary wide"
              data-reveal="1"
              disabled={starting}
              aria-busy={starting}
              onClick={onReveal}
            >
              {starting ? '揭晓中…' : '揭晓'}
            </button>
          ) : (
            <p className="waiting">等待桌主揭晓</p>
          )
        ) : isHost ? (
          <>
            <button
              type="button"
              className="btn primary wide"
              data-start-undercover="1"
              disabled={!canStart || starting}
              aria-busy={starting}
              onClick={onStart}
            >
              {starting ? '发词中…' : '开始游戏'}
            </button>
            {!canStart && (
              <p className="hint">{online < 3 ? '至少 3 人在线才能开始' : '等待开始'}</p>
            )}
          </>
        ) : (
          <p className="waiting">等待桌主开始</p>
        )}
      </footer>
    </div>
  )
}
