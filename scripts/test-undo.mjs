/**
 * Host-authoritative undoLast QA gates (roomLogic) — 「撤销验」.
 * Run: npm run test:undo
 */
import { createRoomStore, ACK_REASONS } from '../server/roomLogic.mjs'

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

function seed(seatId, amount, opId) {
  const r = store.applyChipOp({
    opId,
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: seatId,
    type: '+batch',
    amount,
  })
  assert(r.ack.ok, `seed ${opId}`)
}

seed(hostId, 100, 'seedH')
seed(aId, 40, 'seedA')
seed(bId, 20, 'seedB')

// 1) Empty undoable ledger → toast reason, no balance/ledger change
{
  const before = store.get(code)
  const r = store.applyChipOp({
    opId: 'u0',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    type: 'undoLast',
  })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.NOTHING_TO_UNDO, 'empty undo')
  const after = store.get(code)
  assert(after.table.ledger.length === before.table.ledger.length, 'empty no ledger')
  assert(bal(hostId) === 100 && bal(aId) === 40 && bal(bId) === 20, 'empty no bal')
}

// 2) Transfer then undo: balances reverse; append 「撤销」 row; history kept
{
  const rT = store.applyChipOp({
    opId: 't1',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: aId,
    type: 'transfer',
    amount: 15,
    targetSeatIds: [aId],
  })
  assert(rT.ack.ok, 'transfer ok')
  assert(bal(hostId) === 85 && bal(aId) === 55, 'after transfer')
  const ledgerLen = store.get(code).table.ledger.length

  const rU = store.applyChipOp({
    opId: 'u1',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    type: 'undoLast',
  })
  assert(rU.ack.ok, 'undo transfer ok')
  assert(bal(hostId) === 100 && bal(aId) === 40, 'transfer reversed')
  const led = rU.data.table.ledger
  assert(led.length === ledgerLen + 1, 'append undo row')
  const last = led[led.length - 1]
  assert(last.kind === 'undo', 'undo kind')
  assert(last.fromName.includes('地主→甲'), 'undo summary names')
  assert(led.some((e) => e.kind === 'transfer' || !e.kind), 'history kept')
}

// 3) Walk-back: buy-in then transfer; undo twice walks stack (skips undo rows)
{
  const rB = store.applyChipOp({
    opId: 'b1',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    type: 'uniformBuyIn',
    amount: 50,
  })
  assert(rB.ack.ok, 'buy-in')
  assert(rB.data.table.ledger.at(-1).prevBalances?.length > 0, 'prevBalances stored')

  const rT = store.applyChipOp({
    opId: 't2',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: bId,
    type: 'transfer',
    amount: 10,
    targetSeatIds: [bId],
  })
  assert(rT.ack.ok, 'transfer after buy-in')
  assert(bal(hostId) === 40 && bal(bId) === 60, 'post t2')

  const u1 = store.applyChipOp({
    opId: 'u2',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    type: 'undoLast',
  })
  assert(u1.ack.ok, 'undo transfer 2')
  assert(bal(hostId) === 50 && bal(bId) === 50, 'all 50 after undo transfer')
  assert(u1.data.table.ledger.at(-1).kind === 'undo', 'undo row 1')

  const u2 = store.applyChipOp({
    opId: 'u3',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    type: 'undoLast',
  })
  assert(u2.ack.ok, 'undo buy-in')
  // Restored to balances before buy-in (after first transfer undo left 100/40/20… wait:
  // Before buy-in we had undone transfer → 100/40/20. Buy-in set all to 50.
  assert(bal(hostId) === 100 && bal(aId) === 40 && bal(bId) === 20, 'buy-in reversed')
  assert(u2.data.table.ledger.at(-1).fromName === '全员买入 50', 'undo buy-in summary')
}

// 4) Non-host rejected
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

// 5) Paused blocks
{
  store.setPhase(code, 'paused')
  const before = store.get(code)
  const r = store.applyChipOp({
    opId: 'u5',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    type: 'undoLast',
  })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.TABLE_PAUSED, 'paused')
  assert(store.get(code).table.ledger.length === before.table.ledger.length, 'paused no ledger')
  store.setPhase(code, 'playing')
}

// 6) Drain undos until NOTHING_TO_UNDO; history never erased
{
  let guard = 20
  let lastFail = null
  while (guard-- > 0) {
    const r = store.applyChipOp({
      opId: `drain_${guard}`,
      roomCode: code,
      fromSeatId: hostId,
      targetSeatId: hostId,
      type: 'undoLast',
    })
    if (!r.ack.ok) {
      lastFail = r.ack.reason
      break
    }
  }
  assert(lastFail === ACK_REASONS.NOTHING_TO_UNDO, 'drained')
  const led = store.get(code).table.ledger
  assert(led.some((e) => e.kind === 'transfer' || !e.kind), 'transfer history kept')
  assert(led.some((e) => e.kind === 'uniformBuyIn'), 'buy-in history kept')
  assert(led.some((e) => e.kind === 'undo'), 'undo rows present')
}

// 7) Transfer still works after undos
{
  seed(hostId, 30, 'seedH2') // may stack on current
  const beforeH = bal(hostId)
  const beforeB = bal(bId)
  const r = store.applyChipOp({
    opId: 't3',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: bId,
    type: 'transfer',
    amount: 5,
    targetSeatIds: [bId],
  })
  assert(r.ack.ok, 'transfer after undo path')
  assert(bal(hostId) === beforeH - 5 && bal(bId) === beforeB + 5, 'transfer deltas')
}

console.log('撤销验 QA gates: OK')
