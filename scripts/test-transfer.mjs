/**
 * Quick host-authoritative transfer QA gates (roomLogic).
 * Run: node scripts/test-transfer.mjs
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

// Seed balances via +batch
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
  amount: 1,
})

// 1) A→B style: host → 甲 transfer 3
{
  const before = store.get(code)
  const r = store.applyChipOp({
    opId: 't1',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: aId,
    type: 'transfer',
    amount: 3,
    targetSeatIds: [aId],
  })
  assert(r.ack.ok, 'transfer 3 ok')
  const hostSeat = r.data.table.seats.find((s) => s.seatId === hostId)
  const aSeat = r.data.table.seats.find((s) => s.seatId === aId)
  assert(hostSeat.balance === before.table.seats.find((s) => s.seatId === hostId).balance - 3, 'host -3')
  assert(aSeat.balance === before.table.seats.find((s) => s.seatId === aId).balance + 3, '甲 +3')
  assert(r.data.table.ledger.length === before.table.ledger.length + 1, 'ledger +1 transfer row')
  const last = r.data.table.ledger.at(-1)
  assert(last.amount === 3, 'ledger amount')
  assert(last.fromSeatId === hostId && last.toSeatId === aId, 'ledger who')
  assert(ledgerEntrySummary(last) === '地主 → 甲 · 转 3', 'copy 地主 → 甲 · 转 3')
}

// 2) One-to-many ×3
{
  const before = store.get(code)
  const r = store.applyChipOp({
    opId: 't2',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: aId,
    type: 'transfer',
    amount: 3,
    targetSeatIds: [aId, bId],
  })
  assert(r.ack.ok, 'one-to-many ok')
  const hostSeat = r.data.table.seats.find((s) => s.seatId === hostId)
  assert(hostSeat.balance === before.table.seats.find((s) => s.seatId === hostId).balance - 6, 'host -6')
  assert(r.data.table.ledger.length === before.table.ledger.length + 2, 'ledger +2 rows')
}

// 3) Insufficient — whole batch fails, no partial, no ledger
{
  const before = store.get(code)
  const ledgerLen = before.table.ledger.length
  const balA = before.table.seats.find((s) => s.seatId === aId).balance
  const balB = before.table.seats.find((s) => s.seatId === bId).balance
  const r = store.applyChipOp({
    opId: 't3',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: aId,
    type: 'transfer',
    amount: 999,
    targetSeatIds: [aId, bId],
  })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.INSUFFICIENT, '余额不足')
  const after = store.get(code)
  assert(after.table.seats.find((s) => s.seatId === aId).balance === balA, 'no partial A')
  assert(after.table.seats.find((s) => s.seatId === bId).balance === balB, 'no partial B')
  assert(after.table.ledger.length === ledgerLen, 'no ledger on fail')
}

// 4) Locked / paused / self
{
  store.applyChipOp({
    opId: 'lockA',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: aId,
    type: 'lock',
  })
  const rLock = store.applyChipOp({
    opId: 't4',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: aId,
    type: 'transfer',
    amount: 1,
    targetSeatIds: [aId],
  })
  assert(rLock.ack.reason === ACK_REASONS.SEAT_LOCKED, '席位已锁定')

  store.applyChipOp({
    opId: 'unlockA',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: aId,
    type: 'unlock',
  })

  const rSelf = store.applyChipOp({
    opId: 't5',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: hostId,
    type: 'transfer',
    amount: 1,
    targetSeatIds: [hostId],
  })
  assert(rSelf.ack.reason === ACK_REASONS.SELF_TRANSFER, '不能转给自己')

  store.setPhase(code, 'paused')
  const rPause = store.applyChipOp({
    opId: 't6',
    roomCode: code,
    fromSeatId: hostId,
    targetSeatId: bId,
    type: 'transfer',
    amount: 1,
    targetSeatIds: [bId],
  })
  assert(rPause.ack.reason === ACK_REASONS.TABLE_PAUSED, 'paused blocks')
}

console.log('transfer QA gates: OK')
