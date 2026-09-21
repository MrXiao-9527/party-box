/**
 * One Durable Object = one roomCode.
 * Holds RoomState, applies host-authoritative ChipOps, fans out via WebSocket.
 */

import {
  createRoomStore,
  ACK_REASONS,
  parseRoomCreate,
  emptyPersistedRoom,
  publicPersisted,
} from './roomLogic.js'

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

  sendPrivate(ws, data) {
    let att = {}
    try {
      att = ws.deserializeAttachment() || {}
    } catch {
      att = {}
    }
    if (!att.seatId || !data?.seatTokens || data.seatTokens[att.seatId] !== att.seatToken) {
      return
    }
    try {
      ws.send(
        JSON.stringify({
          type: 'seatPrivate',
          private: data.partyPrivates?.[att.seatId] ?? null,
        }),
      )
    } catch {
      /* ignore */
    }
  }

  broadcast(data) {
    const msg = JSON.stringify({ type: 'room', data: publicPersisted(data) })
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(msg)
        this.sendPrivate(ws, data)
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
      const seatId = url.searchParams.get('seatId') || ''
      const seatToken = url.searchParams.get('seatToken') || ''
      if (seatId && seatToken && room?.seatTokens?.[seatId] === seatToken) {
        server.serializeAttachment({ seatId, seatToken })
      }
      server.send(JSON.stringify({ type: 'room', data: publicPersisted(room) }))
      this.sendPrivate(server, room)
      return new Response(null, { status: 101, webSocket: client })
    }

    const path = url.pathname

    try {
      // Internal create with predetermined code
      if (request.method === 'POST' && path.endsWith('/__create')) {
        const body = await request.json().catch(() => ({}))
        const roomCode = (body.roomCode || '').toUpperCase()
        const parsed = parseRoomCreate(body)
        if (parsed.error) {
          return Response.json({ error: parsed.error }, { status: 400 })
        }
        const sid = parsed.seatId || `seat_${Math.random().toString(36).slice(2, 10)}`
        const seatToken = `tok_${Math.random().toString(36).slice(2, 10)}`
        const data = this.store.set({
          ...emptyPersistedRoom(roomCode, { ...parsed, seatId: sid }),
          seatTokens: { [sid]: seatToken },
          partyPrivates: {},
        })
        await this.persist(data)
        this.broadcast(data)
        return Response.json(
          {
            session: { seatId: sid, name: '', roomCode, seatToken },
            data: publicPersisted(data),
          },
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
        return Response.json({ data: publicPersisted(data) })
      }

      if (request.method === 'DELETE' && !action) {
        this.store.del(code)
        await this.persist(null)
        this.broadcast(null)
        return Response.json({ ok: true })
      }

      if (request.method === 'POST' && action === 'claim-host') {
        const body = await request.json()
        const data = this.store.claimHostSeat(code, body.seatId, body.name, body)
        if (!data) {
          return Response.json({ error: ACK_REASONS.ROOM_MISSING }, { status: 400 })
        }
        await this.persist(data)
        this.broadcast(data)
        return Response.json({ data: publicPersisted(data) })
      }

      if (request.method === 'POST' && action === 'join') {
        const body = await request.json()
        const result = this.store.joinRoom(code, body.name)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({
          session: result.session,
          data: publicPersisted(result.data),
        })
      }

      if (request.method === 'POST' && action === 'phase') {
        const body = await request.json()
        const data = this.store.setPhase(code, body.phase, body)
        if (!data) {
          return Response.json({ error: ACK_REASONS.ROOM_MISSING }, { status: 404 })
        }
        await this.persist(data)
        this.broadcast(data)
        return Response.json({ data: publicPersisted(data) })
      }

      if (request.method === 'POST' && action === 'member-connected') {
        const body = await request.json()
        const data = this.store.setMemberConnected(code, body.seatId, !!body.connected)
        if (!data) {
          return Response.json({ error: ACK_REASONS.ROOM_MISSING }, { status: 404 })
        }
        await this.persist(data)
        this.broadcast(data)
        return Response.json({ data: publicPersisted(data) })
      }

      if (request.method === 'POST' && action === 'resume') {
        const body = await request.json()
        const data = this.store.resumeAsHost(code, body.hostSeatId)
        if (!data) {
          return Response.json({ error: ACK_REASONS.NOT_HOST }, { status: 400 })
        }
        await this.persist(data)
        this.broadcast(data)
        return Response.json({ data: publicPersisted(data) })
      }

      if (request.method === 'POST' && action === 'pick-host') {
        const body = await request.json()
        const result = this.store.pickNewHost(
          code,
          body.newHostSeatId,
          body.fromSeatId,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result)
        this.broadcast(result)
        return Response.json({ data: publicPersisted(result) })
      }

      if (request.method === 'POST' && action === 'fill-seats') {
        const result = this.store.fillSeatsToMax(code)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result)
        this.broadcast(result)
        return Response.json({ data: publicPersisted(result) })
      }

      if (request.method === 'POST' && action === 'restore') {
        const body = await request.json()
        const data = this.store.restoreSeat(code, body.seatId)
        if (!data) {
          return Response.json({ error: ACK_REASONS.ROOM_MISSING }, { status: 404 })
        }
        await this.persist(data)
        this.broadcast(data)
        return Response.json({ data: publicPersisted(data) })
      }

      if (request.method === 'POST' && action === 'start-undercover') {
        const body = await request.json()
        const result = this.store.startUndercover(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({
          data: publicPersisted(result.data),
          private: result.private,
        })
      }

      if (request.method === 'POST' && action === 'reveal') {
        const body = await request.json()
        const result = this.store.revealUndercover(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'next-round') {
        const body = await request.json()
        const result = this.store.nextRoundUndercover(
          code,
          body.fromSeatId,
          body.seatToken,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({
          data: publicPersisted(result.data),
          private: result.private,
        })
      }

      if (request.method === 'POST' && action === 'seat-private') {
        const body = await request.json()
        const result = this.store.getSeatPrivate(code, body.seatId, body.seatToken)
        if ('error' in result) {
          const status = result.error === ACK_REASONS.ROOM_MISSING ? 404 : 400
          return Response.json(result, { status })
        }
        return Response.json(result)
      }

      if (request.method === 'POST' && action === 'draw') {
        const body = await request.json()
        const result = this.store.drawPrompt(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'redraw') {
        const body = await request.json()
        const result = this.store.redrawPrompt(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'ops') {
        const body = await request.json()
        const result = this.store.applyChipOp({ ...body, roomCode: code })
        if (result.data) {
          await this.persist(result.data)
          this.broadcast(result.data)
        }
        return Response.json({
          ack: result.ack,
          data: publicPersisted(result.data),
        })
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
