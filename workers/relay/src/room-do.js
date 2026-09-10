/**
 * One Durable Object = one roomCode.
 * Holds RoomState, applies host-authoritative ChipOps, fans out via WebSocket.
 */

import { createRoomStore, ACK_REASONS } from './roomLogic.js'

export class RoomDurableObject {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.store = createRoomStore()
    this.loaded = false
  }

  async ensureLoaded() {
    if (this.loaded) return
    const saved = await this.state.storage.get('room')
    if (saved) {
      this.store.set(saved)
    }
    this.loaded = true
  }

  async persist(data) {
    if (data) {
      await this.state.storage.put('room', data)
      // Auto-expire after 4h idle
      await this.state.storage.setAlarm(Date.now() + 4 * 60 * 60 * 1000)
    } else {
      await this.state.storage.delete('room')
    }
  }

  broadcast(data) {
    const msg = JSON.stringify({ type: 'room', data })
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(msg)
      } catch {
        /* ignore */
      }
    }
  }

  async alarm() {
    await this.state.storage.deleteAll()
    this.store = createRoomStore()
    this.broadcast(null)
  }

  async fetch(request) {
    await this.ensureLoaded()
    const url = new URL(request.url)

    // WebSocket upgrade (hibernation API)
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.state.acceptWebSocket(server)
      const code = (url.searchParams.get('room') || '').toUpperCase()
      const room = code ? this.store.get(code) : null
      server.send(JSON.stringify({ type: 'room', data: room }))
      return new Response(null, { status: 101, webSocket: client })
    }

    const path = url.pathname

    try {
      // Internal create with predetermined code
      if (request.method === 'POST' && path.endsWith('/__create')) {
        const body = await request.json().catch(() => ({}))
        const roomCode = (body.roomCode || '').toUpperCase()
        const seatId = body.seatId
        // Seed store with fixed code
        const now = Date.now()
        const sid = seatId || `seat_${Math.random().toString(36).slice(2, 10)}`
        const data = this.store.set({
          room: {
            roomCode,
            hostSeatId: sid,
            phase: 'lobby',
            maxSeats: 8,
            members: [],
          },
          table: {
            snapshotAt: now,
            denoms: [1, 5, 10, 25, 100],
            seats: [],
          },
        })
        await this.persist(data)
        this.broadcast(data)
        return Response.json(
          { session: { seatId: sid, name: '', roomCode }, data },
          { status: 201 },
        )
      }

      const roomMatch = path.match(/^\/rooms\/([A-Za-z0-9]+)(?:\/([a-z-]+))?$/)
      if (!roomMatch) {
        return Response.json({ error: 'not found' }, { status: 404 })
      }
      const code = roomMatch[1].toUpperCase()
      const action = roomMatch[2] || null

      if (request.method === 'GET' && !action) {
        const data = this.store.get(code)
        if (!data) {
          return Response.json({ error: ACK_REASONS.ROOM_MISSING }, { status: 404 })
        }
        return Response.json({ data })
      }

      if (request.method === 'DELETE' && !action) {
        this.store.del(code)
        await this.persist(null)
        this.broadcast(null)
        return Response.json({ ok: true })
      }

      if (request.method === 'POST' && action === 'claim-host') {
        const body = await request.json()
        const data = this.store.claimHostSeat(code, body.seatId, body.name)
        if (!data) {
          return Response.json({ error: ACK_REASONS.ROOM_MISSING }, { status: 400 })
        }
        await this.persist(data)
        this.broadcast(data)
        return Response.json({ data })
      }

      if (request.method === 'POST' && action === 'join') {
        const body = await request.json()
        const result = this.store.joinRoom(code, body.name)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json(result)
      }

      if (request.method === 'POST' && action === 'phase') {
        const body = await request.json()
        const data = this.store.setPhase(code, body.phase)
        if (!data) {
          return Response.json({ error: ACK_REASONS.ROOM_MISSING }, { status: 404 })
        }
        await this.persist(data)
        this.broadcast(data)
        return Response.json({ data })
      }

      if (request.method === 'POST' && action === 'member-connected') {
        const body = await request.json()
        const data = this.store.setMemberConnected(code, body.seatId, !!body.connected)
        if (!data) {
          return Response.json({ error: ACK_REASONS.ROOM_MISSING }, { status: 404 })
        }
        await this.persist(data)
        this.broadcast(data)
        return Response.json({ data })
      }

      if (request.method === 'POST' && action === 'resume') {
        const body = await request.json()
        const data = this.store.resumeAsHost(code, body.hostSeatId)
        if (!data) {
          return Response.json({ error: ACK_REASONS.NOT_HOST }, { status: 400 })
        }
        await this.persist(data)
        this.broadcast(data)
        return Response.json({ data })
      }

      if (request.method === 'POST' && action === 'pick-host') {
        const body = await request.json()
        const result = this.store.pickNewHost(code, body.newHostSeatId)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result)
        this.broadcast(result)
        return Response.json({ data: result })
      }

      if (request.method === 'POST' && action === 'fill-seats') {
        const result = this.store.fillSeatsToMax(code)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result)
        this.broadcast(result)
        return Response.json({ data: result })
      }

      if (request.method === 'POST' && action === 'restore') {
        const body = await request.json()
        const data = this.store.restoreSeat(code, body.seatId)
        if (!data) {
          return Response.json({ error: ACK_REASONS.ROOM_MISSING }, { status: 404 })
        }
        await this.persist(data)
        this.broadcast(data)
        return Response.json({ data })
      }

      if (request.method === 'POST' && action === 'ops') {
        const body = await request.json()
        const result = this.store.applyChipOp({ ...body, roomCode: code })
        if (result.data) {
          await this.persist(result.data)
          this.broadcast(result.data)
        }
        return Response.json(result)
      }

      return Response.json({ error: 'not found' }, { status: 404 })
    } catch (e) {
      console.error(e)
      return Response.json({ error: 'server error' }, { status: 500 })
    }
  }

  storeSizeSafe() {
    return []
  }

  webSocketClose() {
    /* hibernation: sessions tracked via state.getWebSockets() */
  }

  webSocketError() {
    /* ignore */
  }
}
