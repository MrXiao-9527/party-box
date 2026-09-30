import { useMemo, useState } from 'react'
import { JoinInvite } from '../components/JoinInvite'
import {
  CAMP_LABEL,
  LATE_JOIN_COPY,
  REDEAL_CONFIRM,
  ROLE_IDS,
  ROLE_META,
  STAGE_COPY,
  STAGE_HINT,
  blurbOf,
  isWerewolfPrivate,
  type WerewolfRoleId,
  type WerewolfSeatPrivate,
  type WerewolfStage,
} from '../games/werewolfDeal/roles'
import { canDeal, dealRefusal, sumBoard } from '../games/werewolfDeal/engine'
import type { Session } from '../store/localRoom'
import type { RoomState, WerewolfBoard } from '../types'
import { PARTY_GAME_LABEL, normalizeMaxSeats, partyStubOf, tableFullReason } from '../types'

const STAGES: WerewolfStage[] = ['idle', 'night', 'day', 'vote']

interface WerewolfDealRoomProps {
  room: RoomState
  session: Session
  isHost: boolean
  busy?: boolean
  seatPrivate: WerewolfSeatPrivate | null
  onTweak: (board: WerewolfBoard) => void
  onResetBoard: () => void
  onDeal: () => void
  onRedeal: () => void
  onSetStage: (stage: WerewolfStage) => void
}

function boardFromParty(party: ReturnType<typeof partyStubOf>): WerewolfBoard {
  return {
    werewolf: party.board?.werewolf ?? 0,
    villager: party.board?.villager ?? 0,
    seer: party.board?.seer ?? 0,
    witch: party.board?.witch ?? 0,
    hunter: party.board?.hunter ?? 0,
    guard: party.board?.guard ?? 0,
  }
}

export function WerewolfDealRoom({
  room,
  session,
  isHost,
  busy = false,
  seatPrivate,
  onTweak,
  onResetBoard,
  onDeal,
  onRedeal,
  onSetStage,
}: WerewolfDealRoomProps) {
  const cap = normalizeMaxSeats(room.maxSeats)
  const full = room.members.length >= cap
  const party = partyStubOf(room.party)
  const board = boardFromParty(party)
  const seatCount = party.seatCount ?? room.members.length
  const dealt = party.phase === 'dealt'
  const stage = (party.stage || 'idle') as WerewolfStage
  const gate = dealRefusal(board, seatCount)
  const allowDeal = canDeal(board, seatCount)
  const mine =
    dealt &&
    isWerewolfPrivate(seatPrivate) &&
    seatPrivate.seatId === session.seatId &&
    (party.dealtSeatIds || []).includes(session.seatId)
  const lateJoin =
    dealt && !(party.dealtSeatIds || []).includes(session.seatId)
  const [confirmRedeal, setConfirmRedeal] = useState(false)

  const composition = useMemo(() => {
    const rows = party.roleComposition
    if (rows && rows.length) return rows
    return ROLE_IDS.filter((id) => board[id] > 0).map((id) => ({
      roleId: id,
      label: ROLE_META[id].label,
      count: board[id],
    }))
  }, [party.roleComposition, board])

  const bump = (roleId: WerewolfRoleId, delta: number) => {
    if (!isHost || dealt || busy) return
    const next = { ...board, [roleId]: Math.max(0, board[roleId] + delta) }
    onTweak(next)
  }

  const hint = dealt
    ? `${STAGE_COPY[stage]} · 已发牌`
    : party.boardTweaked
      ? '大厅 · 已微调配板'
      : '大厅 · 自动配板'

  return (
    <div
      className="page lobby"
      data-mode="partyGame"
      data-party-phase={party.phase}
      data-game-id="werewolf-deal"
      data-werewolf-stage={stage}
      data-seat-count={String(seatCount)}
      data-board-tweaked={party.boardTweaked ? 'true' : 'false'}
      data-can-deal={allowDeal ? 'true' : 'false'}
      data-deal-gate={gate || ''}
    >
      <header className="lobby-header">
        <p className="eyebrow">局桌 · {PARTY_GAME_LABEL['werewolf-deal']}</p>
        <h1>房间 {room.roomCode.toUpperCase()}</h1>
        <p className="hint">{hint}</p>
        <div className="play-stack" data-play-stack="1">
          <ol className="phase-bar" data-phase-bar="1" aria-label="阶段">
            {STAGES.map((id) => (
              <li
                key={id}
                className={stage === id ? 'current' : ''}
                data-phase-step={id}
                aria-current={stage === id ? 'step' : undefined}
              >
                {STAGE_COPY[id]}
              </li>
            ))}
          </ol>
          {dealt && (
            <p className="stage-copy turn-copy" data-stage-copy="1">
              {STAGE_COPY[stage]}
            </p>
          )}
          {dealt && (
            <p className="hint" data-stage-hint="1">
              {STAGE_HINT}
            </p>
          )}
        </div>
      </header>

      <JoinInvite room={room} />

      <section className="werewolf-composition" data-composition="1" aria-label="公开构成">
        <h2>本局构成</h2>
        <ul className="werewolf-chips">
          {composition.length ? (
            composition.map((row) => (
              <li key={row.roleId} data-comp-role={row.roleId} data-comp-count={row.count}>
                {row.label}×{row.count}
              </li>
            ))
          ) : (
            <li data-comp-empty="1">人数不足，尚无默认板</li>
          )}
        </ul>
        <p className="hint" data-board-sum={`sum=${sumBoard(board)}/${seatCount}`}>
          发牌席 {seatCount} · 板子 {sumBoard(board)} 张
          {party.boardTweaked ? ' · 已微调' : ' · 自动板'}
        </p>
        {gate && !dealt && (
          <p className="error" data-board-error="1">
            {gate}
          </p>
        )}
      </section>

      {!dealt && (
        <section className="werewolf-board" data-werewolf-board="1" aria-label="配板">
          <h2>角色数量</h2>
          <ul className="werewolf-steppers">
            {ROLE_IDS.map((id) => (
              <li key={id} data-role-row={id} data-role-count={board[id]}>
                <span className="werewolf-role-name">
                  {ROLE_META[id].label}
                  <span className="werewolf-camp">{CAMP_LABEL[ROLE_META[id].camp]}</span>
                </span>
                <span className="werewolf-stepper">
                  <button
                    type="button"
                    data-tweak={id}
                    data-dir="dec"
                    disabled={!isHost || busy || board[id] <= 0}
                    onClick={() => bump(id, -1)}
                  >
                    −
                  </button>
                  <strong data-role-count-value={id}>{board[id]}</strong>
                  <button
                    type="button"
                    data-tweak={id}
                    data-dir="inc"
                    disabled={!isHost || busy}
                    onClick={() => bump(id, 1)}
                  >
                    +
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {isHost && party.boardTweaked && (
            <button
              type="button"
              className="btn ghost wide"
              data-reset-board="1"
              disabled={busy}
              onClick={onResetBoard}
            >
              恢复自动板
            </button>
          )}
        </section>
      )}

      {dealt && (
        <section className="private-screen" aria-label="私屏">
          {mine ? (
            <div
              className={`private-word-card werewolf-role-card camp-${seatPrivate.camp}`}
              data-private-role={seatPrivate.roleId}
              data-private-camp={seatPrivate.camp}
              data-private-deal={seatPrivate.dealId}
            >
              <p className="private-label">你的身份</p>
              <p className="private-word">{seatPrivate.label}</p>
              <p className="werewolf-camp-line">{CAMP_LABEL[seatPrivate.camp]}阵营</p>
              <p className="hint">{blurbOf(seatPrivate.roleId)}</p>
            </div>
          ) : lateJoin ? (
            <p className="midjoin-hint" data-late-join="1">
              {LATE_JOIN_COPY}
            </p>
          ) : (
            <p className="hint">发牌中…</p>
          )}
        </section>
      )}

      <section className="member-list" aria-label="成员">
        <h2>
          成员 · {room.members.length}/{cap}
        </h2>
        {full && <p className="hint">{tableFullReason(cap)}</p>}
        <ul>
          {room.members.map((m) => {
            const gotCard = (party.dealtSeatIds || []).includes(m.seatId)
            return (
              <li
                key={m.seatId}
                className={m.seatId === session.seatId ? 'self' : ''}
                data-seat-dealt={gotCard ? 'true' : 'false'}
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
                {dealt && (
                  <span className={gotCard ? 'word-dot' : 'noword-dot'}>
                    {gotCard ? '已发牌' : '未发牌'}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <footer className="lobby-footer">
        {dealt ? (
          isHost ? (
            <>
              <div className="werewolf-stage-row" data-stage-controls="1">
                {STAGES.filter((id) => id !== 'idle').map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={stage === id ? 'btn primary' : 'btn ghost'}
                    data-set-stage={id}
                    disabled={busy}
                    onClick={() => onSetStage(id)}
                  >
                    {STAGE_COPY[id]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn secondary wide"
                data-redeal="1"
                disabled={busy}
                onClick={() => setConfirmRedeal(true)}
              >
                重发
              </button>
            </>
          ) : (
            <p className="waiting">等待桌主切阶段或重发</p>
          )
        ) : isHost ? (
          <>
            <button
              type="button"
              className="btn primary wide"
              data-deal="1"
              disabled={!allowDeal || busy}
              aria-busy={busy}
              onClick={onDeal}
            >
              {busy ? '发牌中…' : '发牌'}
            </button>
            {!allowDeal && <p className="hint">{gate || '等待配板合法'}</p>}
          </>
        ) : (
          <p className="waiting">等待桌主发牌</p>
        )}
      </footer>

      {confirmRedeal && (
        <div className="werewolf-confirm" data-redeal-confirm="1" role="dialog">
          <div className="werewolf-confirm-card">
            <p>{REDEAL_CONFIRM}</p>
            <button
              type="button"
              className="btn primary wide"
              data-confirm-redeal="1"
              disabled={busy}
              onClick={() => {
                setConfirmRedeal(false)
                onRedeal()
              }}
            >
              确认重发
            </button>
            <button
              type="button"
              className="btn ghost wide"
              data-cancel-redeal="1"
              onClick={() => setConfirmRedeal(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
