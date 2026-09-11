/**
 * Create-room + join cap + QR origin QA.
 * Run: npm run test:room-create
 */
import {
  ACK_REASONS,
  createRoomStore,
  parseRoomCreate,
  stampCreateSettings,
  tableFullReason,
} from '../server/roomLogic.mjs'
import { tableSettingsView } from '../src/types/index.ts'

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

{
  const base = { buyInN: 0, maxSeats: 8 }
  const stamped = stampCreateSettings(base, {
    buyInN: 100,
    maxSeats: 4,
    smallBlind: 1,
    bigBlind: 2,
  })
  assert(stamped.buyInN === 100 && stamped.maxSeats === 4, 'stamp overlay')
  assert(stamped.smallBlind === 1 && stamped.bigBlind === 2, 'stamp blinds')
  const skipped = stampCreateSettings(base, { phase: 'playing' })
  assert(skipped.buyInN === 0 && skipped.maxSeats === 8, 'phase-only no stamp')
}

{
  const both = tableSettingsView({
    buyInN: 100,
    maxSeats: 4,
    smallBlind: 1,
    bigBlind: 2,
  })
  assert(both.buyInN === 100 && both.maxSeats === 4, 'view always 买入/人数')
  assert(both.smallBlind === 1 && both.bigBlind === 2, 'view filled blinds')
  const none = tableSettingsView({ buyInN: 100, maxSeats: 4 })
  assert(none.smallBlind === undefined && none.bigBlind === undefined, 'omit empty blinds')
  const onlySb = tableSettingsView({ buyInN: 100, maxSeats: 4, smallBlind: 1 })
  assert(onlySb.smallBlind === 1 && onlySb.bigBlind === undefined, 'omit unfilled 大盲')
  const onlyBb = tableSettingsView({ buyInN: 100, maxSeats: 4, bigBlind: 2 })
  assert(onlyBb.smallBlind === undefined && onlyBb.bigBlind === 2, 'omit unfilled 小盲')
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
assert(afterPhase.room.smallBlind === 1, 'phase keeps sb')
assert(afterPhase.room.bigBlind === 2, 'phase keeps bb')

// Repair path: POST /rooms dropped snapshot (legacy relay) → claim/开桌 body restamps
const legacy = store.createEmptyHostRoom({ seatId: 'seat_legacy' })
assert(!('error' in legacy), 'legacy create')
assert(legacy.data.room.buyInN === 0 && legacy.data.room.maxSeats === 8, 'legacy defaults')
const legacyCode = legacy.data.room.roomCode
store.claimHostSeat(legacyCode, legacy.session.seatId, '桌主', {
  buyInN: 100,
  maxSeats: 4,
  smallBlind: 1,
  bigBlind: 2,
})
const afterClaim = store.get(legacyCode)
assert(afterClaim.room.buyInN === 100, 'claim stamps buyInN')
assert(afterClaim.room.maxSeats === 4, 'claim stamps maxSeats')
assert(afterClaim.room.smallBlind === 1 && afterClaim.room.bigBlind === 2, 'claim stamps blinds')

const empty = store.createEmptyHostRoom({ seatId: 'seat_phase' })
const emptyCode = empty.data.room.roomCode
store.setPhase(emptyCode, 'playing', {
  buyInN: 100,
  maxSeats: 4,
  smallBlind: 1,
  bigBlind: 2,
})
const afterStampPhase = store.get(emptyCode)
assert(afterStampPhase.room.phase === 'playing', 'phase playing')
assert(afterStampPhase.room.buyInN === 100, 'phase stamps buyInN')
assert(afterStampPhase.room.maxSeats === 4, 'phase stamps maxSeats')
assert(
  afterStampPhase.room.smallBlind === 1 && afterStampPhase.room.bigBlind === 2,
  'phase stamps blinds',
)

const noStamp = store.createEmptyHostRoom({ seatId: 'seat_nostamp' })
store.setPhase(noStamp.data.room.roomCode, 'playing', { phase: 'playing' })
const kept = store.get(noStamp.data.room.roomCode)
assert(kept.room.buyInN === 0 && kept.room.maxSeats === 8, 'empty phase body does not invent snapshot')

{
  const created = store.createEmptyHostRoom({ buyInN: 10, maxSeats: 8 })
  assert(!('error' in created), 'mono create')
  const code = created.data.room.roomCode
  created.data.table.snapshotAt = 9_000_000_000_000
  store.set(created.data)
  const host = store.claimHostSeat(code, created.session.seatId, '桌主')
  assert(host && host.table.snapshotAt > 9_000_000_000_000, 'claim strictly newer')
  const atHost = host.table.snapshotAt
  const joined = store.joinRoom(code, '甲')
  assert(!('error' in joined), 'mono join')
  assert(joined.data.table.snapshotAt > atHost, 'join strictly newer than claim')
}

console.log('OK test-room-create')
