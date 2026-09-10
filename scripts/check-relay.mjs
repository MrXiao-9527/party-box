/**
 * Smoke test: create room on relay, fetch from "other client", join, chip op.
 * Run: npm run relay &  →  npm run test:relay
 */
const BASE = process.env.RELAY_URL || 'http://127.0.0.1:45322'

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

const health = await json('/health')
assert(health.status === 200 && health.body?.ok, 'health')

const created = await json('/rooms', { method: 'POST', body: '{}' })
assert(created.status === 201, 'create room')
const code = created.body.data.room.roomCode
const hostSeat = created.body.session.seatId
console.log('created', code)

const fetched = await json(`/rooms/${code}`)
assert(fetched.status === 200, 'other client GET room')
assert(fetched.body.data.room.roomCode === code, 'same roomCode')

const claimed = await json(`/rooms/${code}/claim-host`, {
  method: 'POST',
  body: JSON.stringify({ seatId: hostSeat, name: '桌主A' }),
})
assert(claimed.status === 200, 'claim host')
assert(claimed.body.data.room.members.length === 1, 'host seated')

const joined = await json(`/rooms/${code}/join`, {
  method: 'POST',
  body: JSON.stringify({ name: '玩家B' }),
})
assert(joined.status === 200, 'join from device B')
assert(joined.body.data.room.members.length === 2, 'two members')
const guestSeat = joined.body.session.seatId

const playing = await json(`/rooms/${code}/phase`, {
  method: 'POST',
  body: JSON.stringify({ phase: 'playing' }),
})
assert(playing.status === 200, 'start playing')

const op = await json(`/rooms/${code}/ops`, {
  method: 'POST',
  body: JSON.stringify({
    opId: 'op_test_1',
    roomCode: code,
    fromSeatId: guestSeat,
    targetSeatId: guestSeat,
    type: '+denom',
    denom: 5,
  }),
})
assert(op.status === 200 && op.body.ack.ok, 'chip op ack')
const guest = op.body.data.table.seats.find((s) => s.seatId === guestSeat)
assert(guest?.balance === 5, 'balance synced on relay')

const again = await json(`/rooms/${code}`)
assert(
  again.body.data.table.seats.find((s) => s.seatId === guestSeat)?.balance === 5,
  'snapshot visible to other client',
)

console.log('OK relay smoke — two logical clients share room', code)
