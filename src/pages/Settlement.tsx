import { useEffect, useMemo, useRef } from 'react'
import type { RoomState, TableSnapshot } from '../types'
import {
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

      <p className="settlement-pot">
        底池 · {summary.pot}
      </p>

      <div className="settlement-table" role="table" aria-label="结算摘要">
        <div className="settlement-head" role="row">
          <span>昵称</span>
          <span>累计买入</span>
          <span>结算码量</span>
          <span>净额</span>
        </div>
        {summary.rows.map((row) => (
          <div key={row.seatId} className="settlement-row" role="row">
            <span className="settlement-name">{row.name}</span>
            <span>{row.buyIn}</span>
            <span>{row.settle}</span>
            <span className={row.net < 0 ? 'net-neg' : row.net > 0 ? 'net-pos' : ''}>
              {signed(row.net)}
            </span>
          </div>
        ))}
        <div className="settlement-foot" role="row">
          <span>合计</span>
          <span>{summary.buyInTotal}</span>
          <span>{summary.settleTotal}</span>
          <span className={summary.netTotal !== 0 ? 'net-neg' : ''}>
            {signed(summary.netTotal)}
          </span>
        </div>
      </div>

      {summary.block === null && (
        <section className="settlement-transfers" aria-label="转账建议">
          <p className="settlement-transfers-title">转账建议</p>
          {summary.transfers.length === 0 ? (
            <p className="hint">无需转账</p>
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
        <button type="button" className="btn ghost wide settlement-back" onClick={onClose}>
          返回桌面
        </button>
      ) : (
        <p className="hint settlement-wait">等待桌主确认</p>
      )}
    </div>
  )
}
