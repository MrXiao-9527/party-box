/**
 * Tab-close / WS drop: truth-dare 8s grace then offline + skip ghosts.
 * Same-seat reauth within grace reclaims drawer/answerer. Host skip works in grace.
 * Spawns a Node relay. Run: npm run test:ws-disconnect
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { DISCONNECT_GRACE_MS } from '../server/roomLogic.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 45331
const BASE = `http://127.0.0.1:${PORT}`
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-ws-off-'))
const GRACE_WAIT_MS = DISCONNECT_GRACE_MS + 2500

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
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
    await sleep(80)
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

async function waitMember(code, seatId, connected, timeoutMs = GRACE_WAIT_MS) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    const got = await json(`/rooms/${code}`)
    last = got.body?.data
    const m = last?.room?.members?.find((x) => x.seatId === seatId)
    if (!!m?.connected === connected) return last
    await sleep(40)
  }
  throw new Error(`seat ${seatId} connected!==${connected}`)
}

function member(data, seatId) {
  return data.room.members.find((m) => m.seatId === seatId)
}

async function snapshot(code) {
  const got = await json(`/rooms/${code}`)
  return got.body?.data
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
  await sleep(250)
  const duringGrace = await snapshot(code)
  assert(member(duringGrace, aSeat).connected === true, 'grace keeps 甲 connected')
  assert(duringGrace.room.party.drawerSeatId === aSeat, 'grace keeps drawer 甲')
  assert(duringGrace.room.party.phase === 'drawing', 'grace stays drawing')

  const skipped = await json(`/rooms/${code}/skip-drawer`, {
    method: 'POST',
    body: JSON.stringify({ fromSeatId: hostSeat, seatToken: hostTok }),
  })
  assert(skipped.status === 200, 'host skip-drawer during grace')
  assert(skipped.body.data.room.party.drawerSeatId === bSeat, 'skip → 乙 during grace')
  assert(member(skipped.body.data, aSeat).connected === true, 'skip does not force offline')

  const aWsSkipRe = openSeatWs(code, aSeat, aTok)
  await aWsSkipRe.ready
  const afterSkipRe = await waitMember(code, aSeat, true, 3000)
  assert(afterSkipRe.room.party.drawerSeatId === bSeat, 'reconnect after skip does not steal drawer')
  assert(member(afterSkipRe, aSeat).connected === true, '甲 reclaims connected after skip')

  const setA2 = await json(`/rooms/${code}/set-drawer`, {
    method: 'POST',
    body: JSON.stringify({
      fromSeatId: hostSeat,
      seatToken: hostTok,
      seatId: aSeat,
    }),
  })
  assert(setA2.status === 200 && setA2.body.data.room.party.drawerSeatId === aSeat, 'drawer 甲 again')

  await closeWs(aWsSkipRe.ws)
  await sleep(250)
  const grace2 = await snapshot(code)
  assert(grace2.room.party.drawerSeatId === aSeat, 'second drop still 甲 in grace')
  const aWsReclaim = openSeatWs(code, aSeat, aTok)
  await aWsReclaim.ready
  const reclaimed = await waitMember(code, aSeat, true, 3000)
  assert(reclaimed.room.party.drawerSeatId === aSeat, 'same-seat reauth reclaims drawer')
  assert(member(reclaimed, aSeat).connected === true, 'reclaim connected=true')

  await closeWs(aWsReclaim.ws)
  const afterExpire = await waitMember(code, aSeat, false)
  assert(member(afterExpire, aSeat).connected === false, 'grace expire → 甲 offline')
  assert(member(afterExpire, hostSeat).connected === true, 'host still online')
  assert(member(afterExpire, bSeat).connected === true, '乙 still online')
  assert(afterExpire.room.party.phase === 'drawing', 'drawing after 甲 expire')
  assert(afterExpire.room.party.drawerSeatId === bSeat, 'drawing auto-advances to 乙')
  assert(afterExpire.room.party.drawerSeatId !== aSeat, 'next-draw skips ghost 甲')

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

  const aWsAns = openSeatWs(code, aSeat, aTok)
  await aWsAns.ready
  await waitMember(code, aSeat, true, 3000)
  const setAns = await json(`/rooms/${code}/set-answerer`, {
    method: 'POST',
    body: JSON.stringify({
      fromSeatId: hostSeat,
      seatToken: hostTok,
      seatId: aSeat,
    }),
  })
  assert(setAns.status === 200, 'set-answerer 甲')
  assert(setAns.body.data.room.party.answererSeatId === aSeat, 'answerer 甲')
  const promptId = setAns.body.data.room.party.prompt.id

  await closeWs(aWsAns.ws)
  await sleep(250)
  const ansGrace = await snapshot(code)
  assert(member(ansGrace, aSeat).connected === true, 'answerer grace keeps connected')
  assert(ansGrace.room.party.answererSeatId === aSeat, 'answerer grace keeps pointer')
  assert(ansGrace.room.party.phase === 'answering', 'answerer grace keeps answering')
  assert(ansGrace.room.party.prompt.id === promptId, 'answerer grace keeps prompt')

  const aWsAnsRe = openSeatWs(code, aSeat, aTok)
  await aWsAnsRe.ready
  const ansReclaim = await waitMember(code, aSeat, true, 3000)
  assert(ansReclaim.room.party.answererSeatId === aSeat, 'same-seat reauth reclaims answerer')
  assert(ansReclaim.room.party.drawerSeatId === bSeat, 'answerer reclaim keeps drawer 乙')

  const aWs2 = aWsAnsRe
  const aWs3 = openSeatWs(code, aSeat, aTok)
  await aWs3.ready
  const reonline = await waitMember(code, aSeat, true, 3000)
  assert(member(reonline, aSeat).connected === true, 'WS reconnect → 甲 online')

  await closeWs(aWs2.ws)
  await sleep(200)
  const still = await snapshot(code)
  assert(
    member(still, aSeat).connected === true,
    'one of two sockets left → still online',
  )
  await closeWs(aWs3.ws)
  const bothGone = await waitMember(code, aSeat, false)
  assert(member(bothGone, aSeat).connected === false, 'last socket → offline after grace')
  assert(bothGone.room.party.answererSeatId === aSeat, 'answering keeps offline answerer')
  assert(bothGone.room.party.phase === 'answering', 'answering after answerer expire')
  assert(bothGone.room.party.prompt.id === promptId, 'answerer expire keeps prompt')

  const drawerBefore = bothGone.room.party.drawerSeatId
  assert(drawerBefore === bSeat, 'answering drawer still 乙')
  await closeWs(bWs.ws)
  await sleep(250)
  const bGrace = await snapshot(code)
  assert(member(bGrace, bSeat).connected === true, 'answering drawer grace keeps connected')
  assert(bGrace.room.party.drawerSeatId === bSeat, 'answering drawer grace keeps pointer')
  const ansOff = await waitMember(code, bSeat, false)
  assert(ansOff.room.party.phase === 'answering', 'answering drawer drop keeps phase')
  assert(ansOff.room.party.prompt.id === promptId, 'answering drawer drop keeps prompt')
  assert(ansOff.room.party.drawerSeatId === bSeat, 'answering keeps offline drawer')

  const ghost = await snapshot(code)
  assert(
    ghost.room.members.filter((m) => m.connected).every((m) => m.connected),
    'connected flags consistent',
  )
  const onlineIds = ghost.room.members.filter((m) => m.connected).map((m) => m.seatId)
  assert(onlineIds.includes(hostSeat), 'host online')
  assert(!onlineIds.includes(aSeat), '甲 not in onlineMembers')
  assert(!onlineIds.includes(bSeat), '乙 not in onlineMembers')

  const watcher = openSeatWs(code)
  await watcher.ready
  const beforeWatch = await snapshot(code)
  const hostOn = member(beforeWatch, hostSeat).connected
  await closeWs(watcher.ws)
  await sleep(150)
  const afterWatch = await snapshot(code)
  assert(
    member(afterWatch, hostSeat).connected === hostOn,
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
  await sleep(150)
  const paused = await snapshot(code)
  assert(paused.room.phase === 'paused', 'paused kept')
  assert(
    member(paused, hostSeat).connected === false,
    'paused host WS reconnect stays disconnected',
  )
  await closeWs(pausedHost.ws)

  const uc = await json('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'partyGame',
      gameId: 'undercover',
      maxSeats: 8,
    }),
  })
  assert(uc.status === 201, 'undercover create')
  const ucCode = uc.body.data.room.roomCode
  const ucHost = uc.body.session.seatId
  const ucTok = uc.body.session.seatToken
  await json(`/rooms/${ucCode}/claim-host`, {
    method: 'POST',
    body: JSON.stringify({ seatId: ucHost, name: '卧底桌主' }),
  })
  const ucGuest = await json(`/rooms/${ucCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ name: '卧底甲' }),
  })
  const ucGSeat = ucGuest.body.session.seatId
  const ucGTok = ucGuest.body.session.seatToken
  const ucHostWs = openSeatWs(ucCode, ucHost, ucTok)
  const ucGWs = openSeatWs(ucCode, ucGSeat, ucGTok)
  await Promise.all([ucHostWs.ready, ucGWs.ready])
  await closeWs(ucGWs.ws)
  const ucOff = await waitMember(ucCode, ucGSeat, false, 2000)
  assert(member(ucOff, ucGSeat).connected === false, 'undercover WS close still immediate')
  await closeWs(ucHostWs.ws)

  console.log('OK test-ws-disconnect', code)
} finally {
  await stopRelay(relay)
  fs.rmSync(DATA, { recursive: true, force: true })
}
