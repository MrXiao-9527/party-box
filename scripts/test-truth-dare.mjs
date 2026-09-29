/**
 * Slice A+B (full): truthDare turn machine + wheel ritual + ≥80 bank.
 * Draw privilege, set-drawer (drawing only), set-answerer, advance, late-join.
 * Wheel/direct write the same snapshot; animation is not room state.
 * Run: npm run test:truth-dare
 */
import {
  createRoomStore,
  ACK_REASONS,
  publicPersisted,
  partyStubOf,
  PROMPT_RECENT_K,
} from '../server/roomLogic.mjs'
import {
  PROMPTS,
  allPrompts,
  pickPrompt,
  RECENT_K,
  HISTORY_N,
  nextDrawerSeatId,
  nextAnswererSeatId,
  ensureTruthDareTurn,
  appendPromptHistory,
} from '../server/truthDare.mjs'
import { publicPayloadLeaks } from '../server/undercover.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function openTruthDare(store, { maxSeats = 8, host = '桌主' } = {}) {
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats,
    gameId: 'truthDare',
  })
  assert(!('error' in created), 'create')
  const code = created.data.room.roomCode
  const claimed = store.claimHostSeat(code, created.session.seatId, host)
  assert(claimed, 'claim')
  return {
    code,
    hostSeat: created.session.seatId,
    hostTok: created.session.seatToken,
  }
}

function partyOf(store, code) {
  return partyStubOf(store.get(code).room.party)
}

{
  const pool = allPrompts(PROMPTS)
  assert(pool.length >= 80, `bank size ${pool.length}`)
  assert(RECENT_K === 8 && PROMPT_RECENT_K === 8, 'K=8')
  const ids = new Set(pool.map((p) => p.id))
  const texts = new Set(pool.map((p) => p.text))
  assert(ids.size === pool.length, 'prompt ids unique')
  assert(texts.size === pool.length, 'prompt texts unique')
  const types = new Set(pool.map((p) => p.type))
  assert(types.has('truth') && types.has('dare'), 'truth+dare in bank')
  const truths = pool.filter((p) => p.type === 'truth')
  const dares = pool.filter((p) => p.type === 'dare')
  assert(Math.abs(truths.length - dares.length) <= 8, 'truth/dare roughly balanced')
  const cats = new Set(pool.map((p) => p.category).filter(Boolean))
  assert(cats.size >= 4, `categories ${cats.size}`)
  assert(ids.has('t01') && ids.has('d16'), 'old ids still valid')
  for (const p of pool) {
    assert(p.type === 'truth' || p.type === 'dare', `type ${p.id}`)
    assert(p.text && p.text.length >= 4, `text ${p.id}`)
  }
}

{
  const bank = {
    prompts: Array.from({ length: 10 }, (_, i) => ({
      id: `x${i}`,
      type: i % 2 ? 'dare' : 'truth',
      text: `题${i}`,
    })),
  }
  let recent = []
  const seen = []
  for (let i = 0; i < 9; i++) {
    const picked = pickPrompt({ recentIds: recent, bank, rng: () => 0, k: 8 })
    assert(picked, `pick ${i}`)
    recent = picked.recentPromptIds
    seen.push(picked.prompt.id)
  }
  const last8 = seen.slice(0, 8)
  assert(!last8.includes(seen[8]), '9th draw avoids recent-K')
  assert(seen[8] === 'x8', `9th is first unbound, got ${seen[8]}`)
}

{
  const first = pickPrompt({ rng: () => 0 })
  assert(first, 'first pick')
  const entry = allPrompts().find((p) => p.id === first.prompt.id)
  assert(entry, 'entry exists')
  assert(
    first.prompt.displayType === entry.type,
    'displayType frozen to bank type',
  )
}

{
  const members = [
    { seatId: 'a', connected: true },
    { seatId: 'b', connected: true },
    { seatId: 'c', connected: false },
  ]
  assert(nextDrawerSeatId(members, 'a') === 'b', 'next after a is b')
  assert(nextDrawerSeatId(members, 'b') === 'a', 'wrap skips offline c')
  assert(nextDrawerSeatId(members, 'c') === 'a', 'offline current → next online')
  assert(
    nextDrawerSeatId([{ seatId: 'solo', connected: true }], 'solo') === 'solo',
    'solo wraps to self',
  )
}

{
  const store = createRoomStore()
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats: 8,
    gameId: 'truthDare',
  })
  const empty = partyStubOf(created.data.room.party)
  assert(empty.phase === 'idle', 'create idle')
  assert(empty.drawerSeatId == null, 'create no drawer')
  const code = created.data.room.roomCode
  const claimed = store.claimHostSeat(code, created.session.seatId, '桌主')
  const after = partyStubOf(claimed.room.party)
  assert(after.phase === 'drawing', 'claim → drawing')
  assert(after.drawerSeatId === created.session.seatId, 'host is drawer')
  assert(after.answererSeatId == null, 'no answerer before draw')
  assert(!after.prompt, 'no prompt at drawing')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const guest = store.joinRoom(code, '玩家B')
  assert(!('error' in guest), 'join')

  const denied = store.drawPrompt(code, guest.session.seatId, guest.session.seatToken)
  assert(denied.error === ACK_REASONS.NOT_YOUR_TURN, 'non-drawer cannot draw')
  assert(!partyOf(store, code).prompt, 'no prompt after reject')
  assert(partyOf(store, code).phase === 'drawing', 'reject keeps drawing')

  const badTok = store.drawPrompt(code, hostSeat, guest.session.seatToken)
  assert(badTok.error === ACK_REASONS.INVALID, 'wrong token cannot draw')

  const drawn = store.drawPrompt(code, hostSeat, hostTok)
  assert(!('error' in drawn), `draw ${drawn.error || ''}`)
  const party = partyStubOf(drawn.data.room.party)
  assert(party.phase === 'answering', 'draw → answering')
  assert(party.drawerSeatId === hostSeat, 'drawer unchanged')
  assert(party.answererSeatId === guest.session.seatId, 'default answerer = next online')
  const prompt = party.prompt
  assert(prompt?.id && prompt.text, 'public prompt')
  assert(prompt.displayType === 'truth' || prompt.displayType === 'dare', 'frozen type')
  assert(typeof prompt.drawnAt === 'number' && prompt.drawnAt > 0, 'drawnAt')
  const bankHit = allPrompts().find((p) => p.id === prompt.id)
  assert(bankHit && bankHit.type === prompt.displayType, 'type matches bank')
  assert(bankHit.text === prompt.text, 'text matches bank')

  const pub = publicPersisted(drawn.data)
  const pubParty = partyStubOf(pub.room.party)
  assert(pubParty.phase === 'answering', 'public phase')
  assert(pubParty.drawerSeatId === hostSeat, 'public drawer')
  assert(pubParty.answererSeatId === guest.session.seatId, 'public answerer = next')
  assert(pubParty.prompt?.id === prompt.id, 'public id')
  assert(pubParty.prompt.text === prompt.text, 'public text')
  assert(!('partyPrivates' in pub), 'no SeatPrivate on public')
  assert(!('seatTokens' in pub), 'no tokens on public')
  assert(!publicPayloadLeaks(pub), `public leak ${publicPayloadLeaks(pub)}`)

  const guestAgain = store.drawPrompt(
    code,
    guest.session.seatId,
    guest.session.seatToken,
  )
  assert(guestAgain.error === ACK_REASONS.INVALID, 'no draw while answering')
  const still = partyOf(store, code).prompt
  assert(still.id === prompt.id && still.text === prompt.text, 'reject does not mutate')

  const guestRedraw = store.redrawPrompt(
    code,
    guest.session.seatId,
    guest.session.seatToken,
  )
  assert(guestRedraw.error === ACK_REASONS.INVALID, 'answerer cannot redraw')
  assert(partyOf(store, code).prompt.id === prompt.id, 'guest redraw keeps prompt')

  const redrew = store.redrawPrompt(code, hostSeat, hostTok)
  assert(!('error' in redrew), `redraw ${redrew.error || ''}`)
  const afterRedraw = partyOf(store, code)
  assert(afterRedraw.phase === 'answering', 'redraw stays answering')
  assert(afterRedraw.prompt.id !== prompt.id, 'redraw changes prompt')
  assert(afterRedraw.redrawUsedThisTurn === true, 'redraw marks used')
  assert(afterRedraw.answererSeatId === guest.session.seatId, 'redraw keeps answerer')
  assert(
    (afterRedraw.recentPromptIds || []).includes(afterRedraw.prompt.id),
    'redraw id in near-K',
  )
  const pubR = partyStubOf(publicPersisted(redrew.data).room.party)
  assert(pubR.prompt.id === afterRedraw.prompt.id, 'redraw public id')
  assert(pubR.prompt.text === afterRedraw.prompt.text, 'redraw public text')

  const again = store.redrawPrompt(code, hostSeat, hostTok)
  assert(again.error === ACK_REASONS.REDRAW_USED, 'second redraw blocked')
  assert(partyOf(store, code).prompt.id === afterRedraw.prompt.id, 'limit keeps prompt')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const guest = store.joinRoom(code, '玩家B')
  const guestSet = store.setDrawer(
    code,
    guest.session.seatId,
    guest.session.seatToken,
    guest.session.seatId,
  )
  assert(guestSet.error === ACK_REASONS.NOT_HOST, 'non-host cannot set-drawer')
  assert(partyOf(store, code).drawerSeatId === hostSeat, 'drawer unchanged')

  const named = store.setDrawer(code, hostSeat, hostTok, guest.session.seatId)
  assert(!('error' in named), `set-drawer ${named.error || ''}`)
  assert(partyOf(store, code).phase === 'drawing', 'still drawing')
  assert(partyOf(store, code).drawerSeatId === guest.session.seatId, 'named drawer')

  const hostDraw = store.drawPrompt(code, hostSeat, hostTok)
  assert(hostDraw.error === ACK_REASONS.NOT_YOUR_TURN, 'old drawer cannot draw')
  assert(!partyOf(store, code).prompt, 'non-drawer draw does not write')

  const drawn = store.drawPrompt(
    code,
    guest.session.seatId,
    guest.session.seatToken,
  )
  assert(!('error' in drawn), 'named drawer can draw')
  assert(partyOf(store, code).phase === 'answering', 'named draw answering')
  assert(partyOf(store, code).answererSeatId === hostSeat, 'answerer=next after drawer')

  const duringAnswer = store.setDrawer(code, hostSeat, hostTok, hostSeat)
  assert(duringAnswer.error === ACK_REASONS.INVALID, 'set-drawer only in drawing')
  assert(partyOf(store, code).drawerSeatId === guest.session.seatId, 'answering drawer stays')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const a = store.joinRoom(code, '甲')
  const b = store.joinRoom(code, '乙')
  assert(!('error' in store.drawPrompt(code, hostSeat, hostTok)), 'draw for set-answerer')
  const promptId = partyOf(store, code).prompt.id

  const outsider = store.setAnswerer(
    code,
    b.session.seatId,
    b.session.seatToken,
    a.session.seatId,
  )
  assert(outsider.error === ACK_REASONS.INVALID, 'non drawer/host cannot set-answerer')
  assert(partyOf(store, code).answererSeatId === a.session.seatId, 'answerer unchanged')

  const offline = store.setAnswerer(code, hostSeat, hostTok, 'seat_missing')
  assert(offline.error === ACK_REASONS.INVALID, 'offline/missing target')

  const byHost = store.setAnswerer(code, hostSeat, hostTok, a.session.seatId)
  assert(!('error' in byHost), `set-answerer host ${byHost.error || ''}`)
  const afterHost = partyOf(store, code)
  assert(afterHost.answererSeatId === a.session.seatId, 'host changed answerer')
  assert(afterHost.prompt.id === promptId, 'prompt kept')
  const pubA = partyStubOf(publicPersisted(byHost.data).room.party)
  assert(pubA.answererSeatId === a.session.seatId, 'dual-end answerer')

  const byDrawer = store.setAnswerer(code, hostSeat, hostTok, b.session.seatId)
  assert(!('error' in byDrawer), 'drawer can set-answerer')
  assert(partyOf(store, code).answererSeatId === b.session.seatId, 'drawer changed answerer')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const a = store.joinRoom(code, '甲')
  assert(!('error' in store.drawPrompt(code, hostSeat, hostTok)), 'draw for advance')
  const promptId = partyOf(store, code).prompt.id
  const recent = partyOf(store, code).recentPromptIds

  const denied = store.advancePrompt(
    code,
    a.session.seatId,
    a.session.seatToken,
  )
  assert(denied.error === ACK_REASONS.INVALID, 'non answerer/host cannot advance')
  assert(partyOf(store, code).prompt?.id === promptId, 'advance reject keeps prompt')

  const advanced = store.advancePrompt(code, hostSeat, hostTok)
  assert(!('error' in advanced), `advance ${advanced.error || ''}`)
  const next = partyOf(store, code)
  assert(next.phase === 'drawing', 'advance → drawing')
  assert(!next.prompt, 'advance clears prompt (no grey)')
  assert(next.answererSeatId == null, 'advance clears answerer')
  assert(next.drawerSeatId === a.session.seatId, 'next drawer after host')
  assert(next.redrawUsedThisTurn === false, 'advance clears redraw flag')
  assert(
    JSON.stringify(next.recentPromptIds || []) === JSON.stringify(recent || []),
    'recent-K kept',
  )
  assert(Array.isArray(next.promptHistory) && next.promptHistory.length === 1, 'history 1')
  assert(next.promptHistory[0].id === promptId, 'history id')
  assert(next.promptHistory[0].text, 'history text')
  assert(next.promptHistory[0].answererNickname === '甲', 'history nick solidified')
  const pub = partyStubOf(publicPersisted(advanced.data).room.party)
  assert(!pub.prompt, 'public has no leftover prompt')
  assert(pub.phase === 'drawing', 'public drawing')
  assert(pub.drawerSeatId === a.session.seatId, 'public next drawer')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store, { maxSeats: 4 })
  const a = store.joinRoom(code, '甲')
  const b = store.joinRoom(code, '乙')
  assert(!('error' in store.drawPrompt(code, hostSeat, hostTok)), 'draw for late-join')
  store.setAnswerer(code, hostSeat, hostTok, a.session.seatId)
  const before = partyOf(store, code)
  const late = store.joinRoom(code, '晚进')
  assert(!('error' in late), 'late join')
  const snap = partyStubOf(publicPersisted(late.data).room.party)
  assert(snap.phase === 'answering', 'late-join phase')
  assert(snap.drawerSeatId === hostSeat, 'late-join drawer')
  assert(snap.answererSeatId === a.session.seatId, 'late-join answerer')
  assert(snap.prompt?.id === before.prompt.id, 'late-join prompt id')
  assert(snap.prompt.text === before.prompt.text, 'late-join prompt text')

  store.setPhase(code, 'paused')
  store.setMemberConnected(code, hostSeat, false)
  const afterOffline = partyOf(store, code)
  assert(afterOffline.phase === 'answering', 'drawer offline keeps answering')
  assert(afterOffline.prompt.id === before.prompt.id, 'drawer offline keeps prompt')
  assert(afterOffline.answererSeatId === a.session.seatId, 'answerer kept')
  assert(afterOffline.drawerSeatId === hostSeat, 'answering keeps offline drawer')

  const picked = store.pickNewHost(code, b.session.seatId, a.session.seatId)
  assert(!('error' in picked), `pick-host ${picked.error || ''}`)
  const after = partyStubOf(picked.room.party)
  assert(after.phase === afterOffline.phase, 'pick-host keeps phase')
  assert(after.prompt.id === afterOffline.prompt.id, 'pick-host keeps prompt')
  assert(after.prompt.text === afterOffline.prompt.text, 'pick-host keeps text')
  assert(after.drawerSeatId === afterOffline.drawerSeatId, 'pick-host keeps drawer')
  assert(after.answererSeatId === afterOffline.answererSeatId, 'pick-host keeps answerer')
  assert(picked.room.hostSeatId === b.session.seatId, 'new host seated')

  const hostAdvance = store.advancePrompt(
    code,
    b.session.seatId,
    b.session.seatToken,
  )
  assert(!('error' in hostAdvance), 'new host can advance')
  assert(partyOf(store, code).phase === 'drawing', 'host advance drawing')
  assert(!partyOf(store, code).prompt, 'host advance clears prompt')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const a = store.joinRoom(code, '甲')
  store.drawPrompt(code, hostSeat, hostTok)
  store.setMemberConnected(code, a.session.seatId, false)
  const ok = store.advancePrompt(code, hostSeat, hostTok)
  assert(!('error' in ok), 'host can advance while others offline')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const existing = store.get(code)
  store.set({
    ...existing,
    room: {
      ...existing.room,
      party: {
        gameId: 'truthDare',
        phase: 'lobby',
        prompt: { id: 'td01', displayType: 'truth', text: '旧题留着' },
        recentPromptIds: ['td01'],
      },
    },
  })
  const migrated = partyOf(store, code)
  assert(migrated.phase === 'answering', 'old lobby+prompt → answering')
  assert(migrated.drawerSeatId === hostSeat, 'migrate assigns drawer')
  assert(migrated.answererSeatId === hostSeat, 'migrate answerer=drawer')
  assert(migrated.prompt.text === '旧题留着', 'migrate keeps prompt')

  const noPrompt = store.get(code)
  store.set({
    ...noPrompt,
    room: {
      ...noPrompt.room,
      party: { gameId: 'truthDare', phase: 'lobby' },
    },
  })
  const drawing = partyOf(store, code)
  assert(drawing.phase === 'drawing', 'old lobby no prompt → drawing')
  assert(drawing.drawerSeatId === hostSeat, 'migrate drawer from seats')
  assert(!drawing.prompt, 'no prompt after lobby migrate')
  assert(hostTok, 'host token still valid')
}

{
  const store = createRoomStore()
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats: 8,
    gameId: 'undercover',
  })
  const code = created.data.room.roomCode
  store.claimHostSeat(code, created.session.seatId, '桌主')
  store.joinRoom(code, '甲')
  store.joinRoom(code, '乙')
  const drawUc = store.drawPrompt(
    code,
    created.session.seatId,
    created.session.seatToken,
  )
  assert(drawUc.error === ACK_REASONS.INVALID, 'undercover cannot draw')
  const started = store.startUndercover(
    code,
    created.session.seatId,
    created.session.seatToken,
  )
  assert(!('error' in started), 'undercover start still works')
  const party = partyStubOf(started.data.room.party)
  assert(party.gameId === 'undercover' && party.phase === 'speaking', 'undercover speaking')
  assert(!party.prompt, 'undercover has no truthDare prompt')
  assert(party.drawerSeatId == null, 'undercover has no drawer')
}

{
  const repaired = ensureTruthDareTurn(
    { gameId: 'truthDare', phase: 'lobby' },
    [{ seatId: 's1', connected: true }],
  )
  assert(repaired.phase === 'drawing', 'ensure drawing')
  assert(repaired.drawerSeatId === 's1', 'ensure drawer')
}

{
  const storeD = createRoomStore()
  const storeW = createRoomStore()
  const direct = openTruthDare(storeD)
  const wheel = openTruthDare(storeW)
  const drawnD = storeD.drawPrompt(direct.code, direct.hostSeat, direct.hostTok, 'direct')
  const drawnW = storeW.drawPrompt(wheel.code, wheel.hostSeat, wheel.hostTok, 'wheel')
  assert(!('error' in drawnD) && !('error' in drawnW), 'direct+wheel draw')
  const pubD = partyStubOf(publicPersisted(drawnD.data).room.party)
  const pubW = partyStubOf(publicPersisted(drawnW.data).room.party)
  function promptShape(party) {
    const p = party.prompt
    return {
      phase: party.phase,
      answererIsDrawer: party.answererSeatId === party.drawerSeatId,
      promptKeys: p ? Object.keys(p).sort().join(',') : '',
      hasId: typeof p?.id === 'string' && !!p.id,
      hasText: typeof p?.text === 'string' && !!p.text,
      typeOk: p?.displayType === 'truth' || p?.displayType === 'dare',
      drawnAt: typeof p?.drawnAt === 'number' && p.drawnAt > 0,
      recent: Array.isArray(party.recentPromptIds) && party.recentPromptIds.length >= 1,
      noSpin: !('spinning' in party) && !('wheel' in party) && !('drawMode' in party),
    }
  }
  const shapeD = promptShape(pubD)
  const shapeW = promptShape(pubW)
  assert(shapeD.phase === 'answering' && shapeW.phase === 'answering', 'both answering')
  assert(shapeD.answererIsDrawer && shapeW.answererIsDrawer, 'answerer=drawer')
  assert(shapeD.promptKeys === shapeW.promptKeys, `prompt keys ${shapeD.promptKeys}`)
  assert(shapeD.hasId && shapeW.hasId, 'both ids')
  assert(shapeD.hasText && shapeW.hasText, 'both text')
  assert(shapeD.typeOk && shapeW.typeOk, 'both frozen type')
  assert(shapeD.drawnAt && shapeW.drawnAt, 'both drawnAt')
  assert(shapeD.recent && shapeW.recent, 'both recent-K')
  assert(shapeD.noSpin && shapeW.noSpin, 'no wheel field on snapshot')
  const unknown = createRoomStore()
  const u = openTruthDare(unknown)
  const drawnU = unknown.drawPrompt(u.code, u.hostSeat, u.hostTok, 'nope')
  assert(!('error' in drawnU), 'unknown mode still draws')
  assert(partyStubOf(drawnU.data.room.party).phase === 'answering', 'unknown mode answering')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const a = store.joinRoom(code, '甲')
  const wheel = store.drawPrompt(code, hostSeat, hostTok, 'wheel')
  assert(!('error' in wheel), 'wheel then advance')
  const promptId = partyOf(store, code).prompt.id
  const advanced = store.advancePrompt(code, hostSeat, hostTok)
  assert(!('error' in advanced), 'advance after wheel')
  const next = partyOf(store, code)
  assert(next.phase === 'drawing', 'wheel-advance drawing')
  assert(!next.prompt, 'wheel-advance clears prompt')
  assert(next.drawerSeatId === a.session.seatId, 'wheel-advance next drawer')
  assert(
    Array.isArray(next.recentPromptIds) && next.recentPromptIds.includes(promptId),
    'wheel recent-K kept',
  )
}

{
  let recent = ['t01', 't02', 't03', 't04', 't05', 't06', 't07', 't08']
  const picked = pickPrompt({ recentIds: recent, rng: () => 0, k: 8 })
  assert(picked, 'expanded bank pick')
  assert(!recent.includes(picked.prompt.id), 'real bank avoids recent-K')
  assert(picked.recentPromptIds.length === 8, 'recent window still K=8')
  assert(picked.recentPromptIds[7] === picked.prompt.id, 'new id appended')
}

{
  const dare = pickPrompt({ type: 'dare', rng: () => 0 })
  assert(dare?.prompt.displayType === 'dare', 'type dare')
  const truth = pickPrompt({ type: 'truth', rng: () => 0 })
  assert(truth?.prompt.displayType === 'truth', 'type truth')
}

{
  const members = [
    { seatId: 'a', connected: true, name: '甲' },
    { seatId: 'b', connected: true, name: '乙' },
    { seatId: 'c', connected: false, name: '丙' },
  ]
  assert(nextAnswererSeatId(members, 'a') === 'b', 'default answerer next')
  assert(nextAnswererSeatId(members, 'b') === 'a', 'wrap skips offline')
  assert(
    nextAnswererSeatId([{ seatId: 'solo', connected: true }], 'solo') === 'solo',
    'solo default self',
  )
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  store.joinRoom(code, '甲')
  assert(!('error' in store.drawPrompt(code, hostSeat, hostTok)), 'draw typed redraw')
  const before = partyOf(store, code).prompt
  const typed = store.redrawPrompt(code, hostSeat, hostTok, 'dare')
  assert(!('error' in typed), `typed redraw ${typed.error || ''}`)
  const after = partyOf(store, code)
  assert(after.prompt.displayType === 'dare', 'reselect dare')
  assert(after.prompt.id !== before.id, 'typed redraw changed')
  assert(after.prompt.typeChoice === 'dare', 'typeChoice stored')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const a = store.joinRoom(code, '甲')
  for (let i = 0; i < 6; i++) {
    assert(!('error' in store.drawPrompt(code, hostSeat, hostTok)), `draw ${i}`)
    const adv = store.advancePrompt(code, hostSeat, hostTok)
    assert(!('error' in adv), `advance ${i}`)
    store.setDrawer(code, hostSeat, hostTok, hostSeat)
  }
  const hist = partyOf(store, code).promptHistory || []
  assert(hist.length === HISTORY_N, `history cap ${hist.length}`)
  const late = store.joinRoom(code, '晚进')
  const lateHist = partyStubOf(publicPersisted(late.data).room.party).promptHistory
  assert(lateHist?.length === HISTORY_N, 'late-join history')
  assert(lateHist[0].text && lateHist[0].answererNickname, 'late-join last prompt')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const a = store.joinRoom(code, '甲')
  const guestSkip = store.skipDrawer(
    code,
    a.session.seatId,
    a.session.seatToken,
  )
  assert(guestSkip.error === ACK_REASONS.NOT_HOST, 'non-host cannot skip-drawer')
  const skipped = store.skipDrawer(code, hostSeat, hostTok)
  assert(!('error' in skipped), `skip-drawer ${skipped.error || ''}`)
  assert(partyOf(store, code).phase === 'drawing', 'skip stays drawing')
  assert(partyOf(store, code).drawerSeatId === a.session.seatId, 'skip → next online')

  store.drawPrompt(code, a.session.seatId, a.session.seatToken)
  const duringAnswer = store.skipDrawer(code, hostSeat, hostTok)
  assert(duringAnswer.error === ACK_REASONS.INVALID, 'skip-drawer only drawing')
  assert(partyOf(store, code).prompt, 'skip during answering keeps prompt')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const a = store.joinRoom(code, '甲')
  store.setMemberConnected(code, hostSeat, false)
  const drawing = partyOf(store, code)
  assert(drawing.phase === 'drawing', 'drawing after host offline')
  assert(!drawing.prompt, 'no prompt')
  assert(drawing.drawerSeatId === a.session.seatId, 'drawing skips offline drawer')
  assert(drawing.drawerSeatId !== hostSeat, 'next-draw not ghost')

  store.setDrawer(code, hostSeat, hostTok, a.session.seatId)
  store.drawPrompt(code, a.session.seatId, a.session.seatToken)
  const promptId = partyOf(store, code).prompt.id
  store.setMemberConnected(code, a.session.seatId, false)
  const answering = partyOf(store, code)
  assert(answering.phase === 'answering', 'answering drawer offline keeps phase')
  assert(answering.prompt.id === promptId, 'answering drawer offline keeps prompt')
  assert(answering.drawerSeatId === a.session.seatId, 'answering keeps offline drawer')
  const hostRedraw = store.redrawPrompt(code, hostSeat, hostTok)
  assert(!('error' in hostRedraw), 'host can redraw while drawer offline')
  const hostAdv = store.advancePrompt(code, hostSeat, hostTok)
  assert(!('error' in hostAdv), 'host can advance while drawer offline')
}

{
  let hist = []
  for (let i = 0; i < 6; i++) {
    hist = appendPromptHistory(hist, {
      id: `h${i}`,
      displayType: 'truth',
      text: `旧题${i}`,
      answererSeatId: 's1',
      answererNickname: '固化名',
      redrawn: i === 1,
      closedAt: i + 1,
    })
  }
  assert(hist.length === 5, 'append cap 5')
  assert(hist[0].id === 'h5', 'newest first')
  assert(hist[4].id === 'h1', 'oldest kept of last 5')
  assert(!hist.some((h) => h.id === 'h0'), 'drops 6th')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const ghost = store.drawPrompt(code, hostSeat, hostTok)
  assert(!('error' in ghost), 'solo draw')
  assert(partyOf(store, code).answererSeatId === hostSeat, 'solo default self')
}

console.log('OK test-truth-dare')
