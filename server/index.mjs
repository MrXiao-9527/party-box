/**
 * party-box shared room relay — HTTP + WebSocket.
 *
 * Env:
 *   PORT                 listen port (default 45322)
 *   CORS_ORIGIN          comma-separated allowed origins (* = all, default *)
 *   ROOM_TTL_MS          idle room TTL (optional; logic default 4h)
 *   PARTY_BOX_DATA_DIR   durable snapshot dir (default: ./data)
 *
 * Run: node server/index.mjs
 *
 * Rooms are persisted to disk so process remount restores the same snapshot.
 * Production preference: Cloudflare Worker + Durable Object (workers/relay).
 */

import http from 'node:http'
import { WebSocketServer } from 'ws'
import { createRoomStore, ACK_REASONS } from './roomLogic.mjs'
import { dataDir, loadSnapshot, saveSnapshot, snapshotPath } from './persist.mjs'

const PORT = Number(process.env.PORT || 45322)
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'

const store = createRoomStore()
const hydrated = store.importAll(loadSnapshot())
console.log(
  `[party-box relay] persist=${snapshotPath()} restored=${hydrated} rooms`,
)

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const subscribers = new Map()

let persistTimer = 0
function schedulePersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = 0
    try {
      saveSnapshot(store.exportAll())
    } catch (e) {
      console.error('[relay persist] save failed', e)
    }
  }, 50)
}

function persistNow() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = 0
  }
  try {
    saveSnapshot(store.exportAll())
  } catch (e) {
    console.error('[relay persist] save failed', e)
  }
}

function allowOrigin(origin) {
  if (CORS_ORIGIN === '*') return '*'
  const allowed = CORS_ORIGIN.split(',').map((s) => s.trim())
  if (origin && allowed.includes(origin)) return origin
  return allowed[0] || '*'
}

function setCors(req, res) {
  const origin = allowOrigin(req.headers.origin)
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400')
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(raw),
  })
  res.end(raw)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function broadcast(roomCode, data) {
  const key = roomCode.toUpperCase()
  const set = subscribers.get(key)
  if (!set || set.size === 0) return
  const msg = JSON.stringify({ type: 'room', data })
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function afterMutation(data) {
  if (!data) return
  schedulePersist()
  broadcast(data.room.roomCode, data)
}

async function handle(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const path = url.pathname

  try {
    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, {
        ok: true,
        backend: 'node-file',
        rooms: store.size(),
        persistDir: dataDir(),
      })
      return
    }

    if (req.method === 'POST' && path === '/rooms') {
      const body = await readBody(req)
      const result = store.createEmptyHostRoom(body)
      if ('error' in result) {
        sendJson(res, 400, { error: result.error })
        return
      }
      afterMutation(result.data)
      sendJson(res, 201, result)
      return
    }

    const roomMatch = path.match(/^\/rooms\/([A-Za-z0-9]+)(?:\/([a-z-]+))?$/)
    if (roomMatch) {
      const code = roomMatch[1].toUpperCase()
      const action = roomMatch[2] || null

      if (req.method === 'GET' && !action) {
        const data = store.get(code)
        if (!data) {
          sendJson(res, 404, { error: ACK_REASONS.ROOM_MISSING })
          return
        }
        schedulePersist()
        sendJson(res, 200, { data })
        return
      }

      if (req.method === 'DELETE' && !action) {
        store.del(code)
        schedulePersist()
        broadcast(code, null)
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && action === 'claim-host') {
        const body = await readBody(req)
        const data = store.claimHostSeat(code, body.seatId, body.name)
        if (!data) {
          sendJson(res, 400, { error: ACK_REASONS.ROOM_MISSING })
          return
        }
        afterMutation(data)
        sendJson(res, 200, { data })
        return
      }

      if (req.method === 'POST' && action === 'join') {
        const body = await readBody(req)
        const result = store.joinRoom(code, body.name)
        if ('error' in result) {
          sendJson(res, 400, result)
          return
        }
        afterMutation(result.data)
        sendJson(res, 200, result)
        return
      }

      if (req.method === 'POST' && action === 'phase') {
        const body = await readBody(req)
        const data = store.setPhase(code, body.phase)
        if (!data) {
          sendJson(res, 404, { error: ACK_REASONS.ROOM_MISSING })
          return
        }
        afterMutation(data)
        sendJson(res, 200, { data })
        return
      }

      if (req.method === 'POST' && action === 'member-connected') {
        const body = await readBody(req)
        const data = store.setMemberConnected(code, body.seatId, !!body.connected)
        if (!data) {
          sendJson(res, 404, { error: ACK_REASONS.ROOM_MISSING })
          return
        }
        afterMutation(data)
        sendJson(res, 200, { data })
        return
      }

      if (req.method === 'POST' && action === 'resume') {
        const body = await readBody(req)
        const data = store.resumeAsHost(code, body.hostSeatId)
        if (!data) {
          sendJson(res, 400, { error: ACK_REASONS.NOT_HOST })
          return
        }
        afterMutation(data)
        sendJson(res, 200, { data })
        return
      }

      if (req.method === 'POST' && action === 'pick-host') {
        const body = await readBody(req)
        const result = store.pickNewHost(code, body.newHostSeatId)
        if ('error' in result) {
          sendJson(res, 400, result)
          return
        }
        afterMutation(result)
        sendJson(res, 200, { data: result })
        return
      }

      if (req.method === 'POST' && action === 'fill-seats') {
        const result = store.fillSeatsToMax(code)
        if ('error' in result) {
          sendJson(res, 400, result)
          return
        }
        afterMutation(result)
        sendJson(res, 200, { data: result })
        return
      }

      if (req.method === 'POST' && action === 'restore') {
        const body = await readBody(req)
        const data = store.restoreSeat(code, body.seatId)
        if (!data) {
          sendJson(res, 404, { error: ACK_REASONS.ROOM_MISSING })
          return
        }
        afterMutation(data)
        sendJson(res, 200, { data })
        return
      }

      if (req.method === 'POST' && action === 'ops') {
        const body = await readBody(req)
        const result = store.applyChipOp({ ...body, roomCode: code })
        if (result.data) afterMutation(result.data)
        sendJson(res, 200, result)
        return
      }
    }

    sendJson(res, 404, { error: 'not found' })
  } catch (e) {
    console.error('[relay]', e)
    sendJson(res, 500, { error: 'server error' })
  }
}

const server = http.createServer((req, res) => {
  void handle(req, res)
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`)
  const roomCode = (url.searchParams.get('room') || '').toUpperCase()
  if (!roomCode || !/^[A-Z0-9]+$/.test(roomCode)) {
    ws.close(1008, 'invalid room')
    return
  }

  let set = subscribers.get(roomCode)
  if (!set) {
    set = new Set()
    subscribers.set(roomCode, set)
  }
  set.add(ws)

  const data = store.get(roomCode)
  ws.send(JSON.stringify({ type: 'room', data }))

  ws.on('close', () => {
    set.delete(ws)
    if (set.size === 0) subscribers.delete(roomCode)
  })
})

function shutdown() {
  persistNow()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('beforeExit', () => {
  persistNow()
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[party-box relay] http://0.0.0.0:${PORT}  ws://0.0.0.0:${PORT}/ws  data=${dataDir()}`,
  )
})
