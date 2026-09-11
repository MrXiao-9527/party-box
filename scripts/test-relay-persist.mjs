/**
 * Acceptance: Node relay remount restores the SAME room snapshot from disk.
 *
 * Run: node scripts/test-relay-persist.mjs
 * Spawns two sequential relay processes sharing PARTY_BOX_DATA_DIR.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 45329
const BASE = `http://127.0.0.1:${PORT}`
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-persist-'))

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

async function json(p, init) {
  const res = await fetch(`${BASE}${p}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

function startRelay() {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      PARTY_BOX_DATA_DIR: DATA,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (c) => {
    log += String(c)
  })
  child.stderr.on('data', (c) => {
    log += String(c)
  })
  return { child, getLog: () => log }
}

async function waitHealth(timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await json('/health')
      if (h.status === 200 && h.body?.ok) return h.body
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('relay health timeout')
}

function stopRelay(child) {
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
    child.kill('SIGTERM')
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, 2000).unref()
  })
}

const first = startRelay()
const health1 = await waitHealth()
assert(health1.backend === 'node-file', 'backend node-file')
assert(health1.roomSettings === true, 'health roomSettings')
console.log('relay up', health1)

// Repair: empty create (legacy shape) + claim-host body restamps snapshot
const dropped = await json('/rooms', { method: 'POST', body: '{}' })
assert(dropped.status === 201, 'legacy-shaped create')
assert(dropped.body.data.room.buyInN === 0, 'legacy buyInN 0')
assert(dropped.body.data.room.maxSeats === 8, 'legacy maxSeats 8')
const dropCode = dropped.body.data.room.roomCode
const dropSeat = dropped.body.session.seatId
const stampedClaim = await json(`/rooms/${dropCode}/claim-host`, {
  method: 'POST',
  body: JSON.stringify({
    seatId: dropSeat,
    name: '桌主',
    buyInN: 100,
    maxSeats: 4,
    smallBlind: 1,
    bigBlind: 2,
  }),
})
assert(stampedClaim.status === 200, 'claim-host stamp')
assert(stampedClaim.body.data.room.buyInN === 100, 'claim stamps buyInN')
assert(stampedClaim.body.data.room.maxSeats === 4, 'claim stamps maxSeats')
assert(stampedClaim.body.data.room.smallBlind === 1, 'claim stamps sb')
assert(stampedClaim.body.data.room.bigBlind === 2, 'claim stamps bb')
const stampedPhase = await json(`/rooms/${dropCode}/phase`, {
  method: 'POST',
  body: JSON.stringify({
    phase: 'playing',
    buyInN: 100,
    maxSeats: 4,
    smallBlind: 1,
    bigBlind: 2,
  }),
})
assert(stampedPhase.body.data.room.buyInN === 100, 'phase keeps stamped buyInN')
assert(stampedPhase.body.data.room.maxSeats === 4, 'phase keeps stamped maxSeats')

const created = await json('/rooms', {
  method: 'POST',
  body: JSON.stringify({
    buyInN: 100,
    maxSeats: 4,
    smallBlind: 1,
    bigBlind: 2,
  }),
})
assert(created.status === 201, 'create')
const createdRoom = created.body.data.room
assert(createdRoom.buyInN === 100, 'create persist buyInN')
assert(createdRoom.maxSeats === 4, 'create persist maxSeats')
assert(createdRoom.smallBlind === 1 && createdRoom.bigBlind === 2, 'create persist blinds')
const code = createdRoom.roomCode
const hostSeat = created.body.session.seatId

await json(`/rooms/${code}/claim-host`, {
  method: 'POST',
  body: JSON.stringify({ seatId: hostSeat, name: '桌主A' }),
})
const joined = await json(`/rooms/${code}/join`, {
  method: 'POST',
  body: JSON.stringify({ name: '玩家B' }),
})
const guestSeat = joined.body.session.seatId
await json(`/rooms/${code}/phase`, {
  method: 'POST',
  body: JSON.stringify({ phase: 'playing' }),
})
await json(`/rooms/${code}/ops`, {
  method: 'POST',
  body: JSON.stringify({
    opId: 'op_persist_1',
    roomCode: code,
    fromSeatId: guestSeat,
    targetSeatId: guestSeat,
    type: '+denom',
    denom: 25,
  }),
})
await json(`/rooms/${code}/ops`, {
  method: 'POST',
  body: JSON.stringify({
    opId: 'op_persist_pot',
    roomCode: code,
    fromSeatId: guestSeat,
    targetSeatId: guestSeat,
    type: 'potIn',
    amount: 5,
  }),
})

const before = await json(`/rooms/${code}`)
assert(before.status === 200, 'GET before restart')
const beforeTable = before.body.data.table
assert(
  beforeTable.seats.find((s) => s.seatId === guestSeat)?.balance === 20,
  'balance 25-5=20 before restart',
)
assert(beforeTable.pot === 5, 'pot 5 before restart')
assert(before.body.data.room.phase === 'playing', 'phase playing')
assert(before.body.data.room.members.length === 2, '2 members')
assert(before.body.data.room.buyInN === 100, 'buyInN before restart')
assert(before.body.data.room.maxSeats === 4, 'maxSeats before restart')
assert(before.body.data.room.smallBlind === 1, 'sb before restart')
assert(before.body.data.room.bigBlind === 2, 'bb before restart')

await stopRelay(first.child)
console.log('relay stopped; snapshot at', path.join(DATA, 'rooms.json'))
assert(fs.existsSync(path.join(DATA, 'rooms.json')), 'rooms.json written')

const second = startRelay()
const health2 = await waitHealth()
assert(health2.rooms >= 1, 'restored room count')

const after = await json(`/rooms/${code}`)
assert(after.status === 200, 'GET same code after remount')
assert(after.body.data.room.phase === 'playing', 'phase restored')
assert(after.body.data.room.members.length === 2, 'members restored')
assert(after.body.data.room.buyInN === 100, 'buyInN restored')
assert(after.body.data.room.maxSeats === 4, 'maxSeats restored')
assert(after.body.data.room.smallBlind === 1, 'sb restored')
assert(after.body.data.room.bigBlind === 2, 'bb restored')
assert(after.body.data.table.pot === 5, 'pot restored')
assert(
  after.body.data.table.seats.find((s) => s.seatId === guestSeat)?.balance ===
    20,
  'balance restored',
)
assert(
  Array.isArray(after.body.data.table.ledger) &&
    after.body.data.table.ledger.length >= 2,
  'ledger restored',
)

await stopRelay(second.child)
fs.rmSync(DATA, { recursive: true, force: true })
console.log('OK relay persist — same snapshot after process remount', code)
