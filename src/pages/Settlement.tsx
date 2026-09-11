import { useEffect, useMemo, useRef } from 'react'
import type { RoomState, TableSnapshot } from '../types'
import {
  SETTLEMENT_COPY,
  buildSettlement,
  formatTransferLine,
  formatTransferList,
  settlementToast,
} from '../settlement'

interface SettlementProps {
  room: RoomState
  table: TableSnapshot
  isHost: boolean
  onClose: () => void
  pushToast: (text: string) => void
}

function signed(n: number): string {
  if (n > 0) return `+${n}`
  return `${n}`
}

export function Settlement({
  room,
  table,
  isHost,
  onClose,
  pushToast,
}: SettlementProps) {
  const summary = useMemo(
    () => buildSettlement({ seats: table.seats, pot: table.pot }),
    [table.seats, table.pot],
  )
  const toasted = useRef<string | null>(null)

  useEffect(() => {
    const text = settlementToast(summary.block)
    if (!text) {
      toasted.current = null
      return
    }
    if (toasted.current === text) return
    toasted.current = text
    pushToast(text)
  }, [summary.block, pushToast])

  const copyList = async () => {
    const text = formatTransferList(summary.transfers)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      pushToast('已复制')
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        pushToast('已复制')
      } catch {
        pushToast('复制失败')
      }
      document.body.removeChild(ta)
    }
  }

  return (
    <div className="page settlement">
      <header className="table-top">
        <div className="top-meta">
          <span className="code">{room.roomCode.toUpperCase()}</span>
          <span className="dot">·</span>
          <span>{table.seats.length} 人</span>
          <span className="dot">·</span>
          <span>结算</span>
        </div>
      </header>

      <p className="settlement-pot">底池 · {summary.pot}</p>

      <div className="settlement-list" aria-label="结算摘要">
        {summary.rows.map((row) => (
          <article key={row.seatId} className="settlement-card">
            <p className="settlement-name">{row.name}</p>
            <dl className="settlement-dl">
              <div>
                <dt>累计买入</dt>
                <dd>{row.buyIn}</dd>
              </div>
              <div>
                <dt>结算码量</dt>
                <dd>{row.settle}</dd>
              </div>
              <div>
                <dt>净额</dt>
                <dd
                  className={
                    row.net < 0 ? 'net-neg' : row.net > 0 ? 'net-pos' : ''
                  }
                >
                  {signed(row.net)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
        <article className="settlement-card settlement-foot">
          <p className="settlement-name">合计</p>
          <dl className="settlement-dl">
            <div>
              <dt>买入合计</dt>
              <dd>{summary.buyInTotal}</dd>
            </div>
            <div>
              <dt>结算合计</dt>
              <dd>{summary.settleTotal}</dd>
            </div>
            <div>
              <dt>净额合计</dt>
              <dd className={summary.netTotal !== 0 ? 'net-neg' : ''}>
                {signed(summary.netTotal)}
              </dd>
            </div>
          </dl>
        </article>
      </div>

      {summary.block !== null ? (
        <p className="settlement-banner" role="alert">
          {settlementToast(summary.block)}
        </p>
      ) : (
        <section className="settlement-transfers" aria-label="转账建议">
          <p className="settlement-transfers-title">转账建议</p>
          {summary.transfers.length === 0 ? (
            <p className="hint">{SETTLEMENT_COPY.FLAT}</p>
          ) : (
            <ul className="settlement-transfer-list">
              {summary.transfers.map((t, i) => (
                <li key={`${t.fromName}-${t.toName}-${i}`}>
                  {formatTransferLine(t)}
                </li>
              ))}
            </ul>
          )}
          {summary.transfers.length > 0 && (
            <button
              type="button"
              className="btn primary wide"
              onClick={() => void copyList()}
            >
              复制转账列表
            </button>
          )}
        </section>
      )}

      {isHost ? (
        <button
          type="button"
          className="btn ghost wide settlement-back"
          onClick={onClose}
        >
          返回桌面
        </button>
      ) : (
        <p className="hint settlement-wait">等待桌主确认</p>
      )}
    </div>
  )
}
