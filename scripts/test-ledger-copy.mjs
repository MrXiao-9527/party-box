/**
 * Locked 桌内流水 copy — 「流水文案验」.
 * Run: npm run test:ledger-copy
 */
import { ledgerEntrySummary } from '../server/roomLogic.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

assert(
  ledgerEntrySummary({
    kind: 'transfer',
    fromName: '甲',
    toName: '乙',
    amount: 7,
  }) === '甲 → 乙 · 转 7',
  'transfer',
)

assert(
  ledgerEntrySummary({ kind: 'uniformBuyIn', amount: 50 }) === '全员买入 50',
  'buy-in',
)

assert(ledgerEntrySummary({ kind: 'potIn', amount: 10 }) === '进底池 10', 'potIn')
assert(ledgerEntrySummary({ kind: 'potOut', amount: 4 }) === '出底池 4', 'potOut')
assert(ledgerEntrySummary({ kind: 'potSplit', amount: 5 }) === '均分底池', 'potSplit')

assert(
  ledgerEntrySummary({
    kind: 'seatAdjust',
    fromName: '甲',
    amount: 10,
  }) === '甲 席位+10',
  'seat +',
)
assert(
  ledgerEntrySummary({
    kind: 'seatAdjust',
    fromName: '甲',
    amount: -5,
  }) === '甲 席位-5',
  'seat -',
)

assert(
  ledgerEntrySummary({
    kind: 'undo',
    fromName: '甲 → 乙 · 转 7',
  }) === '撤销：甲 → 乙 · 转 7',
  'undo transfer',
)
assert(
  ledgerEntrySummary({ kind: 'undo', fromName: '全员买入 50' }) ===
    '撤销：全员买入 50',
  'undo buy-in',
)
assert(
  ledgerEntrySummary({ kind: 'undo', fromName: '均分底池' }) === '撤销：均分底池',
  'undo split',
)

console.log('流水文案验: OK')
