/**
 * Slice B: 真心话大冒险 draw / redraw.
 * Dual-end same public prompt, host-only, recent-K, redraw changes text.
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
  store.claimHostSeat(code, created.session.seatId, host)
  return { code, hostSeat: created.session.seatId, hostTok: created.session.seatToken }
}

{
  const pool = allPrompts(PROMPTS)
  assert(pool.length >= 16, `bank size ${pool.length}`)
  assert(RECENT_K === 8 && PROMPT_RECENT_K === 8, 'K=8')
  const ids = new Set(pool.map((p) => p.id))
  const texts = new Set(pool.map((p) => p.text))
  assert(ids.size === pool.length, 'prompt ids unique')
  assert(texts.size === pool.length, 'prompt texts unique')
  const types = new Set(pool.map((p) => p.type))
  assert(types.has('truth') && types.has('dare'), 'truth+dare in bank')
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
  assert(first.prompt.displayType === 'truth' || first.prompt.displayType === 'dare')
  const second = pickPrompt({
    recentIds: first.recentPromptIds,
    previousId: first.prompt.id,
    previousText: first.prompt.text,
    mustChange: true,
    rng: () => 0,
  })
  assert(second, 'redraw pick')
  assert(second.prompt.id !== first.prompt.id, 'redraw id changes')
  assert(second.prompt.text !== first.prompt.text, 'redraw text changes')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const guest = store.joinRoom(code, '玩家B')
  assert(!('error' in guest), 'join')

  const denied = store.drawPrompt(code, guest.session.seatId, guest.session.seatToken)
  assert(denied.error === ACK_REASONS.NOT_HOST, 'non-host cannot draw')
  assert(!partyStubOf(store.get(code).room.party).prompt, 'no prompt after reject')

  const badTok = store.drawPrompt(code, hostSeat, guest.session.seatToken)
  assert(badTok.error === ACK_REASONS.INVALID, 'wrong token cannot draw')

  const drawn = store.drawPrompt(code, hostSeat, hostTok)
  assert(!('error' in drawn), `draw ${drawn.error || ''}`)
  const prompt = partyStubOf(drawn.data.room.party).prompt
  assert(prompt?.id && prompt.text, 'public prompt')
  assert(prompt.displayType === 'truth' || prompt.displayType === 'dare', 'frozen type')
  const bankHit = allPrompts().find((p) => p.id === prompt.id)
  assert(bankHit && bankHit.type === prompt.displayType, 'type matches bank')
  assert(bankHit.text === prompt.text, 'text matches bank')

  const pub = publicPersisted(drawn.data)
  const pubPrompt = partyStubOf(pub.room.party).prompt
  assert(pubPrompt?.id === prompt.id, 'public id')
  assert(pubPrompt.text === prompt.text, 'public text')
  assert(pubPrompt.displayType === prompt.displayType, 'public type')
  assert(!('partyPrivates' in pub), 'no SeatPrivate on public')
  assert(!('seatTokens' in pub), 'no tokens on public')
  assert(!publicPayloadLeaks(pub), `public leak ${publicPayloadLeaks(pub)}`)

  const guestRedraw = store.redrawPrompt(
    code,
    guest.session.seatId,
    guest.session.seatToken,
  )
  assert(guestRedraw.error === ACK_REASONS.NOT_HOST, 'non-host cannot redraw')
  const still = partyStubOf(store.get(code).room.party).prompt
  assert(still.id === prompt.id && still.text === prompt.text, 'reject does not mutate')

  const redrew = store.redrawPrompt(code, hostSeat, hostTok)
  assert(!('error' in redrew), `redraw ${redrew.error || ''}`)
  const next = partyStubOf(redrew.data.room.party).prompt
  assert(next.id !== prompt.id, 'redraw id changed')
  assert(next.text !== prompt.text, 'redraw text changed')
  const nextPub = publicPersisted(redrew.data).room.party.prompt
  assert(nextPub.id === next.id && nextPub.text === next.text, 'dual-end redraw public')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store, { maxSeats: 4 })
  const a = store.joinRoom(code, '甲')
  const b = store.joinRoom(code, '乙')
  assert(!('error' in a) && !('error' in b), 'join A/B')
  const drawn = store.drawPrompt(code, hostSeat, hostTok)
  const before = partyStubOf(drawn.data.room.party).prompt
  store.setPhase(code, 'paused')
  store.setMemberConnected(code, hostSeat, false)
  const picked = store.pickNewHost(code, b.session.seatId, a.session.seatId)
  assert(!('error' in picked), `pick-host ${picked.error || ''}`)
  const after = partyStubOf(picked.room.party).prompt
  assert(after.id === before.id && after.text === before.text, 'host transfer keeps prompt')
  assert(after.displayType === before.displayType, 'host transfer keeps type')
  assert(picked.room.hostSeatId === b.session.seatId, 'new host seated')
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
  assert(party.gameId === 'undercover' && party.phase === 'playing', 'undercover playing')
  assert(!party.prompt, 'undercover has no truthDare prompt')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openTruthDare(store)
  const early = store.redrawPrompt(code, hostSeat, hostTok)
  assert(early.error === ACK_REASONS.INVALID, 'redraw before draw invalid')
}

console.log('OK test-truth-dare')
