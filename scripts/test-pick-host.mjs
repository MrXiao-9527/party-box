/**
 * Host handoff (选新桌主): paused + current host + online candidate.
 * Online = RoomMember.connected. Persist hostSeatId / isHost on members+seats.
 * Run: npm run test:pick-host
 */
import { createRoomStore, ACK_REASONS } from '../server/roomLogic.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const store = createRoomStore()
const created = store.createEmptyHostRoom({ buyInN: 10, maxSeats: 4 })
assert(!('error' in created), 'create')
const code = created.data.room.roomCode
const hostSeat = created.session.seatId
const claimed = store.claimHostSeat(code, hostSeat, '桌主')
assert(claimed, 'claim')
const joined = store.joinRoom(code, '甲')
assert(!('error' in joined), 'join')
const guestSeat = joined.session.seatId
store.setPhase(code, 'playing')

{
  const r = store.pickNewHost(code, guestSeat, hostSeat)
  assert('error' in r && r.error === ACK_REASONS.INVALID, 'playing blocked')
  const still = store.get(code)
  assert(still.room.hostSeatId === hostSeat, 'playing no mutate host')
  assert(still.room.phase === 'playing', 'playing stays')
}

store.setPhase(code, 'paused')

{
  const r = store.pickNewHost(code, guestSeat, guestSeat)
  assert('error' in r && r.error === ACK_REASONS.NOT_HOST, 'guest cannot pick')
}

{
  const r = store.pickNewHost(code, guestSeat, '')
  assert('error' in r && r.error === ACK_REASONS.NOT_HOST, 'missing fromSeat')
}

{
  const r = store.pickNewHost(code, hostSeat, hostSeat)
  assert('error' in r && r.error === ACK_REASONS.INVALID, 'cannot pick self')
}

{
  const r = store.pickNewHost(code, 'seat_missing', hostSeat)
  assert('error' in r && r.error === ACK_REASONS.INVALID, 'unknown seat')
}

store.setMemberConnected(code, guestSeat, false)
{
  const r = store.pickNewHost(code, guestSeat, hostSeat)
  assert(
    'error' in r && r.error === '该成员已离线，无法成为桌主',
    'offline blocked',
  )
}

store.setMemberConnected(code, guestSeat, true)
const before = store.get(code)
const ok = store.pickNewHost(code, guestSeat, hostSeat)
assert(!('error' in ok), 'handoff ok')
assert(ok.room.hostSeatId === guestSeat, 'new host id')
assert(ok.room.phase === 'playing', 'resumed')
assert(
  ok.room.members.find((m) => m.seatId === guestSeat)?.isHost === true,
  'guest member isHost',
)
assert(
  ok.room.members.find((m) => m.seatId === hostSeat)?.isHost === false,
  'old host member not isHost',
)
assert(
  ok.table.seats.find((s) => s.seatId === guestSeat)?.isHost === true,
  'guest seat isHost',
)
assert(
  ok.table.seats.find((s) => s.seatId === hostSeat)?.isHost === false,
  'old host seat not isHost',
)
assert(ok.table.snapshotAt > before.table.snapshotAt, 'snapshot newer')

const persisted = store.get(code)
assert(persisted.room.hostSeatId === guestSeat, 'persisted host id')
assert(
  persisted.room.members.every((m) => m.isHost === (m.seatId === guestSeat)),
  'persisted member flags',
)
assert(
  persisted.table.seats.every((s) => s.isHost === (s.seatId === guestSeat)),
  'persisted seat flags',
)

{
  const r = store.pickNewHost(code, hostSeat, guestSeat)
  assert('error' in r && r.error === ACK_REASONS.INVALID, 'not paused after')
}

assert(ACK_REASONS.NO_HOST_CANDIDATE === '暂无在线成员可接桌', 'empty tip copy')

console.log('OK test-pick-host')
