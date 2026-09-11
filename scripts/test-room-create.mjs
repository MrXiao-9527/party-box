/**
 * Create-room + join cap + QR origin QA.
 * Run: npm run test:room-create
 */
import {
  ACK_REASONS,
  createRoomStore,
  parseRoomCreate,
  tableFullReason,
} from '../server/roomLogic.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// parseRoomCreate
{
  const badBuy = parseRoomCreate({ buyInN: 0, maxSeats: 8 })
  assert(badBuy.error === ACK_REASONS.POSITIVE_INT, 'buy-in 0')
  const neg = parseRoomCreate({ buyInN: -1, maxSeats: 8 })
  assert(neg.error === ACK_REASONS.POSITIVE_INT, 'buy-in -1')
  const seats1 = parseRoomCreate({ buyInN: 100, maxSeats: 1 })
  assert(seats1.error === ACK_REASONS.SEATS_RANGE, 'seats 1')
  const seats9 = parseRoomCreate({ buyInN: 100, maxSeats: 9 })
  assert(seats9.error === ACK_REASONS.SEATS_RANGE, 'seats 9')
  const ok = parseRoomCreate({
    buyInN: 100,
    maxSeats: 6,
    smallBlind: 1,
    bigBlind: 2,
  })
  assert(ok.ok && ok.buyInN === 100 && ok.maxSeats === 6, 'valid create')
  assert(ok.smallBlind === 1 && ok.bigBlind === 2, 'blinds')
  const omitted = parseRoomCreate({})
  assert(omitted.ok && omitted.buyInN === 0 && omitted.maxSeats === 8, 'defaults')
}

assert(tableFullReason(2) === '本桌已满（最多2人）', 'full copy X=2')
assert(tableFullReason(8) === '本桌已满（最多8人）', 'full copy X=8')
assert(tableFullReason() === ACK_REASONS.TABLE_FULL, 'default 8 alias')

const store = createRoomStore()
const created = store.createEmptyHostRoom({
  buyInN: 50,
  maxSeats: 2,
  smallBlind: 1,
  bigBlind: 2,
})
assert(!('error' in created), 'create ok')
assert(created.data.room.buyInN === 50, 'persist buyInN')
assert(created.data.room.maxSeats === 2, 'persist maxSeats')
assert(created.data.room.smallBlind === 1, 'persist sb')
assert(created.data.room.bigBlind === 2, 'persist bb')

const rejected = store.createEmptyHostRoom({ buyInN: 0, maxSeats: 8 })
assert(rejected.error === ACK_REASONS.POSITIVE_INT, 'store rejects buy-in 0')
const rejectedSeats = store.createEmptyHostRoom({ buyInN: 10, maxSeats: 9 })
assert(rejectedSeats.error === ACK_REASONS.SEATS_RANGE, 'store rejects seats 9')

const code = created.data.room.roomCode
const host = store.claimHostSeat(code, created.session.seatId, '桌主')
assert(host && host.room.maxSeats === 2, 'claim keeps maxSeats')
const j1 = store.joinRoom(code, '甲')
assert(!('error' in j1), 'second seat ok')
const j2 = store.joinRoom(code, '乙')
assert(j2.error === '本桌已满（最多2人）', 'third seat full copy')

store.setPhase(code, 'playing')
const afterPhase = store.get(code)
assert(afterPhase.room.maxSeats === 2, 'phase keeps maxSeats')
assert(afterPhase.room.buyInN === 50, 'phase keeps buyInN')

console.log('OK test-room-create')
