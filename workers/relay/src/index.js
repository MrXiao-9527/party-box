/**
 * Cloudflare Worker entry — routes /rooms/* and /ws to RoomDurableObject.
 * Deploy: cd workers/relay && npx wrangler deploy
 */

export { RoomDurableObject } from './room-do.js'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }), request)
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return cors(
        Response.json({ ok: true, backend: 'cloudflare-do', roomSettings: true }),
        request,
      )
    }

    // /rooms → create (no DO yet) handled here then stubs into DO
    if (request.method === 'POST' && url.pathname === '/rooms') {
      const body = await request.json().catch(() => ({}))
      const code = generateCode()
      const id = env.ROOM.idFromName(code)
      const stub = env.ROOM.get(id)
      const res = await stub.fetch(
        new Request(`https://do/rooms/${code}/__create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, roomCode: code }),
        }),
      )
      return cors(res, request)
    }

    const roomMatch = url.pathname.match(
      /^\/rooms\/([A-Za-z0-9]+)(?:\/([a-z-]+))?$/,
    )
    if (roomMatch) {
      const code = roomMatch[1].toUpperCase()
      const id = env.ROOM.idFromName(code)
      const stub = env.ROOM.get(id)
      const res = await stub.fetch(request)
      return cors(res, request)
    }

    if (url.pathname === '/ws') {
      const code = (url.searchParams.get('room') || '').toUpperCase()
      if (!code || !/^[A-Z0-9]+$/.test(code)) {
        return cors(Response.json({ error: 'invalid room' }, { status: 400 }), request)
      }
      const id = env.ROOM.idFromName(code)
      const stub = env.ROOM.get(id)
      return stub.fetch(request)
    }

    return cors(Response.json({ error: 'not found' }, { status: 404 }), request)
  },
}

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return code
}

function cors(res, request) {
  const origin = request.headers.get('Origin') || '*'
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin)
  headers.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type')
  headers.set('Access-Control-Max-Age', '86400')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
