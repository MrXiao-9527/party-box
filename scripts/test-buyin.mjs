/**
 * Host-authoritative uniformBuyIn QA gates (roomLogic) — 「买入验」.
 * Run: npm run test:buyin
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

// Seed uneven balances + lock 甲
store.applyChipOp({
  opId: 'seed1',
  roomCode: code,
  fromSeatId: hostId,
  targetSeatId: hostId,
  type: '+batch',
  amount: 10,
})
store.applyChipOp({
  opId: 'seed2',
  roomCode: code,
  fromSeatId: hostId,
  targetSeatId: aId,
  type: '+batch',
  amount: 3,
})
store.applyChipOp({
  opId: 'lockA',
  roomCode: code,
  fromSeatId: hostId,
  targetSeatId: aId,
  type: 'lock',
})

// 1) Happy path: all seats → N (locked included), one summary ledger row
{
  const r = store.applyChipOp({
    opId: 'b1',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    type: 'uniformBuyIn',
    amount: 100,
  })
  assert(r.ack.ok, 'uniformBuyIn 100 ok')
  for (const s of r.data.table.seats) {
    assert(s.balance === 100, `seat ${s.seatId} balance 100`)
  }
  const aSeat = r.data.table.seats.find((s) => s.seatId === aId)
  assert(aSeat.locked === true, 'locked seat stays locked')
  const buyInRows = r.data.table.ledger.filter((e) => e.kind === 'uniformBuyIn')
  assert(buyInRows.length === 1, 'one summary ledger row')
  const row = buyInRows[0]
  assert(row.kind === 'uniformBuyIn', 'ledger kind')
  assert(row.amount === 100, 'ledger amount N')
  assert(ledgerEntrySummary(row) === '全员买入 100', 'copy 全员买入 100')
}

// 2) N≤0 → 请输入正整数, no-op (balances + ledger unchanged)
{
  const before = store.get(code)
  const ledgerLen = before.table.ledger.length
  for (const bad of [0, -1, 1.5, NaN]) {
    const r = store.applyChipOp({
      opId: `bad_${bad}`,
      roomCode: code,
      fromSeatId: hostId,
      targetSeatId: hostId,
      type: 'uniformBuyIn',
      amount: bad,
    })
    assert(!r.ack.ok && r.ack.reason === ACK_REASONS.POSITIVE_INT, `reject ${bad}`)
  }
  const after = store.get(code)
  assert(after.table.ledger.length === ledgerLen, 'no ledger on bad N')
  for (const s of after.table.seats) {
    assert(s.balance === 100, 'balances unchanged on bad N')
  }
}

// 3) Non-host rejected
{
  const before = store.get(code)
  const r = store.applyChipOp({
    opId: 'b3',
    roomCode: code,
    fromSeatId: aId,
    targetSeatId: aId,
    type: 'uniformBuyIn',
    amount: 50,
  })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.NOT_HOST, 'non-host blocked')
  const after = store.get(code)
  assert(
    after.table.seats.every((s) => s.balance === 100),
    'no partial on non-host',
  )
  assert(after.table.ledger.length === before.table.ledger.length, 'no ledger')
}

// 4) Paused table blocks (same as other ChipOps)
{
  store.setPhase(code, 'paused')
  const before = store.get(code)
  const r = store.applyChipOp({
    opId: 'b4',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    type: 'uniformBuyIn',
    amount: 7,
  })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.TABLE_PAUSED, 'paused blocks')
  const after = store.get(code)
  assert(
    after.table.seats.every((s) => s.balance === 100),
    'paused no mutate',
  )
  assert(after.table.ledger.length === before.table.ledger.length, 'paused no ledger')
  store.setPhase(code, 'playing')
}

// 5) Second buy-in still one NEW summary row (not per-seat)
{
  const beforeLen = store.get(code).table.ledger.length
  const r = store.applyChipOp({
    opId: 'b5',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    type: 'uniformBuyIn',
    amount: 25,
  })
  assert(r.ack.ok, 'second buy-in ok')
  assert(r.data.table.ledger.length === beforeLen + 1, 'exactly +1 summary row')
  assert(
    r.data.table.seats.every((s) => s.balance === 25),
    'all = 25',
  )
  const last = r.data.table.ledger[r.data.table.ledger.length - 1]
  assert(last.kind === 'uniformBuyIn' && last.amount === 25, 'summary 全员买入 25')
  // Ensure we did not emit per-seat rows for this op
  const buyInRows = r.data.table.ledger.filter((e) => e.kind === 'uniformBuyIn')
  assert(buyInRows.length === 2, 'only summary rows for buy-ins')
}

// 6) Transfer still works after buy-in
{
  const r = store.applyChipOp({
    opId: 't1',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: bId,
    type: 'transfer',
    amount: 5,
    targetSeatIds: [bId],
  })
  assert(r.ack.ok, 'transfer still ok')
  const hostSeat = r.data.table.seats.find((s) => s.seatId === hostId)
  const bSeat = r.data.table.seats.find((s) => s.seatId === bId)
  assert(hostSeat.balance === 20, 'host 25-5')
  assert(bSeat.balance === 30, '乙 25+5')
}

console.log('买入验 QA gates: OK')
