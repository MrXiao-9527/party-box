/**
 * Host-authoritative undoLast QA gates (roomLogic) — 「撤销验」.
 * Run: npm run test:undo
 *
 * Covers: transfer / uniformBuyIn / seatAdjust (本席加减) + walk-back.
 */
import { createRoomStore, ACK_REASONS, ledgerEntrySummary } from '../server/roomLogic.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const store = createRoomStore()
const { session: host, data: room0 } = store.createEmptyHostRoom()
const claimed = store.claimHostSeat(room0.room.roomCode, host.seatId, '地主')
assert(claimed, 'claim host')
const code = claimed.room.roomCode

const j1 = store.joinRoom(code, '甲')
const j2 = store.joinRoom(code, '乙')
assert(!('error' in j1) && !('error' in j2), 'join')
store.setPhase(code, 'playing')

const hostId = host.seatId
const aId = j1.session.seatId
const bId = j2.session.seatId

function bal(seatId) {
  return store.get(code).table.seats.find((s) => s.seatId === seatId).balance
}

function op(partial) {
  return store.applyChipOp({
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    ...partial,
  })
}

// 1) Empty undoable ledger (no chip ops yet) → NOTHING_TO_UNDO
{
  const before = store.get(code)
  const r = op({ opId: 'u0', type: 'undoLast' })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.NOTHING_TO_UNDO, 'empty undo')
  const after = store.get(code)
  assert(after.table.ledger.length === before.table.ledger.length, 'empty no ledger')
  assert(bal(hostId) === 0 && bal(aId) === 0 && bal(bId) === 0, 'empty no bal')
}

// 2) 本席加减 (+batch / -denom): ledger row + undo reverses
{
  const rAdd = op({
    opId: 'adj1',
    type: '+batch',
    amount: 100,
    targetSeatId: hostId,
  })
  assert(rAdd.ack.ok, '+batch ok')
  assert(bal(hostId) === 100, 'host 100')
  const row = rAdd.data.table.ledger.at(-1)
  assert(row.kind === 'seatAdjust' && row.amount === 100, 'seatAdjust +100')
  assert(ledgerEntrySummary(row) === '地主 +100', 'summary 地主 +100')

  const rSub = op({
    opId: 'adj2',
    type: '-denom',
    denom: 25,
    targetSeatId: hostId,
  })
  assert(rSub.ack.ok, '-denom ok')
  assert(bal(hostId) === 75, 'host 75')
  const subRow = rSub.data.table.ledger.at(-1)
  assert(subRow.kind === 'seatAdjust' && subRow.amount === -25, 'seatAdjust -25')
  assert(ledgerEntrySummary(subRow) === '地主 -25', 'summary 地主 -25')

  // No-op subtract at floor: balance 0 seat −batch → no new seatAdjust for 甲
  const ledLenBefore = store.get(code).table.ledger.length
  const rFloor = op({
    opId: 'adj3',
    type: '-batch',
    amount: 10,
    targetSeatId: aId,
  })
  assert(rFloor.ack.ok, '-batch on 0 ok')
  assert(bal(aId) === 0, '甲 still 0')
  assert(store.get(code).table.ledger.length === ledLenBefore, 'no ledger when actual delta 0')
  assert(
    !store.get(code).table.ledger.some((e) => e.kind === 'seatAdjust' && e.fromSeatId === aId),
    '甲 no seatAdjust rows',
  )

  const uSub = op({ opId: 'u_adj_sub', type: 'undoLast' })
  assert(uSub.ack.ok, 'undo -25')
  assert(bal(hostId) === 100, 'restored to 100')
  assert(uSub.data.table.ledger.at(-1).fromName === '地主 -25', 'undo summary -25')

  const uAdd = op({ opId: 'u_adj_add', type: 'undoLast' })
  assert(uAdd.ack.ok, 'undo +100')
  assert(bal(hostId) === 0, 'restored to 0')
  assert(uAdd.data.table.ledger.at(-1).fromName === '地主 +100', 'undo summary +100')
}

// 3) Transfer then undo
{
  op({ opId: 'seedH', type: '+batch', amount: 100, targetSeatId: hostId })
  op({ opId: 'seedA', type: '+batch', amount: 40, targetSeatId: aId })
  op({ opId: 'seedB', type: '+batch', amount: 20, targetSeatId: bId })

  const rT = op({
    opId: 't1',
    type: 'transfer',
    amount: 15,
    targetSeatId: aId,
    targetSeatIds: [aId],
  })
  assert(rT.ack.ok, 'transfer ok')
  assert(bal(hostId) === 85 && bal(aId) === 55, 'after transfer')
  const ledgerLen = store.get(code).table.ledger.length

  const rU = op({ opId: 'u1', type: 'undoLast' })
  assert(rU.ack.ok, 'undo transfer ok')
  assert(bal(hostId) === 100 && bal(aId) === 40, 'transfer reversed')
  assert(rU.data.table.ledger.length === ledgerLen + 1, 'append undo row')
  assert(rU.data.table.ledger.at(-1).kind === 'undo', 'undo kind')
  assert(rU.data.table.ledger.at(-1).fromName.includes('地主→甲'), 'undo summary names')
}

// 4) Walk-back: buy-in then transfer; undo twice
{
  const rB = op({ opId: 'b1', type: 'uniformBuyIn', amount: 50 })
  assert(rB.ack.ok, 'buy-in')
  assert(rB.data.table.ledger.at(-1).prevBalances?.length > 0, 'prevBalances stored')

  const rT = op({
    opId: 't2',
    type: 'transfer',
    amount: 10,
    targetSeatId: bId,
    targetSeatIds: [bId],
  })
  assert(rT.ack.ok, 'transfer after buy-in')
  assert(bal(hostId) === 40 && bal(bId) === 60, 'post t2')

  const u1 = op({ opId: 'u2', type: 'undoLast' })
  assert(u1.ack.ok, 'undo transfer 2')
  assert(bal(hostId) === 50 && bal(bId) === 50, 'all 50 after undo transfer')

  const u2 = op({ opId: 'u3', type: 'undoLast' })
  assert(u2.ack.ok, 'undo buy-in')
  assert(bal(hostId) === 100 && bal(aId) === 40 && bal(bId) === 20, 'buy-in reversed')
  assert(u2.data.table.ledger.at(-1).fromName === '全员买入 50', 'undo buy-in summary')
}

// 5) Non-host rejected
{
  const before = store.get(code)
  const r = store.applyChipOp({
    opId: 'u4',
    roomCode: code,
    fromSeatId: aId,
    targetSeatId: aId,
    type: 'undoLast',
  })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.NOT_HOST, 'non-host')
  assert(store.get(code).table.ledger.length === before.table.ledger.length, 'no ledger')
}

// 6) Paused blocks
{
  store.setPhase(code, 'paused')
  const before = store.get(code)
  const r = op({ opId: 'u5', type: 'undoLast' })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.TABLE_PAUSED, 'paused')
  assert(store.get(code).table.ledger.length === before.table.ledger.length, 'paused no ledger')
  store.setPhase(code, 'playing')
}

// 7) Drain undos until NOTHING_TO_UNDO; history never erased
{
  let guard = 40
  let lastFail = null
  while (guard-- > 0) {
    const r = op({ opId: `drain_${guard}`, type: 'undoLast' })
    if (!r.ack.ok) {
      lastFail = r.ack.reason
      break
    }
  }
  assert(lastFail === ACK_REASONS.NOTHING_TO_UNDO, 'drained')
  const led = store.get(code).table.ledger
  assert(led.some((e) => e.kind === 'seatAdjust'), 'seatAdjust history kept')
  assert(led.some((e) => e.kind === 'transfer' || !e.kind), 'transfer history kept')
  assert(led.some((e) => e.kind === 'uniformBuyIn'), 'buy-in history kept')
  assert(led.some((e) => e.kind === 'undo'), 'undo rows present')
}

// 8) Transfer still works after undos
{
  op({ opId: 'seedH2', type: '+batch', amount: 30, targetSeatId: hostId })
  const beforeH = bal(hostId)
  const beforeB = bal(bId)
  const r = op({
    opId: 't3',
    type: 'transfer',
    amount: 5,
    targetSeatId: bId,
    targetSeatIds: [bId],
  })
  assert(r.ack.ok, 'transfer after undo path')
  assert(bal(hostId) === beforeH - 5 && bal(bId) === beforeB + 5, 'transfer deltas')
}

console.log('撤销验 QA gates: OK')
