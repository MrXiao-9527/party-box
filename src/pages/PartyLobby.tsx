import { JoinInvite } from '../components/JoinInvite'
import type { SeatPrivate } from '../games/undercover/deal'
import type { RoomState } from '../types'
import {
  UNDERCOVER_ROLE_LABEL,
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
}

const MIDJOIN = '本局已开始，本席未发词，请等下一局'

export function PartyLobby({
  room,
  session,
  isHost,
  starting = false,
  seatPrivate,
  onStart,
  onReveal,
  onNextRound,
}: PartyLobbyProps) {
  const cap = normalizeMaxSeats(room.maxSeats)
  const full = room.members.length >= cap
  const party = partyStubOf(room.party)
  const playing = party.phase === 'playing'
  const revealed = party.phase === 'revealed'
  const online = room.members.filter((m) => m.connected).length
  const canStart = isHost && party.phase === 'lobby' && online >= 3
  const selfHasWord = partyHasWord(party, session.seatId)
  const showWord =
    playing &&
    selfHasWord &&
    seatPrivate &&
    seatPrivate.seatId === session.seatId
  const round = party.round ?? 1
  const hint = revealed
    ? `已揭晓 · 第${round}局`
    : playing
      ? `进行中 · 第${round}局`
      : '大厅 · 尚未发词'

  return (
    <div
      className="page lobby"
      data-mode="partyGame"
      data-party-phase={party.phase}
      data-game-id={party.gameId}
      data-has-word={selfHasWord ? 'true' : 'false'}
      data-party-round={playing || revealed ? String(round) : ''}
    >
      <header className="lobby-header">
        <p className="eyebrow">局桌 · 谁是卧底</p>
        <h1>房间 {room.roomCode.toUpperCase()}</h1>
        <p className="hint">{hint}</p>
      </header>

      <JoinInvite room={room} />

      {playing && (
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
            return (
              <li
                key={m.seatId}
                className={m.seatId === session.seatId ? 'self' : ''}
                data-seat-has-word={flagged ? 'true' : 'false'}
                data-reveal-seat={revealed ? m.seatId : undefined}
                data-reveal-word={revealed ? seat?.word || '' : undefined}
                data-reveal-role={revealed ? seat?.role || '' : undefined}
              >
                <span className="member-name">
                  {m.name}
                  {m.seatId === session.seatId ? '（我）' : ''}
                </span>
                {m.isHost && <span className="host-badge">桌主</span>}
                {m.connected ? (
                  <span className="online-dot">在线</span>
                ) : (
                  <span className="offline-dot">离线</span>
                )}
                {playing && (
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
              {starting ? '发词中…' : '下一局'}
            </button>
          ) : (
            <p className="waiting">等待桌主开下一局</p>
          )
        ) : playing ? (
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
