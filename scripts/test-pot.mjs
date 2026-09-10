/**
 * Host-authoritative public pot QA gates (roomLogic) — 「公共锅验」.
 * Run: npm run test:pot
 *
 * Covers: potIn / potOut / potSplit + undo + locked/paused/insufficient.
 */
import {
  createRoomStore,
  ACK_REASONS,
  ledgerEntrySummary,
} from '../server/roomLogic.mjs'

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

function pot() {
  return store.get(code).table.pot
}

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

// Seed seat balances
op({ opId: 'seedH', type: '+batch', amount: 100, targetSeatId: hostId })
op({ opId: 'seedA', type: '+batch', amount: 40, targetSeatId: aId })
op({ opId: 'seedB', type: '+batch', amount: 20, targetSeatId: bId })
assert(pot() === 0, 'pot starts 0')

// 1) potIn: 甲 → 锅 +10
{
  const beforeA = bal(aId)
  const r = store.applyChipOp({
    opId: 'pi1',
    roomCode: code,
    fromSeatId: aId,
    targetSeatId: aId,
    type: 'potIn',
    amount: 10,
  })
  assert(r.ack.ok, 'potIn ok')
  assert(bal(aId) === beforeA - 10, '甲 -10')
  assert(pot() === 10, '锅 +10')
  const row = r.data.table.ledger.at(-1)
  assert(row.kind === 'potIn' && row.amount === 10, 'potIn ledger')
  assert(ledgerEntrySummary(row) === '甲 → 锅 +10', 'copy 甲 → 锅 +10')
}

// 2) potOut: 锅 → 乙 +4
{
  const beforeB = bal(bId)
  const beforePot = pot()
  const r = op({
    opId: 'po1',
    type: 'potOut',
    amount: 4,
    targetSeatId: bId,
  })
  assert(r.ack.ok, 'potOut ok')
  assert(pot() === beforePot - 4, '锅 -4')
  assert(bal(bId) === beforeB + 4, '乙 +4')
  const row = r.data.table.ledger.at(-1)
  assert(row.kind === 'potOut', 'potOut kind')
  assert(ledgerEntrySummary(row) === '锅 → 乙 +4', 'copy 锅 → 乙 +4')
}

// 3) potSplit floor + remainder stays
{
  // pot is 6; put more via host potIn
  op({ opId: 'piH', type: 'potIn', amount: 10, targetSeatId: hostId })
  assert(pot() === 16, 'pot 16')
  const before = {
    host: bal(hostId),
    a: bal(aId),
    b: bal(bId),
    pot: pot(),
  }
  // Lock 甲 — split must skip locked
  op({ opId: 'lockA', type: 'lock', targetSeatId: aId })
  const r = op({ opId: 'ps1', type: 'potSplit', amount: 10 })
  assert(r.ack.ok, 'potSplit ok')
  // eligible: host + 乙 = 2; floor(10/2)=5; totalOut=10; pot 16→6; 甲 unchanged
  assert(bal(hostId) === before.host + 5, 'host +5')
  assert(bal(bId) === before.b + 5, '乙 +5')
  assert(bal(aId) === before.a, '甲 skipped (locked)')
  assert(pot() === before.pot - 10, 'pot -10')
  const row = r.data.table.ledger.at(-1)
  assert(row.kind === 'potSplit' && row.amount === 5, 'share 5')
  assert(row.splitSeatIds?.length === 2, '2 recipients')
  assert(!row.splitSeatIds.includes(aId), 'locked not in splitSeatIds')
  assert(ledgerEntrySummary(row) === '锅均分 · 在座2人 · 各 +5 · 余0留锅', 'copy 锅均分')
  op({ opId: 'unlockA', type: 'unlock', targetSeatId: aId })
}

// 4) Remainder stays: pot=7, N=7, 3 seats → each +2, pot left 1
{
  // drain pot to known value via potOut leftovers then set by potIns
  // Current pot after §3 is 6. potIn 1 → 7
  store.applyChipOp({
    opId: 'piA2',
    roomCode: code,
    fromSeatId: aId,
    targetSeatId: aId,
    type: 'potIn',
    amount: 1,
  })
  assert(pot() === 7, 'pot 7')
  const before = {
    host: bal(hostId),
    a: bal(aId),
    b: bal(bId),
  }
  const r = op({ opId: 'ps2', type: 'potSplit', amount: 7 })
  assert(r.ack.ok, 'split 7/3')
  assert(r.data.table.ledger.at(-1).amount === 2, 'floor share 2')
  assert(r.data.table.ledger.at(-1).splitRemainder === 1, 'remainder 1')
  assert(
    ledgerEntrySummary(r.data.table.ledger.at(-1)) ===
      '锅均分 · 在座3人 · 各 +2 · 余1留锅',
    'copy remainder',
  )
  assert(bal(hostId) === before.host + 2, 'h+2')
  assert(bal(aId) === before.a + 2, 'a+2')
  assert(bal(bId) === before.b + 2, 'b+2')
  assert(pot() === 1, 'remainder 1 stays')
}

// 5) Insufficient seat / pot — whole fail, no partial, no ledger
{
  const before = store.get(code)
  const ledLen = before.table.ledger.length
  const rSeat = store.applyChipOp({
    opId: 'piFail',
    roomCode: code,
    fromSeatId: bId,
    targetSeatId: bId,
    type: 'potIn',
    amount: 9999,
  })
  assert(
    !rSeat.ack.ok && rSeat.ack.reason === ACK_REASONS.INSUFFICIENT,
    '余额不足',
  )
  assert(store.get(code).table.ledger.length === ledLen, 'no ledger seat fail')
  assert(store.get(code).table.pot === before.table.pot, 'pot unchanged')

  const rPot = op({
    opId: 'poFail',
    type: 'potOut',
    amount: 9999,
    targetSeatId: aId,
  })
  assert(
    !rPot.ack.ok && rPot.ack.reason === ACK_REASONS.POT_INSUFFICIENT,
    '锅内不足 out',
  )
  assert(store.get(code).table.ledger.length === ledLen, 'no ledger pot fail')

  const rSplit0 = op({ opId: 'psFail0', type: 'potSplit', amount: 1 })
  // pot is 1 — ok amount-wise; but if pot were 0:
  // drain pot first
  op({ opId: 'drain', type: 'potOut', amount: 1, targetSeatId: hostId })
  assert(pot() === 0, 'pot 0')
  const ledLen2 = store.get(code).table.ledger.length
  const rZero = op({
    opId: 'poZero',
    type: 'potOut',
    amount: 1,
    targetSeatId: aId,
  })
  assert(
    !rZero.ack.ok && rZero.ack.reason === ACK_REASONS.POT_INSUFFICIENT,
    'pot=0 still 锅内不足',
  )
  assert(store.get(code).table.ledger.length === ledLen2, 'no ledger on pot0')
  void rSplit0
}

// 6) N≤0 → 请输入正整数
{
  const ledLen = store.get(code).table.ledger.length
  for (const amount of [0, -3]) {
    const r = op({ opId: `bad_${amount}`, type: 'potIn', amount })
    assert(
      !r.ack.ok && r.ack.reason === ACK_REASONS.POSITIVE_INT,
      `potIn ${amount}`,
    )
    const r2 = op({
      opId: `bad_out_${amount}`,
      type: 'potOut',
      amount,
      targetSeatId: aId,
    })
    assert(
      !r2.ack.ok && r2.ack.reason === ACK_REASONS.POSITIVE_INT,
      `potOut ${amount}`,
    )
    const r3 = op({ opId: `bad_sp_${amount}`, type: 'potSplit', amount })
    assert(
      !r3.ack.ok && r3.ack.reason === ACK_REASONS.POSITIVE_INT,
      `potSplit ${amount}`,
    )
  }
  assert(store.get(code).table.ledger.length === ledLen, 'no ledger on N≤0')
}

// 7) Locked cannot pot-in
{
  op({ opId: 'lockA2', type: 'lock', targetSeatId: aId })
  const ledLen = store.get(code).table.ledger.length
  const r = store.applyChipOp({
    opId: 'piLock',
    roomCode: code,
    fromSeatId: aId,
    targetSeatId: aId,
    type: 'potIn',
    amount: 1,
  })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.SEAT_LOCKED, 'locked potIn')
  assert(store.get(code).table.ledger.length === ledLen, 'no ledger locked')
  op({ opId: 'unlockA2', type: 'unlock', targetSeatId: aId })
}

// 8) Non-host potOut / potSplit rejected
{
  // Seed pot
  op({ opId: 'piH2', type: 'potIn', amount: 9 })
  const ledLen = store.get(code).table.ledger.length
  const r = store.applyChipOp({
    opId: 'poNH',
    roomCode: code,
    fromSeatId: aId,
    targetSeatId: bId,
    type: 'potOut',
    amount: 1,
  })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.NOT_HOST, 'non-host out')
  const r2 = store.applyChipOp({
    opId: 'psNH',
    roomCode: code,
    fromSeatId: aId,
    targetSeatId: aId,
    type: 'potSplit',
    amount: 3,
  })
  assert(!r2.ack.ok && r2.ack.reason === ACK_REASONS.NOT_HOST, 'non-host split')
  assert(store.get(code).table.ledger.length === ledLen, 'no ledger non-host')
}

// 9) Undo potIn / potOut / potSplit (same ledger queue)
{
  const before = {
    host: bal(hostId),
    a: bal(aId),
    b: bal(bId),
    pot: pot(),
  }
  // Ensure known pot via potIn from host
  const rIn = op({ opId: 'u_pi', type: 'potIn', amount: 6 })
  assert(rIn.ack.ok && ledgerEntrySummary(rIn.data.table.ledger.at(-1)).includes('→ 锅'), 'in')
  assert(pot() === before.pot + 6, 'pot after in')

  const rOut = op({
    opId: 'u_po',
    type: 'potOut',
    amount: 2,
    targetSeatId: aId,
  })
  assert(rOut.ack.ok, 'out')
  assert(bal(aId) === before.a + 2, 'a after out')

  const rSp = op({ opId: 'u_ps', type: 'potSplit', amount: 3 })
  assert(rSp.ack.ok, 'split for undo')
  const share = rSp.data.table.ledger.at(-1).amount
  assert(share === 1, 'share 1 among 3')

  // Undo split
  const u1 = op({ opId: 'undo_ps', type: 'undoLast' })
  assert(u1.ack.ok, 'undo split')
  assert(u1.data.table.ledger.at(-1).fromName === '锅均分 · 在座3人 · 各 +1 · 余0留锅', 'undo summary split')
  assert(pot() === before.pot + 6 - 2, 'pot after undo split')

  // Undo potOut
  const u2 = op({ opId: 'undo_po', type: 'undoLast' })
  assert(u2.ack.ok && u2.data.table.ledger.at(-1).fromName === '锅 → 甲 +2', 'undo out')
  assert(bal(aId) === before.a, 'a restored')
  assert(pot() === before.pot + 6, 'pot restored out')

  // Undo potIn
  const u3 = op({ opId: 'undo_pi', type: 'undoLast' })
  assert(u3.ack.ok && u3.data.table.ledger.at(-1).fromName.includes('→ 锅 +6'), 'undo in')
  assert(pot() === before.pot, 'pot restored in')
  assert(bal(hostId) === before.host, 'host restored')
}

// 10) Paused blocks pot ops
{
  store.setPhase(code, 'paused')
  const ledLen = store.get(code).table.ledger.length
  const r = op({ opId: 'pause_pi', type: 'potIn', amount: 1 })
  assert(!r.ack.ok && r.ack.reason === ACK_REASONS.TABLE_PAUSED, 'paused potIn')
  const r2 = op({
    opId: 'pause_po',
    type: 'potOut',
    amount: 1,
    targetSeatId: aId,
  })
  assert(!r2.ack.ok && r2.ack.reason === ACK_REASONS.TABLE_PAUSED, 'paused potOut')
  assert(store.get(code).table.ledger.length === ledLen, 'paused no ledger')
  store.setPhase(code, 'playing')
}

// 11) Transfer still independent after pot path
{
  const beforeH = bal(hostId)
  const beforeB = bal(bId)
  const beforePot = pot()
  const r = op({
    opId: 't_after',
    type: 'transfer',
    amount: 3,
    targetSeatId: bId,
    targetSeatIds: [bId],
  })
  assert(r.ack.ok, 'transfer after pot')
  assert(bal(hostId) === beforeH - 3 && bal(bId) === beforeB + 3, 'transfer deltas')
  assert(pot() === beforePot, 'pot untouched by transfer')
}

// 12) pot survives member-connected / phase / seatAdjust (same TableSnapshot)
{
  op({ opId: 'pi_persist', type: 'potIn', amount: 8, targetSeatId: hostId })
  const before = pot()
  assert(before >= 8, 'seed pot for persist')
  store.setMemberConnected(code, aId, false)
  store.setMemberConnected(code, aId, true)
  store.setPhase(code, 'playing')
  op({ opId: 'adj_persist', type: '+denom', denom: 1, targetSeatId: hostId })
  assert(pot() === before, 'pot unchanged across non-pot mutations')
  const snap = store.get(code).table
  assert(typeof snap.pot === 'number' && Number.isInteger(snap.pot), 'pot always numeric on snapshot')
}

// 13) Numeric-string amount (JSON quirk) still settles potIn
{
  const before = pot()
  const beforeA = bal(aId)
  const r = store.applyChipOp({
    opId: 'pi_str',
    roomCode: code,
    fromSeatId: aId,
    targetSeatId: aId,
    type: 'potIn',
    amount: /** @type {any} */ ('5'),
  })
  assert(r.ack.ok, 'potIn string amount ok')
  assert(pot() === before + 5, 'pot +5 from string amount')
  assert(bal(aId) === beforeA - 5, 'seat -5 from string amount')
}

// 14) Guest potIn never 「操作无效」 when unlocked + funded
{
  const r = store.applyChipOp({
    opId: 'pi_guest_ok',
    roomCode: code,
    fromSeatId: bId,
    targetSeatId: bId,
    type: 'potIn',
    amount: 2,
  })
  assert(r.ack.ok, 'guest potIn ok')
  assert(r.ack.reason !== ACK_REASONS.INVALID, 'not 操作无效')
}

console.log('公共锅验 QA gates: OK')
