/**
 * Tab-close / WS drop must mark the seat offline and skip ghost pointers.
 * Spawns a Node relay. Run: npm run test:ws-disconnect
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 45331
const BASE = `http://127.0.0.1:${PORT}`
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-ws-off-'))

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
  return child
}

async function waitHealth(timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await json('/health')
      if (h.status === 200 && h.body?.ok) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 80))
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

function openSeatWs(code, seatId, seatToken) {
  const q = new URLSearchParams({ room: code })
  if (seatId) q.set('seatId', seatId)
  if (seatToken) q.set('seatToken', seatToken)
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?${q}`)
  const messages = []
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws open timeout')), 5000)
    ws.once('open', () => {
      clearTimeout(t)
      resolve()
    })
    ws.once('error', (err) => {
      clearTimeout(t)
      reject(err)
    })
  })
  ws.on('message', (raw) => {
    try {
      messages.push(JSON.parse(String(raw)))
    } catch {
      /* ignore */
    }
  })
  return { ws, messages, ready }
}

function closeWs(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }
    ws.once('close', () => resolve())
    ws.close()
    setTimeout(resolve, 1500).unref()
  })
}

async function waitMember(code, seatId, connected, timeoutMs = 4000) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    const got = await json(`/rooms/${code}`)
    last = got.body?.data
    const m = last?.room?.members?.find((x) => x.seatId === seatId)
    if (!!m?.connected === connected) return last
    await new Promise((r) => setTimeout(r, 40))
  }
  throw new Error(`seat ${seatId} connected!==${connected}`)
}

function member(data, seatId) {
  return data.room.members.find((m) => m.seatId === seatId)
}

const relay = startRelay()
try {
  await waitHealth()

  const created = await json('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'partyGame',
      gameId: 'truthDare',
      maxSeats: 8,
    }),
  })
  assert(created.status === 201, 'create')
  const code = created.body.data.room.roomCode
  const hostSeat = created.body.session.seatId
  const hostTok = created.body.session.seatToken

  await json(`/rooms/${code}/claim-host`, {
    method: 'POST',
    body: JSON.stringify({ seatId: hostSeat, name: '桌主' }),
  })
  const a = await json(`/rooms/${code}/join`, {
    method: 'POST',
    body: JSON.stringify({ name: '甲' }),
  })
  const b = await json(`/rooms/${code}/join`, {
    method: 'POST',
    body: JSON.stringify({ name: '乙' }),
  })
  assert(a.status === 200 && b.status === 200, 'join A/B')
  const aSeat = a.body.session.seatId
  const aTok = a.body.session.seatToken
  const bSeat = b.body.session.seatId
  const bTok = b.body.session.seatToken

  await json(`/rooms/${code}/phase`, {
    method: 'POST',
    body: JSON.stringify({ phase: 'playing' }),
  })

  const hostWs = openSeatWs(code, hostSeat, hostTok)
  const aWs = openSeatWs(code, aSeat, aTok)
  const bWs = openSeatWs(code, bSeat, bTok)
  await Promise.all([hostWs.ready, aWs.ready, bWs.ready])

  const setA = await json(`/rooms/${code}/set-drawer`, {
    method: 'POST',
    body: JSON.stringify({
      fromSeatId: hostSeat,
      seatToken: hostTok,
      seatId: aSeat,
    }),
  })
  assert(setA.status === 200, 'set-drawer 甲')
  assert(setA.body.data.room.party.drawerSeatId === aSeat, 'drawer 甲')
  assert(setA.body.data.room.party.phase === 'drawing', 'drawing')

  await closeWs(aWs.ws)
  const afterClose = await waitMember(code, aSeat, false)
  assert(member(afterClose, aSeat).connected === false, 'tab-close → 甲 offline')
  assert(member(afterClose, hostSeat).connected === true, 'host still online')
  assert(member(afterClose, bSeat).connected === true, '乙 still online')
  assert(afterClose.room.party.phase === 'drawing', 'drawing after 甲 drop')
  assert(afterClose.room.party.drawerSeatId === bSeat, 'drawing auto-advances to 乙')
  assert(afterClose.room.party.drawerSeatId !== aSeat, 'next-draw skips ghost 甲')

  const draw = await json(`/rooms/${code}/draw`, {
    method: 'POST',
    body: JSON.stringify({
      fromSeatId: bSeat,
      seatToken: bTok,
      mode: 'direct',
    }),
  })
  assert(draw.status === 200, '乙 draw')
  assert(draw.body.data.room.party.phase === 'answering', 'answering')
  assert(
    draw.body.data.room.party.answererSeatId === hostSeat,
    'default answerer skips ghost 甲 → 桌主',
  )
  assert(draw.body.data.room.party.answererSeatId !== aSeat, 'answerer not ghost')

  const aWs2 = openSeatWs(code, aSeat, aTok)
  const aWs3 = openSeatWs(code, aSeat, aTok)
  await Promise.all([aWs2.ready, aWs3.ready])
  const reonline = await waitMember(code, aSeat, true)
  assert(member(reonline, aSeat).connected === true, 'WS reconnect → 甲 online')

  await closeWs(aWs2.ws)
  await new Promise((r) => setTimeout(r, 200))
  const still = await json(`/rooms/${code}`)
  assert(
    member(still.body.data, aSeat).connected === true,
    'one of two sockets left → still online',
  )
  await closeWs(aWs3.ws)
  const bothGone = await waitMember(code, aSeat, false)
  assert(member(bothGone, aSeat).connected === false, 'last socket → offline')

  const promptId = bothGone.room.party.prompt.id
  const drawerBefore = bothGone.room.party.drawerSeatId
  assert(drawerBefore === bSeat, 'answering drawer still 乙')
  await closeWs(bWs.ws)
  const ansOff = await waitMember(code, bSeat, false)
  assert(ansOff.room.party.phase === 'answering', 'answering drawer drop keeps phase')
  assert(ansOff.room.party.prompt.id === promptId, 'answering drawer drop keeps prompt')
  assert(ansOff.room.party.drawerSeatId === bSeat, 'answering keeps offline drawer')

  const ghost = await json(`/rooms/${code}`)
  assert(
    ghost.body.data.room.members.filter((m) => m.connected).every((m) => m.connected),
    'connected flags consistent',
  )
  const onlineIds = ghost.body.data.room.members
    .filter((m) => m.connected)
    .map((m) => m.seatId)
  assert(onlineIds.includes(hostSeat), 'host online')
  assert(!onlineIds.includes(aSeat), '甲 not in onlineMembers')
  assert(!onlineIds.includes(bSeat), '乙 not in onlineMembers')

  const watcher = openSeatWs(code)
  await watcher.ready
  const beforeWatch = await json(`/rooms/${code}`)
  const hostOn = member(beforeWatch.body.data, hostSeat).connected
  await closeWs(watcher.ws)
  await new Promise((r) => setTimeout(r, 150))
  const afterWatch = await json(`/rooms/${code}`)
  assert(
    member(afterWatch.body.data, hostSeat).connected === hostOn,
    'unauthed WS close does not flip seats',
  )

  await json(`/rooms/${code}/member-connected`, {
    method: 'POST',
    body: JSON.stringify({ seatId: hostSeat, connected: false }),
  })
  await json(`/rooms/${code}/phase`, {
    method: 'POST',
    body: JSON.stringify({ phase: 'paused' }),
  })
  await closeWs(hostWs.ws)
  const pausedHost = openSeatWs(code, hostSeat, hostTok)
  await pausedHost.ready
  await new Promise((r) => setTimeout(r, 150))
  const paused = await json(`/rooms/${code}`)
  assert(paused.body.data.room.phase === 'paused', 'paused kept')
  assert(
    member(paused.body.data, hostSeat).connected === false,
    'paused host WS reconnect stays disconnected',
  )
  await closeWs(pausedHost.ws)

  console.log('OK test-ws-disconnect', code)
} finally {
  await stopRelay(relay)
  fs.rmSync(DATA, { recursive: true, force: true })
}
