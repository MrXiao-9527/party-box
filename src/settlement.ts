/**
 * End-of-table settlement: 累计买入 / 结算码量 / 净额 + min transfers.
 * Suggestion only — never mutates balances.
 */

export const SETTLEMENT_COPY = {
  MISMATCH: '买入与结算对不上，多半漏了补码，请先核对',
  POT_REMAINING: '底池还有筹码，请先分完再结算',
} as const

export function normalizeBuyIn(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

export interface SettlementPlayer {
  seatId: string
  name: string
  buyIn: number
  /** 结算码量 = current balance. */
  settle: number
  /** 净额 = 结算 − 买入. */
  net: number
}

export interface SettlementTransfer {
  fromName: string
  toName: string
  amount: number
}

export function formatTransferLine(t: SettlementTransfer): string {
  return `${t.fromName} → ${t.toName} · ${t.amount}`
}

export function formatTransferList(transfers: SettlementTransfer[]): string {
  return transfers.map(formatTransferLine).join('\n')
}

/**
 * Largest debtor ↔ largest creditor pairing (fewest greedy transfers).
 * Integer chips only. Zero-net seats omitted.
 */
export function minTransfers(
  players: { name: string; net: number }[],
): SettlementTransfer[] {
  const debtors = players
    .filter((p) => p.net < 0)
    .map((p) => ({ name: p.name, remain: -p.net }))
    .sort((a, b) => b.remain - a.remain || a.name.localeCompare(b.name, 'zh-CN'))
  const creditors = players
    .filter((p) => p.net > 0)
    .map((p) => ({ name: p.name, remain: p.net }))
    .sort((a, b) => b.remain - a.remain || a.name.localeCompare(b.name, 'zh-CN'))

  const out: SettlementTransfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].remain, creditors[j].remain)
    if (pay > 0) {
      out.push({
        fromName: debtors[i].name,
        toName: creditors[j].name,
        amount: pay,
      })
      debtors[i].remain -= pay
      creditors[j].remain -= pay
    }
    if (debtors[i].remain === 0) i += 1
    if (creditors[j].remain === 0) j += 1
  }
  return out
}

export type SettlementBlock = 'pot' | 'mismatch' | null

export interface SettlementSummary {
  rows: SettlementPlayer[]
  buyInTotal: number
  settleTotal: number
  netTotal: number
  pot: number
  block: SettlementBlock
  transfers: SettlementTransfer[]
}

export function buildSettlement(input: {
  seats: { seatId: string; name: string; balance: number; buyIn?: number }[]
  pot?: number
}): SettlementSummary {
  const potRaw = typeof input.pot === 'number' ? input.pot : Number(input.pot)
  const pot = Number.isFinite(potRaw) ? Math.max(0, Math.floor(potRaw)) : 0
  const rows = input.seats.map((s) => {
    const buyIn = normalizeBuyIn(s.buyIn)
    const bal = typeof s.balance === 'number' ? s.balance : Number(s.balance)
    const settle = Number.isFinite(bal) ? Math.max(0, Math.floor(bal)) : 0
    return {
      seatId: s.seatId,
      name: s.name,
      buyIn,
      settle,
      net: settle - buyIn,
    }
  })
  const buyInTotal = rows.reduce((a, r) => a + r.buyIn, 0)
  const settleTotal = rows.reduce((a, r) => a + r.settle, 0)
  const netTotal = settleTotal - buyInTotal
  let block: SettlementBlock = null
  if (pot > 0) block = 'pot'
  else if (buyInTotal !== settleTotal) block = 'mismatch'
  const transfers = block ? [] : minTransfers(rows)
  return {
    rows,
    buyInTotal,
    settleTotal,
    netTotal,
    pot,
    block,
    transfers,
  }
}

export function settlementToast(block: SettlementBlock): string | null {
  if (block === 'pot') return SETTLEMENT_COPY.POT_REMAINING
  if (block === 'mismatch') return SETTLEMENT_COPY.MISMATCH
  return null
}
