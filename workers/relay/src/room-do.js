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
  partyStubOf,
  DISCONNECT_GRACE_MS,
  parsePartyGameId,
} from './roomLogic.js'

export class RoomDurableObject {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.store = createRoomStore()
    this.loaded = false
    /** @type {Map<string, number>} */
    this.disconnectGraceGen = new Map()
    /** room:seat → timeout */
    this.missCardGrace = new Map()
  }

  clearMissCardGrace(roomCode, seatId) {
    const key = this.graceKey(roomCode, seatId)
    const t = this.missCardGrace.get(key)
    if (t) {
      clearTimeout(t)
      this.missCardGrace.delete(key)
    }
  }

  scheduleMissCardGrace(roomCode, seatId) {
    if (!roomCode || !seatId) return
    const room = this.store.get(roomCode)
    if (parsePartyGameId(room?.room?.party?.gameId) !== 'miss-card') return
    this.clearMissCardGrace(roomCode, seatId)
    const key = this.graceKey(roomCode, seatId)
    const t = setTimeout(() => {
      this.missCardGrace.delete(key)
      void this.flushMissCardSkip(roomCode, seatId)
    }, DISCONNECT_GRACE_MS)
    this.missCardGrace.set(key, t)
  }

  async flushMissCardSkip(roomCode, seatId) {
    await this.ensureLoaded()
    const next = this.store.skipMissCardIfOffline(roomCode, seatId)
    if (next) {
      await this.persist(next)
      this.broadcast(next)
    }
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
      let room = code ? this.store.get(code) : null
      const seatId = url.searchParams.get('seatId') || ''
      const seatToken = url.searchParams.get('seatToken') || ''
      if (seatId && seatToken && room?.seatTokens?.[seatId] === seatToken) {
        server.serializeAttachment({ seatId, seatToken, roomCode: code })
        room = (await this.onlineFromSocket(code, seatId)) || room
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
        this.clearRoomDisconnectGrace(code)
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
        if (body.seatId) this.clearDisconnectGrace(code, body.seatId)
        const data = this.store.setMemberConnected(code, body.seatId, !!body.connected)
        if (!data) {
          return Response.json({ error: ACK_REASONS.ROOM_MISSING }, { status: 404 })
        }
        if (body.connected) this.clearMissCardGrace(code, body.seatId)
        else this.scheduleMissCardGrace(code, body.seatId)
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
        this.clearMissCardGrace(code, body.seatId)
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

      if (request.method === 'POST' && action === 'speak-done') {
        const body = await request.json()
        const result = this.store.speakDoneUndercover(
          code,
          body.fromSeatId,
          body.seatToken,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'cast-vote') {
        const body = await request.json()
        const result = this.store.castVoteUndercover(
          code,
          body.fromSeatId,
          body.seatToken,
          body.targetSeatId,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'tweak-board') {
        const body = await request.json()
        const result = this.store.tweakWerewolfBoard(
          code,
          body.fromSeatId,
          body.seatToken,
          body.board,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'reset-board') {
        const body = await request.json()
        const result = this.store.resetWerewolfBoard(
          code,
          body.fromSeatId,
          body.seatToken,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'deal') {
        const body = await request.json()
        const result = this.store.dealWerewolf(code, body.fromSeatId, body.seatToken)
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

      if (request.method === 'POST' && action === 'redeal') {
        const body = await request.json()
        const result = this.store.redealWerewolf(
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

      if (request.method === 'POST' && action === 'set-stage') {
        const body = await request.json()
        const result = this.store.setWerewolfStage(
          code,
          body.fromSeatId,
          body.seatToken,
          body.stage,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
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
        const result = this.store.drawPrompt(
          code,
          body.fromSeatId,
          body.seatToken,
          body.mode,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'redraw') {
        const body = await request.json()
        const result = this.store.redrawPrompt(
          code,
          body.fromSeatId,
          body.seatToken,
          body.type,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'skip-drawer') {
        const body = await request.json()
        const result = this.store.skipDrawer(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        this.clearMissCardGrace(code, body.fromSeatId)
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'set-drawer') {
        const body = await request.json()
        const result = this.store.setDrawer(
          code,
          body.fromSeatId,
          body.seatToken,
          body.seatId,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'set-answerer') {
        const body = await request.json()
        const result = this.store.setAnswerer(
          code,
          body.fromSeatId,
          body.seatToken,
          body.seatId,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'advance') {
        const body = await request.json()
        const result = this.store.advancePrompt(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'start-miss-card') {
        const body = await request.json()
        const result = this.store.startMissCard(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'draw-card') {
        const body = await request.json()
        const result = this.store.drawCard(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'pick-target') {
        const body = await request.json()
        const result = this.store.pickTarget(
          code,
          body.fromSeatId,
          body.seatToken,
          body.targetSeatId,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'complete-turn') {
        const body = await request.json()
        const result = this.store.completeTurn(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'set-k-cups') {
        const body = await request.json()
        const result = this.store.setMissKCups(
          code,
          body.fromSeatId,
          body.seatToken,
          body.cups,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'apply-k') {
        const body = await request.json()
        const result = this.store.applyMissK(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'use-toilet') {
        const body = await request.json()
        const result = this.store.spendMissToilet(code, body.fromSeatId, body.seatToken)
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'reshuffle') {
        const body = await request.json()
        const result = this.store.reshuffleMissCard(
          code,
          body.fromSeatId,
          body.seatToken,
        )
        if ('error' in result) {
          return Response.json(result, { status: 400 })
        }
        await this.persist(result.data)
        this.broadcast(result.data)
        return Response.json({ data: publicPersisted(result.data) })
      }

      if (request.method === 'POST' && action === 'end-game') {
        const body = await request.json()
        const result = this.store.endMissCard(code, body.fromSeatId, body.seatToken)
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

  seatAttachment(ws) {
    try {
      return ws.deserializeAttachment() || {}
    } catch {
      return {}
    }
  }

  seatHasOtherSocket(seatId, exceptWs) {
    if (!seatId) return false
    for (const ws of this.state.getWebSockets()) {
      if (exceptWs && ws === exceptWs) continue
      if (this.seatAttachment(ws).seatId === seatId) return true
    }
    return false
  }

  async persistPresence(data) {
    if (!data) return data
    await this.persist(data)
    this.broadcast(data)
    return data
  }

  /** Rejoin after WS drop. restoreSeat keeps paused host disconnected. */
  async onlineFromSocket(code, seatId) {
    this.clearDisconnectGrace(code, seatId)
    const room = this.store.get(code)
    const member = room?.room.members.find((m) => m.seatId === seatId)
    if (!member || member.connected) return room
    this.clearMissCardGrace(code, seatId)
    return this.persistPresence(this.store.restoreSeat(code, seatId))
  }

  graceKey(code, seatId) {
    return `${String(code || '').toUpperCase()}:${seatId}`
  }

  clearDisconnectGrace(code, seatId) {
    if (!code || !seatId) return
    const key = this.graceKey(code, seatId)
    this.disconnectGraceGen.set(key, (this.disconnectGraceGen.get(key) || 0) + 1)
  }

  clearRoomDisconnectGrace(code) {
    const prefix = `${String(code || '').toUpperCase()}:`
    for (const key of [...this.disconnectGraceGen.keys()]) {
      if (!key.startsWith(prefix)) continue
      this.disconnectGraceGen.set(key, (this.disconnectGraceGen.get(key) || 0) + 1)
    }
  }

  scheduleTruthDareDisconnectGrace(code, seatId) {
    const key = this.graceKey(code, seatId)
    const gen = (this.disconnectGraceGen.get(key) || 0) + 1
    this.disconnectGraceGen.set(key, gen)
    const run = this.flushDisconnectGrace(code, seatId, gen)
    if (typeof this.state.waitUntil === 'function') {
      this.state.waitUntil(run)
    }
  }

  async flushDisconnectGrace(code, seatId, gen) {
    await new Promise((r) => setTimeout(r, DISCONNECT_GRACE_MS))
    if (this.disconnectGraceGen.get(this.graceKey(code, seatId)) !== gen) return
    await this.offlineIfUnsocketedNow(code, seatId)
  }

  async offlineIfUnsocketedNow(code, seatId) {
    if (!code || !seatId) return
    if (this.seatHasOtherSocket(seatId)) return
    const room = this.store.get(code)
    const member = room?.room.members.find((m) => m.seatId === seatId)
    if (!member?.connected) return
    await this.persistPresence(this.store.setMemberConnected(code, seatId, false))
  }

  async offlineIfUnsocketed(code, seatId, exceptWs) {
    if (!code || !seatId) return
    if (this.seatHasOtherSocket(seatId, exceptWs)) return
    const room = this.store.get(code)
    const member = room?.room.members.find((m) => m.seatId === seatId)
    if (!member?.connected) return
    const gameId = partyStubOf(room.room.party).gameId
    if (gameId === 'truthDare' || gameId === 'werewolf-deal') {
      this.scheduleTruthDareDisconnectGrace(code, seatId)
      return
    }
    await this.persistPresence(this.store.setMemberConnected(code, seatId, false))
    this.scheduleMissCardGrace(code, seatId)
  }

  // Tab close / navigate sends WS close (browser 1001). That is the
  // presence signal — pagehide HTTP is best-effort and often cancelled.
  // Truth-dare waits DISCONNECT_GRACE_MS so a refresh can reclaim pointers.
  async webSocketClose(ws) {
    await this.ensureLoaded()
    const att = this.seatAttachment(ws)
    await this.offlineIfUnsocketed(att.roomCode, att.seatId, ws)
  }

  async webSocketError(ws) {
    try {
      ws.close(1011, 'error')
    } catch {
      /* ignore */
    }
    await this.webSocketClose(ws)
  }
}
