import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ACK_REASONS, findLastUndoable, ledgerEntrySummary, potSplitSummary, type LedgerEntry, type RoomState, type Seat, type TableSnapshot } from '../types'
import type { ChipOpType } from '../types'
import { JoinInvite } from '../components/JoinInvite'

interface ChipTableProps {
  room: RoomState
  table: TableSnapshot
  seats: Seat[]
  isHost: boolean
  connectionState: 'online' | 'offline'
  onOp: (
    type: ChipOpType,
    targetSeatId: string,
    extra?: { denom?: number; amount?: number; targetSeatIds?: string[] },
  ) => void
  onExit: () => void
  onToggleOffline: () => void
  onHostLeave: () => void
  pushToast: (text: string) => void
}

function formatLedgerTime(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function ChipTable({
  room,
  table,
  seats,
  isHost,
  connectionState,
  onOp,
  onExit,
  onToggleOffline,
  onHostLeave,
  pushToast,
}: ChipTableProps) {
  const navigate = useNavigate()
  const self = seats.find((s) => s.isSelf) ?? seats[0]
  const others = seats.filter((s) => !s.isSelf)
  const [menuOpen, setMenuOpen] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [confirmReset, setConfirmReset] = useState<'seat' | 'table' | null>(
    null,
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferAmount, setTransferAmount] = useState('')
  const [buyInOpen, setBuyInOpen] = useState(false)
  const [buyInAmount, setBuyInAmount] = useState('')
  const [undoOpen, setUndoOpen] = useState(false)
  const [undoTarget, setUndoTarget] = useState<LedgerEntry | null>(null)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [potInOpen, setPotInOpen] = useState(false)
  const [potInAmount, setPotInAmount] = useState('')
  const [potOutOpen, setPotOutOpen] = useState(false)
  const [potOutAmount, setPotOutAmount] = useState('')
  const [potOutTargetId, setPotOutTargetId] = useState<string>('')
  const [potSplitOpen, setPotSplitOpen] = useState(false)
  const [potSplitAmount, setPotSplitAmount] = useState('')
  const longPressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const selectedSeats = useMemo(
    () =>
      selectedIds
        .map((id) => others.find((s) => s.seatId === id))
        .filter((s): s is Seat => !!s),
    [selectedIds, others],
  )

  const amountNum = Number.parseInt(transferAmount, 10)
  const amountValid = Number.isInteger(amountNum) && amountNum > 0
  const totalOut = amountValid ? amountNum * selectedSeats.length : 0

  const buyInNum = Number.parseInt(buyInAmount, 10)
  const buyInValid = Number.isInteger(buyInNum) && buyInNum > 0

  const potBalance = Math.max(
    0,
    Math.floor(Number.isFinite(table.pot) ? table.pot : 0),
  )
  const showPotActions = room.phase !== 'paused'

  const potInNum = Number.parseInt(potInAmount, 10)
  const potInValid = Number.isInteger(potInNum) && potInNum > 0

  const potOutNum = Number.parseInt(potOutAmount, 10)
  const potOutValid = Number.isInteger(potOutNum) && potOutNum > 0
  const potOutTarget = seats.find((s) => s.seatId === potOutTargetId) ?? null

  const potSplitEligible = useMemo(
    () => seats.filter((s) => !s.locked),
    [seats],
  )
  const potSplitNum = Number.parseInt(potSplitAmount, 10)
  const potSplitValid = Number.isInteger(potSplitNum) && potSplitNum > 0
  const potSplitK = potSplitEligible.length
  const potSplitM =
    potSplitValid && potSplitK > 0 ? Math.floor(potSplitNum / potSplitK) : 0
  const potSplitR =
    potSplitValid && potSplitK > 0 ? potSplitNum - potSplitM * potSplitK : 0

  const lastUndoable = useMemo(
    () => findLastUndoable(table.ledger ?? []),
    [table.ledger],
  )

  if (!self) {
    return (
      <div className="page table">
        <p className="error">座位数据缺失</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          回首页
        </button>
      </div>
    )
  }

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const onDenomPointerDown = (denom: number) => {
    longPressed.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      if (batchMode) {
        onOp('-batch', self.seatId, { amount: denom * 5 })
      } else {
        onOp('-denom', self.seatId, { denom })
      }
    }, 450)
  }

  const onDenomPointerUp = (denom: number) => {
    clearLongPress()
    if (longPressed.current) return
    if (batchMode) {
      onOp('+batch', self.seatId, { amount: denom * 5 })
    } else {
      onOp('+denom', self.seatId, { denom })
    }
  }

  const toggleLock = () => {
    onOp(self.locked ? 'unlock' : 'lock', self.seatId)
    setMenuOpen(false)
  }

  const resetSeat = () => {
    if (!isHost) {
      pushToast('仅桌主可执行此操作')
      return
    }
    onOp('resetSeat', self.seatId)
    setConfirmReset(null)
    setMenuOpen(false)
  }

  const resetTable = () => {
    if (!isHost) {
      pushToast('仅桌主可执行此操作')
      return
    }
    onOp('resetTable', self.seatId)
    setConfirmReset(null)
    setMenuOpen(false)
  }

  const toggleSelectSeat = (seat: Seat) => {
    if (seat.seatId === self.seatId) {
      pushToast(ACK_REASONS.SELF_TRANSFER)
      return
    }
    if (seat.locked) {
      pushToast(ACK_REASONS.SEAT_LOCKED)
      return
    }
    setSelectedIds((prev) =>
      prev.includes(seat.seatId)
        ? prev.filter((id) => id !== seat.seatId)
        : [...prev, seat.seatId],
    )
  }

  const openTransfer = () => {
    if (self.locked) {
      pushToast(ACK_REASONS.SEAT_LOCKED)
      return
    }
    if (selectedSeats.length === 0) return
    if (selectedSeats.some((s) => s.locked)) {
      pushToast(ACK_REASONS.SEAT_LOCKED)
      return
    }
    setTransferAmount('')
    setTransferOpen(true)
  }

  const confirmTransfer = () => {
    if (self.locked) {
      pushToast(ACK_REASONS.SEAT_LOCKED)
      return
    }
    if (selectedSeats.some((s) => s.locked)) {
      pushToast(ACK_REASONS.SEAT_LOCKED)
      return
    }
    if (selectedSeats.some((s) => s.seatId === self.seatId)) {
      pushToast(ACK_REASONS.SELF_TRANSFER)
      return
    }
    if (!amountValid) return
    if (self.balance < totalOut) {
      pushToast(ACK_REASONS.INSUFFICIENT)
      return
    }

    const targetSeatIds = selectedSeats.map((s) => s.seatId)
    onOp('transfer', targetSeatIds[0], {
      amount: amountNum,
      targetSeatIds,
    })
    setTransferOpen(false)
    setTransferAmount('')
    setSelectedIds([])
  }

  const openBuyIn = () => {
    if (!isHost) {
      pushToast(ACK_REASONS.NOT_HOST)
      return
    }
    setBuyInAmount(room.buyInN > 0 ? String(room.buyInN) : '')
    setBuyInOpen(true)
    setMenuOpen(false)
  }

  const confirmBuyIn = () => {
    if (!isHost) {
      pushToast(ACK_REASONS.NOT_HOST)
      return
    }
    if (!buyInValid) {
      pushToast(ACK_REASONS.POSITIVE_INT)
      return
    }
    onOp('uniformBuyIn', self.seatId, { amount: buyInNum })
    setBuyInOpen(false)
    setBuyInAmount('')
  }

  const openUndo = () => {
    if (!isHost) {
      pushToast(ACK_REASONS.NOT_HOST)
      return
    }
    if (!lastUndoable) {
      pushToast(ACK_REASONS.NOTHING_TO_UNDO)
      setMenuOpen(false)
      return
    }
    setUndoTarget(lastUndoable)
    setUndoOpen(true)
    setMenuOpen(false)
  }

  const confirmUndo = () => {
    if (!isHost) {
      pushToast(ACK_REASONS.NOT_HOST)
      return
    }
    if (!undoTarget) {
      pushToast(ACK_REASONS.NOTHING_TO_UNDO)
      setUndoOpen(false)
      return
    }
    onOp('undoLast', self.seatId)
    setUndoOpen(false)
    setUndoTarget(null)
  }

  const openPotIn = () => {
    if (self.locked) {
      pushToast(ACK_REASONS.SEAT_LOCKED)
      return
    }
    setPotInAmount('')
    setPotInOpen(true)
  }

  const confirmPotIn = () => {
    if (self.locked) {
      pushToast(ACK_REASONS.SEAT_LOCKED)
      return
    }
    if (!potInValid) {
      pushToast(ACK_REASONS.POSITIVE_INT)
      return
    }
    if (self.balance < potInNum) {
      pushToast(ACK_REASONS.INSUFFICIENT)
      return
    }
    onOp('potIn', self.seatId, { amount: potInNum })
    setPotInOpen(false)
    setPotInAmount('')
  }

  const openPotOut = () => {
    if (!isHost) {
      pushToast(ACK_REASONS.NOT_HOST)
      return
    }
    setPotOutAmount('')
    setPotOutTargetId(
      seats.find((s) => s.seatId !== self.seatId)?.seatId ?? self.seatId,
    )
    setPotOutOpen(true)
  }

  const confirmPotOut = () => {
    if (!isHost) {
      pushToast(ACK_REASONS.NOT_HOST)
      return
    }
    if (!potOutValid) {
      pushToast(ACK_REASONS.POSITIVE_INT)
      return
    }
    if (potBalance < potOutNum) {
      pushToast(ACK_REASONS.POT_INSUFFICIENT)
      return
    }
    if (!potOutTarget) {
      pushToast(ACK_REASONS.INVALID)
      return
    }
    onOp('potOut', potOutTarget.seatId, { amount: potOutNum })
    setPotOutOpen(false)
    setPotOutAmount('')
  }

  const openPotSplit = () => {
    if (!isHost) {
      pushToast(ACK_REASONS.NOT_HOST)
      return
    }
    setPotSplitAmount('')
    setPotSplitOpen(true)
  }

  const confirmPotSplit = () => {
    if (!isHost) {
      pushToast(ACK_REASONS.NOT_HOST)
      return
    }
    if (!potSplitValid) {
      pushToast(ACK_REASONS.POSITIVE_INT)
      return
    }
    if (potBalance < potSplitNum) {
      pushToast(ACK_REASONS.POT_INSUFFICIENT)
      return
    }
    if (potSplitK === 0 || potSplitM < 1) {
      pushToast(ACK_REASONS.INVALID)
      return
    }
    onOp('potSplit', self.seatId, { amount: potSplitNum })
    setPotSplitOpen(false)
    setPotSplitAmount('')
  }

  const ledger = [...(table.ledger ?? [])].reverse()

  return (
    <div className="page table">
      <header className="table-top">
        <div className="top-meta">
          <span className="code">{room.roomCode.toUpperCase()}</span>
          <span className="dot">·</span>
          <span>{seats.length} 人</span>
          <span className="dot">·</span>
          <span>{isHost ? '桌主' : '玩家'}</span>
          <span className="dot">·</span>
          <span className="pot-top">底池 · {potBalance}</span>
        </div>
        <div className="table-top-actions">
          <button
            type="button"
            className="icon-btn wide-label"
            aria-label="邀请"
            onClick={() => setInviteOpen(true)}
          >
            邀请
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="菜单"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
      </header>

      {connectionState === 'offline' && (
        <div className="offline-strip" role="status">
          已离线·以桌主为准
        </div>
      )}

      <div className="seats-rail" aria-label="座位">
        {others.map((s) => {
          const selected = selectedIds.includes(s.seatId)
          return (
            <button
              key={s.seatId}
              type="button"
              className={`seat seat-other${s.locked ? ' locked' : ''}${selected ? ' selected' : ''}`}
              onClick={() => toggleSelectSeat(s)}
            >
              <p className="seat-name">
                {s.name}
                {s.isHost && <span className="host-badge">桌主</span>}
              </p>
              <p className="seat-balance">{s.balance}</p>
            </button>
          )
        })}
      </div>

      {selectedIds.length > 0 && (
        <div className="transfer-bar" role="toolbar" aria-label="转筹码">
          <span className="transfer-bar-meta">已选 {selectedIds.length} 席</span>
          <button type="button" className="btn ghost compact" onClick={() => setSelectedIds([])}>
            取消
          </button>
          <button type="button" className="btn primary compact" onClick={openTransfer}>
            转筹码
          </button>
        </div>
      )}

      {showPotActions && (
        <div className="pot-bar" role="toolbar" aria-label="公共底池操作">
          <button type="button" className="btn ghost compact" onClick={openPotIn}>
            放进底池
          </button>
          {isHost && (
            <button type="button" className="btn ghost compact" onClick={openPotOut}>
              从底池发给
            </button>
          )}
          {isHost && (
            <button type="button" className="btn primary compact" onClick={openPotSplit}>
              底池均分
            </button>
          )}
        </div>
      )}

      <article className={`seat seat-self${self.locked ? ' locked' : ''}`}>
        <p className="seat-label">我的座位</p>
        <p className="seat-name">
          {self.name}
          {self.isHost && <span className="host-badge">桌主</span>}
          {self.locked && <span className="lock-badge">已锁定</span>}
        </p>
        <p className="seat-balance hero-balance">{self.balance}</p>
        <p className="seat-hint">
          {selectedIds.length > 0
            ? '已选对方座位 · 点「转筹码」'
            : batchMode
              ? '批量：点按 +5×面额，长按 −'
              : '点按加筹码，长按减 · 点对方座位可转筹码'}
        </p>
      </article>

      <section className="ledger-panel" aria-label="流水">
        <button
          type="button"
          className="ledger-toggle"
          onClick={() => setLedgerOpen((v) => !v)}
        >
          流水 {ledger.length > 0 ? `(${ledger.length})` : ''}
          <span aria-hidden="true">{ledgerOpen ? '▾' : '▸'}</span>
        </button>
        {ledgerOpen && (
          <ul className="ledger-list">
            {ledger.length === 0 ? (
              <li className="ledger-empty">暂无成功转账</li>
            ) : (
              ledger.map((row) => (
                <li key={row.id} className="ledger-row">
                  {row.kind === 'undo' ? (
                    <>
                      <span className="ledger-who">撤销 · {row.fromName}</span>
                      <span className="ledger-amt ledger-amt-set">↩</span>
                    </>
                  ) : row.kind === 'uniformBuyIn' ? (
                    <>
                      <span className="ledger-who">全员买入 {row.amount}</span>
                      <span className="ledger-amt ledger-amt-set">={row.amount}</span>
                    </>
                  ) : row.kind === 'seatAdjust' ? (
                    <>
                      <span className="ledger-who">
                        {ledgerEntrySummary(row)}
                      </span>
                      <span
                        className={`ledger-amt${row.amount < 0 ? ' ledger-amt-set' : ''}`}
                      >
                        {row.amount > 0 ? '+' : ''}
                        {row.amount}
                      </span>
                    </>
                  ) : row.kind === 'potIn' ||
                    row.kind === 'potOut' ||
                    row.kind === 'potSplit' ? (
                    <>
                      <span className="ledger-who">
                        {ledgerEntrySummary(row)}
                      </span>
                      <span className="ledger-amt">+{row.amount}</span>
                    </>
                  ) : (
                    <>
                      <span className="ledger-who">
                        {row.fromName}→{row.toName}
                      </span>
                      <span className="ledger-amt">+{row.amount}</span>
                    </>
                  )}
                  <span className="ledger-time">{formatLedgerTime(row.at)}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </section>

      <div className="denom-bar" role="toolbar" aria-label="筹码面额">
        <button
          type="button"
          className={`batch-toggle${batchMode ? ' on' : ''}`}
          onClick={() => setBatchMode((v) => !v)}
        >
          {batchMode ? '批量开' : '批量'}
        </button>
        {table.denoms.map((d) => (
          <button
            key={d}
            type="button"
            className={`denom denom-${d}`}
            onPointerDown={() => onDenomPointerDown(d)}
            onPointerUp={() => onDenomPointerUp(d)}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            onContextMenu={(e) => e.preventDefault()}
          >
            {d}
          </button>
        ))}
      </div>

      {menuOpen && (
        <div className="menu-sheet" role="dialog" aria-label="桌面菜单">
          <button type="button" onClick={toggleLock}>
            {self.locked ? '解锁座位' : '锁定座位'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmReset('seat')}
            disabled={!isHost}
          >
            重置我的筹码
          </button>
          <button
            type="button"
            onClick={() => setConfirmReset('table')}
            disabled={!isHost}
          >
            重置整桌
          </button>
          {isHost && (
            <button type="button" onClick={openBuyIn}>
              全员买入
            </button>
          )}
          {isHost && (
            <button type="button" onClick={openUndo}>
              撤销上一笔
            </button>
          )}
          {isHost && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onOp('openSettlement', self.seatId)
              }}
            >
              结束桌
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onToggleOffline()
              setMenuOpen(false)
            }}
          >
            {connectionState === 'offline' ? '恢复连接' : '模拟离线'}
          </button>
          {isHost && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onHostLeave()
              }}
            >
              模拟桌主离开
            </button>
          )}
          <button
            type="button"
            className="danger"
            onClick={() => {
              setMenuOpen(false)
              onExit()
            }}
          >
            退出房间
          </button>
          <button type="button" className="muted" onClick={() => setMenuOpen(false)}>
            取消
          </button>
        </div>
      )}

      {inviteOpen && (
        <div className="confirm-overlay" role="dialog" aria-label="邀请入桌">
          <div className="confirm-box transfer-box invite-box">
            <p className="transfer-title">邀请入桌</p>
            <JoinInvite room={room} compact showSettings />
            <div className="cta-row">
              <button
                type="button"
                className="btn ghost wide"
                onClick={() => setInviteOpen(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {transferOpen && (
        <div className="confirm-overlay" role="dialog" aria-label="转筹码">
          <div className="confirm-box transfer-box">
            <p className="transfer-title">转筹码</p>
            <p className="transfer-targets">
              转给：{selectedSeats.map((s) => s.name).join('、')}
            </p>
            <label className="transfer-amount-label">
              金额（任意正整数）
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="transfer-amount-input"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                autoFocus
              />
            </label>
            {amountValid && selectedSeats.length > 0 && (
              <div className="transfer-preview" aria-live="polite">
                {selectedSeats.length === 1 ? (
                  <p>
                    我 -{amountNum} / 对方 +{amountNum}
                  </p>
                ) : (
                  <>
                    <p>
                      我 -{totalOut} / 对方各 +{amountNum}
                    </p>
                    <ul>
                      {selectedSeats.map((s) => (
                        <li key={s.seatId}>
                          {s.name} +{amountNum}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            <div className="cta-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setTransferOpen(false)
                  setTransferAmount('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!amountValid || selectedSeats.length === 0}
                onClick={confirmTransfer}
              >
                确认转出
              </button>
            </div>
          </div>
        </div>
      )}

      {buyInOpen && isHost && (
        <div className="confirm-overlay" role="dialog" aria-label="全员买入">
          <div className="confirm-box transfer-box">
            <p className="transfer-title">全员买入</p>
            <label className="transfer-amount-label">
              金额（任意正整数）
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="transfer-amount-input buyin-amount-input"
                value={buyInAmount}
                onChange={(e) => setBuyInAmount(e.target.value)}
                autoFocus
              />
            </label>
            {buyInValid && (
              <div className="transfer-preview" aria-live="polite">
                <p>全员余额将设为 {buyInNum}</p>
              </div>
            )}
            <div className="cta-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setBuyInOpen(false)
                  setBuyInAmount('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={confirmBuyIn}
              >
                确认买入
              </button>
            </div>
          </div>
        </div>
      )}

      {undoOpen && isHost && undoTarget && (
        <div className="confirm-overlay" role="dialog" aria-label="撤销上一笔">
          <div className="confirm-box transfer-box">
            <p className="transfer-title">撤销上一笔</p>
            <div className="transfer-preview" aria-live="polite">
              <p>将撤销：{ledgerEntrySummary(undoTarget)}</p>
            </div>
            <div className="cta-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setUndoOpen(false)
                  setUndoTarget(null)
                }}
              >
                取消
              </button>
              <button type="button" className="btn primary" onClick={confirmUndo}>
                确认撤销
              </button>
            </div>
          </div>
        </div>
      )}

      {potInOpen && (
        <div className="confirm-overlay" role="dialog" aria-label="放进底池">
          <div className="confirm-box transfer-box">
            <p className="transfer-title">放进底池</p>
            <label className="transfer-amount-label">
              金额（任意正整数）
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="transfer-amount-input"
                value={potInAmount}
                onChange={(e) => setPotInAmount(e.target.value)}
                autoFocus
              />
            </label>
            {potInValid && (
              <div className="transfer-preview" aria-live="polite">
                <p>
                  {self.name} → 底池 +{potInNum}
                </p>
              </div>
            )}
            <div className="cta-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setPotInOpen(false)
                  setPotInAmount('')
                }}
              >
                取消
              </button>
              <button type="button" className="btn primary" onClick={confirmPotIn}>
                确认放进底池
              </button>
            </div>
          </div>
        </div>
      )}

      {potOutOpen && isHost && (
        <div className="confirm-overlay" role="dialog" aria-label="从底池发给">
          <div className="confirm-box transfer-box">
            <p className="transfer-title">从底池发给</p>
            <label className="transfer-amount-label">
              付给
              <select
                className="transfer-amount-input pot-target-select"
                value={potOutTargetId}
                onChange={(e) => setPotOutTargetId(e.target.value)}
              >
                {seats.map((s) => (
                  <option key={s.seatId} value={s.seatId}>
                    {s.name}
                    {s.locked ? '（已锁定）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="transfer-amount-label">
              金额（任意正整数）
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="transfer-amount-input"
                value={potOutAmount}
                onChange={(e) => setPotOutAmount(e.target.value)}
                autoFocus
              />
            </label>
            {potOutValid && potOutTarget && (
              <div className="transfer-preview" aria-live="polite">
                <p>
                  底池 → {potOutTarget.name} +{potOutNum}
                </p>
              </div>
            )}
            <div className="cta-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setPotOutOpen(false)
                  setPotOutAmount('')
                }}
              >
                取消
              </button>
              <button type="button" className="btn primary" onClick={confirmPotOut}>
                确认从底池发给
              </button>
            </div>
          </div>
        </div>
      )}

      {potSplitOpen && isHost && (
        <div className="confirm-overlay" role="dialog" aria-label="底池均分">
          <div className="confirm-box transfer-box">
            <p className="transfer-title">底池均分</p>
            <label className="transfer-amount-label">
              金额（任意正整数）
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="transfer-amount-input"
                value={potSplitAmount}
                onChange={(e) => setPotSplitAmount(e.target.value)}
                autoFocus
              />
            </label>
            {potSplitValid && potSplitK > 0 && (
              <div className="transfer-preview" aria-live="polite">
                <p>{potSplitSummary(potSplitK, potSplitM, potSplitR)}</p>
              </div>
            )}
            <div className="cta-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setPotSplitOpen(false)
                  setPotSplitAmount('')
                }}
              >
                取消
              </button>
              <button type="button" className="btn primary" onClick={confirmPotSplit}>
                确认底池均分
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmReset === 'seat' && (
        <div className="confirm-overlay" role="alertdialog">
          <div className="confirm-box">
            <p>确定重置我的筹码？此操作不可撤销。</p>
            <div className="cta-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setConfirmReset(null)}
              >
                取消
              </button>
              <button type="button" className="btn primary" onClick={resetSeat}>
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmReset === 'table' && (
        <div className="confirm-overlay" role="alertdialog">
          <div className="confirm-box">
            <p>确认重置整桌筹码？此操作不可撤销。</p>
            <div className="cta-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setConfirmReset(null)}
              >
                取消
              </button>
              <button type="button" className="btn primary" onClick={resetTable}>
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
