/**
 * 结算验 — min-transfer algorithm + 累计买入 rules + settlement gates.
 * Run: npm run test:settlement
 */
import { createRoomStore, ACK_REASONS } from '../server/roomLogic.mjs'
import {
  SETTLEMENT_COPY,
  buildSettlement,
  formatTransferLine,
  formatTransferList,
  minTransfers,
  settlementToast,
} from '../src/settlement.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function deepEqual(a, b, msg) {
  const sa = JSON.stringify(a)
  const sb = JSON.stringify(b)
  if (sa !== sb) throw new Error(`${msg}: ${sa} !== ${sb}`)
}

// —— min-transfer algorithm ——
{
  deepEqual(minTransfers([]), [], 'empty')
  deepEqual(minTransfers([{ name: '甲', net: 0 }]), [], 'zero net')

  deepEqual(
    minTransfers([
      { name: '甲', net: -50 },
      { name: '乙', net: 50 },
    ]),
    [{ fromName: '甲', toName: '乙', amount: 50 }],
    'pair',
  )

  const three = minTransfers([
    { name: '甲', net: -70 },
    { name: '乙', net: -30 },
    { name: '丙', net: 100 },
  ])
  deepEqual(
    three,
    [
      { fromName: '甲', toName: '丙', amount: 70 },
      { fromName: '乙', toName: '丙', amount: 30 },
    ],
    'two debtors → one creditor',
  )

  const splitCred = minTransfers([
    { name: '甲', net: -50 },
    { name: '乙', net: 20 },
    { name: '丙', net: 30 },
  ])
  deepEqual(
    splitCred,
    [
      { fromName: '甲', toName: '丙', amount: 30 },
      { fromName: '甲', toName: '乙', amount: 20 },
    ],
    'largest creditor first',
  )

  const lines = formatTransferList(splitCred)
  assert(lines === '甲 → 丙 · 30\n甲 → 乙 · 20', 'copy format')
  assert(formatTransferLine(splitCred[0]) === '甲 → 丙 · 30', 'line format')

  const paid = three.reduce((a, t) => a + t.amount, 0)
  assert(paid === 100, 'transfers sum to credit')
}

// —— validation / 底池 copy ——
{
  const potBlock = buildSettlement({
    seats: [
      { seatId: 'a', name: '甲', balance: 90, buyIn: 100 },
      { seatId: 'b', name: '乙', balance: 100, buyIn: 100 },
    ],
    pot: 10,
  })
  assert(potBlock.block === 'pot', 'pot blocks')
  assert(potBlock.transfers.length === 0, 'no list when pot')
  assert(settlementToast(potBlock.block) === SETTLEMENT_COPY.POT_REMAINING, 'pot copy')
  assert(
    settlementToast(potBlock.block) === '底池还有筹码，请先分完再结算',
    '底池 exact',
  )

  const mismatch = buildSettlement({
    seats: [
      { seatId: 'a', name: '甲', balance: 80, buyIn: 100 },
      { seatId: 'b', name: '乙', balance: 100, buyIn: 100 },
    ],
    pot: 0,
  })
  assert(mismatch.block === 'mismatch', 'mismatch blocks')
  assert(mismatch.transfers.length === 0, 'no list when mismatch')
  assert(
    settlementToast(mismatch.block) ===
      '买入与结算对不上，多半漏了补码，请先核对',
    'mismatch exact',
  )
  assert(mismatch.buyInTotal === 200 && mismatch.settleTotal === 180, 'totals')
  assert(mismatch.netTotal === -20, 'net total')
  assert(SETTLEMENT_COPY.MISMATCH === '买入与结算对不上，多半漏了补码，请先核对')
  assert(SETTLEMENT_COPY.POT_REMAINING === '底池还有筹码，请先分完再结算')
  assert(SETTLEMENT_COPY.FLAT === '本局打平，无需转账', 'flat exact')

  const flat = buildSettlement({
    seats: [
      { seatId: 'a', name: '甲', balance: 100, buyIn: 100 },
      { seatId: 'b', name: '乙', balance: 100, buyIn: 100 },
    ],
    pot: 0,
  })
  assert(flat.block === null, 'flat ok')
  assert(flat.transfers.length === 0, 'flat no transfers')
  assert(flat.netTotal === 0, 'flat net 0')

  const ok = buildSettlement({
    seats: [
      { seatId: 'a', name: '甲', balance: 40, buyIn: 100 },
      { seatId: 'b', name: '乙', balance: 160, buyIn: 100 },
    ],
    pot: 0,
  })
  assert(ok.block === null, 'balanced ok')
  assert(ok.netTotal === 0, 'net 0')
  deepEqual(
    ok.transfers,
    [{ fromName: '甲', toName: '乙', amount: 60 }],
    'suggest 甲 → 乙 · 60',
  )
}

// —— 累计买入 rules (roomLogic) ——
{
  const store = createRoomStore()
  const { session: host, data: room0 } = store.createEmptyHostRoom()
  const claimed = store.claimHostSeat(room0.room.roomCode, host.seatId, '地主')
  assert(claimed, 'claim')
  const code = claimed.room.roomCode
  const j1 = store.joinRoom(code, '甲')
  const j2 = store.joinRoom(code, '乙')
  assert(!('error' in j1) && !('error' in j2), 'join')
  store.setPhase(code, 'playing')

  const hostId = host.seatId
  const aId = j1.session.seatId
  const bId = j2.session.seatId

  function seat(id) {
    return store.get(code).table.seats.find((s) => s.seatId === id)
  }
  function buy(id) {
    return seat(id).buyIn
  }
  function bal(id) {
    return seat(id).balance
  }
  function op(partial) {
    return store.applyChipOp({
      roomCode: code,
      fromSeatId: hostId,
      targetSeatId: hostId,
      ...partial,
    })
  }

  // New seats start at 0
  assert(buy(hostId) === 0 && buy(aId) === 0 && buy(bId) === 0, 'buyIn 0')

  // Seat + increments 累计买入
  const rPlus = op({ opId: 'p1', type: '+batch', amount: 20, targetSeatId: aId })
  assert(rPlus.ack.ok && bal(aId) === 20 && buy(aId) === 20, 'seat+ adds buyIn')

  // Seat − changes balance only
  const rMinus = op({ opId: 'm1', type: '-denom', denom: 5, targetSeatId: aId })
  assert(rMinus.ack.ok && bal(aId) === 15 && buy(aId) === 20, 'seat- keeps buyIn')

  // Undo seat− first (latest): balance back, buyIn still 20
  const uMinus = op({ opId: 'u_minus', type: 'undoLast' })
  assert(uMinus.ack.ok && bal(aId) === 20 && buy(aId) === 20, 'undo - keeps buyIn')

  // Undo seat+: reverse buyIn increment
  const uPlus = op({ opId: 'u_plus', type: 'undoLast' })
  assert(uPlus.ack.ok && bal(aId) === 0 && buy(aId) === 0, 'undo + reverses buyIn')

  // Transfer / pot do not touch buyIn
  op({ opId: 'seedH', type: '+batch', amount: 40, targetSeatId: hostId })
  assert(buy(hostId) === 40, 'host buyIn 40')
  const rT = op({
    opId: 't1',
    type: 'transfer',
    amount: 10,
    targetSeatId: bId,
    targetSeatIds: [bId],
  })
  assert(rT.ack.ok, 'transfer')
  assert(bal(hostId) === 30 && bal(bId) === 10, 'transfer bals')
  assert(buy(hostId) === 40 && buy(bId) === 0, 'transfer no buyIn')

  const rIn = op({ opId: 'pot1', type: 'potIn', amount: 8 })
  assert(rIn.ack.ok && rIn.data.table.pot === 8, 'potIn')
  assert(buy(hostId) === 40 && bal(hostId) === 22, 'potIn no buyIn')
  const rOut = op({ opId: 'pot2', type: 'potOut', amount: 3, targetSeatId: bId })
  assert(rOut.ack.ok && rOut.data.table.pot === 5, 'potOut')
  assert(buy(bId) === 0 && bal(bId) === 13, 'potOut no buyIn')
  const rSplit = op({ opId: 'pot3', type: 'potSplit', amount: 3 })
  assert(rSplit.ack.ok, 'potSplit')
  assert(buy(hostId) === 40 && buy(aId) === 0 && buy(bId) === 0, 'potSplit no buyIn')

  op({ opId: 'u_split', type: 'undoLast' })
  op({ opId: 'u_out', type: 'undoLast' })
  op({ opId: 'u_in', type: 'undoLast' })
  assert(buy(hostId) === 40 && buy(bId) === 0, 'undo pot no buyIn')
  op({ opId: 'u_t', type: 'undoLast' })
  assert(buy(hostId) === 40 && buy(bId) === 0 && bal(hostId) === 40, 'undo xfer')

  // uniformBuyIn resets 累计买入 to N (not add)
  op({ opId: 'seed2', type: '+batch', amount: 7, targetSeatId: aId })
  assert(buy(aId) === 7, 'pre buy-in')
  const rB = op({ opId: 'b1', type: 'uniformBuyIn', amount: 100 })
  assert(rB.ack.ok, 'buy-in')
  for (const s of rB.data.table.seats) {
    assert(s.balance === 100 && s.buyIn === 100, `reset buyIn ${s.name}`)
  }
  const prev = rB.data.table.ledger.at(-1).prevBalances
  assert(prev.some((p) => p.seatId === aId && p.buyIn === 7), 'prev buyIn stored')

  // Undo uniformBuyIn restores previous buy-in totals
  const uB = op({ opId: 'u_buy', type: 'undoLast' })
  assert(uB.ack.ok, 'undo buy-in')
  assert(buy(aId) === 7 && bal(aId) === 7, 'restore 甲 buyIn')
  assert(buy(hostId) === 40 && buy(bId) === 0, 'restore host 40 / 乙 0')

  // Replay buy-in for settlement open
  op({ opId: 'b2', type: 'uniformBuyIn', amount: 50 })

  // Guest cannot open
  const guestOpen = store.applyChipOp({
    opId: 'gopen',
    roomCode: code,
    fromSeatId: aId,
    targetSeatId: aId,
    type: 'openSettlement',
  })
  assert(
    !guestOpen.ack.ok && guestOpen.ack.reason === ACK_REASONS.NOT_HOST,
    'guest open blocked',
  )

  // Host opens settlement; chip ops blocked; balances unchanged
  const open = op({ opId: 'open1', type: 'openSettlement' })
  assert(open.ack.ok && open.data.table.settling === true, 'open')
  const bals = open.data.table.seats.map((s) => s.balance)
  const blocked = op({
    opId: 'blocked+',
    type: '+batch',
    amount: 5,
    targetSeatId: hostId,
  })
  assert(
    !blocked.ack.ok && blocked.ack.reason === ACK_REASONS.TABLE_SETTLING,
    'ops blocked while settling',
  )
  assert(
    store.get(code).table.seats.map((s) => s.balance).join() === bals.join(),
    'no mutate on blocked op',
  )

  const guestClose = store.applyChipOp({
    opId: 'gclose',
    roomCode: code,
    fromSeatId: aId,
    targetSeatId: aId,
    type: 'closeSettlement',
  })
  assert(
    !guestClose.ack.ok && guestClose.ack.reason === ACK_REASONS.NOT_HOST,
    'guest close blocked',
  )

  const close = op({ opId: 'close1', type: 'closeSettlement' })
  assert(close.ack.ok && close.data.table.settling === false, 'close')

  // After close, + still works
  const after = op({ opId: 'after+', type: '+denom', denom: 1, targetSeatId: hostId })
  assert(after.ack.ok && buy(hostId) === 51 && bal(hostId) === 51, 'after close +')
}

console.log('结算验 QA gates: OK')
