/**
 * Host handoff (选新桌主): paused after host left + any connected member
 * picks another connected member (not self). Persist hostSeatId / isHost.
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
const joinedA = store.joinRoom(code, '甲')
assert(!('error' in joinedA), 'join A')
const seatA = joinedA.session.seatId
const joinedB = store.joinRoom(code, '乙')
assert(!('error' in joinedB), 'join B')
const seatB = joinedB.session.seatId
store.setPhase(code, 'playing')

{
  const r = store.pickNewHost(code, seatB, seatA)
  assert('error' in r && r.error === ACK_REASONS.INVALID, 'playing blocked')
  const still = store.get(code)
  assert(still.room.hostSeatId === hostSeat, 'playing no mutate host')
  assert(still.room.phase === 'playing', 'playing stays')
}

store.setPhase(code, 'paused')

{
  const r = store.pickNewHost(code, seatB, seatA)
  assert(
    'error' in r && r.error === ACK_REASONS.INVALID,
    'paused but host still connected (not 桌主已离开)',
  )
}

{
  const r = store.pickNewHost(code, seatB, hostSeat)
  assert(
    'error' in r && r.error === ACK_REASONS.INVALID,
    'left-host cannot pick while still marked connected',
  )
}

store.setMemberConnected(code, hostSeat, false)

{
  const r = store.pickNewHost(code, seatB, '')
  assert('error' in r && r.error === ACK_REASONS.INVALID, 'missing fromSeat')
}

{
  const r = store.pickNewHost(code, seatB, hostSeat)
  assert(
    'error' in r && r.error === ACK_REASONS.INVALID,
    'disconnected host cannot pick',
  )
}

{
  const r = store.pickNewHost(code, seatA, seatA)
  assert('error' in r && r.error === ACK_REASONS.INVALID, 'cannot pick self')
}

{
  const r = store.pickNewHost(code, hostSeat, seatA)
  assert('error' in r && r.error === ACK_REASONS.INVALID, 'cannot pick left host')
}

{
  const r = store.pickNewHost(code, 'seat_missing', seatA)
  assert('error' in r && r.error === ACK_REASONS.INVALID, 'unknown seat')
}

store.setMemberConnected(code, seatB, false)
{
  const r = store.pickNewHost(code, seatB, seatA)
  assert(
    'error' in r && r.error === '该成员已离线，无法成为桌主',
    'offline blocked',
  )
}

store.setMemberConnected(code, seatB, true)
const before = store.get(code)
const ok = store.pickNewHost(code, seatB, seatA)
assert(!('error' in ok), 'guest A picks guest B')
assert(ok.room.hostSeatId === seatB, 'new host id')
assert(ok.room.phase === 'playing', 'resumed')
assert(
  ok.room.members.find((m) => m.seatId === seatB)?.isHost === true,
  'B member isHost',
)
assert(
  ok.room.members.find((m) => m.seatId === hostSeat)?.isHost === false,
  'old host member not isHost',
)
assert(
  ok.room.members.find((m) => m.seatId === seatA)?.isHost === false,
  'picker A not isHost',
)
assert(
  ok.table.seats.find((s) => s.seatId === seatB)?.isHost === true,
  'B seat isHost',
)
assert(
  ok.table.seats.find((s) => s.seatId === hostSeat)?.isHost === false,
  'old host seat not isHost',
)
assert(ok.table.snapshotAt > before.table.snapshotAt, 'snapshot newer')

const persisted = store.get(code)
assert(persisted.room.hostSeatId === seatB, 'persisted host id')
assert(
  persisted.room.members.every((m) => m.isHost === (m.seatId === seatB)),
  'persisted member flags',
)
assert(
  persisted.table.seats.every((s) => s.isHost === (s.seatId === seatB)),
  'persisted seat flags',
)

{
  const r = store.pickNewHost(code, seatA, seatB)
  assert('error' in r && r.error === ACK_REASONS.INVALID, 'not paused after')
}

assert(ACK_REASONS.NO_HOST_CANDIDATE === '暂无在线成员可接桌', 'empty tip copy')

console.log('OK test-pick-host')
