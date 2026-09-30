/**
 * Werewolf-deal: boards, deal seats (incl. offline), privates, no who-is-who,
 * late join, tweak gates, redeal→lobby, stage text only.
 * Run: npm run test:werewolf-deal
 */
import {
  ACK_REASONS,
  createRoomStore,
  publicPersisted,
  partyStubOf,
} from '../server/roomLogic.mjs'
import {
  DEFAULT_BOARDS,
  WW_ACK,
  canDeal,
  dealRefusal,
  dealRoles,
  defaultBoard,
  publicPayloadLeaks,
  sumBoard,
} from '../server/werewolfDeal.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function hostRoom(store, maxSeats = 10) {
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats,
    gameId: 'werewolf-deal',
  })
  assert(!('error' in created), `create ${created.error || ''}`)
  const code = created.data.room.roomCode
  store.claimHostSeat(code, created.session.seatId, '桌主')
  return { store, code, host: created.session, tok: created.session.seatToken }
}

function joinN(store, code, n) {
  const seats = []
  for (let i = 0; i < n; i++) {
    const j = store.joinRoom(code, `P${i + 1}`)
    assert(!('error' in j), `join ${i}`)
    seats.push(j.session)
  }
  return seats
}

{
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const b = defaultBoard(n)
    assert(sumBoard(b) === n, `default sum ${n}`)
    assert(b.werewolf >= 1, `default wolf ${n}`)
    assert(canDeal(b, n), `default canDeal ${n}`)
    const expect = DEFAULT_BOARDS[n]
    for (const k of Object.keys(expect)) {
      assert(b[k] === expect[k], `default ${n}.${k}`)
    }
  }
  assert(dealRefusal(defaultBoard(1), 1) === WW_ACK.NEED_TWO_SEATED, 'n=1')
  assert(dealRefusal({ werewolf: 2, villager: 0, seer: 0, witch: 0, hunter: 0, guard: 0 }, 2) === WW_ACK.NO_GOOD, 'no good')
  assert(dealRefusal({ werewolf: 0, villager: 2, seer: 0, witch: 0, hunter: 0, guard: 0 }, 2) === WW_ACK.NO_WOLF, 'no wolf')
  assert(dealRefusal(defaultBoard(2), 3) === WW_ACK.BOARD_MISMATCH, 'mismatch')
}

{
  const dealt = dealRoles(['a', 'b', 'c'], defaultBoard(3), () => 0.1, '7')
  assert(!dealt.error, 'dealRoles')
  assert(dealt.privates.length === 3, '3 cards')
  assert(dealt.privates.every((p) => p.gameId === 'werewolf-deal'), 'gameId')
  assert(dealt.privates.every((p) => p.dealId === '7'), 'dealId')
  const roles = dealt.privates.map((p) => p.roleId).sort()
  assert(roles.join(',') === 'seer,villager,werewolf', `roles ${roles}`)
}

{
  const { store, code, host, tok } = hostRoom(createRoomStore(), 8)
  assert(store.get(code).room.maxSeats === 8, 'max 8 stored')
  const party0 = partyStubOf(store.get(code).room.party)
  assert(party0.gameId === 'werewolf-deal', 'gameId')
  assert(party0.phase === 'lobby', 'lobby')
  assert(party0.stage === 'idle', 'idle')
  assert(party0.seatCount === 1, 'host only')
  assert(!party0.boardTweaked, 'auto')
  assert(sumBoard(party0.board) === 0, 'no default at 1')

  const tooFew = store.dealWerewolf(code, host.seatId, tok)
  assert(tooFew.error === ACK_REASONS.NEED_TWO_SEATED, `need 2 ${tooFew.error}`)

  const guest = store.joinRoom(code, '甲')
  const party2 = partyStubOf(store.get(code).room.party)
  assert(party2.seatCount === 2, 'seat 2')
  assert(party2.board.werewolf === 1 && party2.board.villager === 1, 'auto 2')
  assert(!party2.boardTweaked, 'still auto')

  const notHost = store.dealWerewolf(code, guest.session.seatId, guest.session.seatToken)
  assert(notHost.error === ACK_REASONS.NOT_HOST, 'guest cannot deal')

  const started = store.dealWerewolf(code, host.seatId, tok)
  assert(!('error' in started), `deal ${started.error || ''}`)
  assert(started.private?.seatId === host.seatId, 'host private')
  assert(started.private?.roleId && started.private.label, 'host role')
  assert(started.private?.camp === 'wolf' || started.private?.camp === 'good', 'camp')

  const pub = publicPersisted(started.data)
  assert(!publicPayloadLeaks(pub), `public leak ${publicPayloadLeaks(pub)}`)
  const party = partyStubOf(pub.room.party)
  assert(party.phase === 'dealt', 'dealt')
  assert(party.stage === 'idle', 'stage idle after deal')
  assert(party.dealtSeatIds.length === 2, '2 dealt')
  assert(party.roleComposition.some((r) => r.roleId === 'werewolf' && r.count === 1), 'comp wolf')
  assert(!party.roleComposition.some((r) => r.seatId), 'comp no seat')
  const raw = JSON.stringify(pub)
  assert(!raw.includes('whoIsWho') && !raw.includes('hostRoster'), 'no roster keys')
  assert(!raw.includes('"partyPrivates"'), 'no privates in public')

  const gPriv = store.getSeatPrivate(code, guest.session.seatId, guest.session.seatToken)
  assert(gPriv.private?.roleId, 'guest role')
  assert(gPriv.private.seatId === guest.session.seatId, 'own only')
  assert(started.private.roleId !== gPriv.private.roleId, 'different roles on 2p')

  const peek = store.getSeatPrivate(code, host.seatId, guest.session.seatToken)
  assert(peek.private === null, 'cannot peek host')

  const locked = store.tweakWerewolfBoard(code, host.seatId, tok, {
    werewolf: 2,
    villager: 0,
    seer: 0,
    witch: 0,
    hunter: 0,
    guard: 0,
  })
  assert(locked.error === ACK_REASONS.BOARD_LOCKED, 'no tweak after deal')

  const mid = store.joinRoom(code, '晚进')
  assert(!('error' in mid), 'late join ok')
  const midParty = partyStubOf(mid.data.room.party)
  assert(midParty.phase === 'dealt', 'late still dealt')
  assert(!midParty.dealtSeatIds.includes(mid.session.seatId), 'late not in dealt')
  const midPriv = store.getSeatPrivate(code, mid.session.seatId, mid.session.seatToken)
  assert(midPriv.private === null, 'late no private')
  assert(midParty.roleComposition.length >= 1, 'late sees composition')
  assert(!publicPayloadLeaks(publicPersisted(mid.data)), 'late public clean')

  const night = store.setWerewolfStage(code, host.seatId, tok, 'night')
  assert(!('error' in night), 'set night')
  assert(partyStubOf(night.data.room.party).stage === 'night', 'night')
  const day = store.setWerewolfStage(code, host.seatId, tok, 'day')
  assert(partyStubOf(day.data.room.party).stage === 'day', 'day')
  const vote = store.setWerewolfStage(code, host.seatId, tok, 'vote')
  assert(partyStubOf(vote.data.room.party).stage === 'vote', 'vote')
  const guestStage = store.setWerewolfStage(
    code,
    guest.session.seatId,
    guest.session.seatToken,
    'night',
  )
  assert(guestStage.error === ACK_REASONS.NOT_HOST, 'guest no stage')

  const oldDealId = started.private.dealId
  const oldRole = started.private.roleId
  const cleared = store.redealWerewolf(code, host.seatId, tok)
  assert(!('error' in cleared), `redeal ${cleared.error || ''}`)
  assert(cleared.private === null, 'redeal clears caller private')
  const after = partyStubOf(cleared.data.room.party)
  assert(after.phase === 'lobby', 'redeal → lobby')
  assert(after.stage === 'idle', 'redeal stage idle')
  assert(after.dealtSeatIds.length === 0, 'cleared dealt ids')
  assert(
    store.getSeatPrivate(code, host.seatId, tok).private === null,
    'old private gone',
  )
  assert(
    store.getSeatPrivate(code, guest.session.seatId, guest.session.seatToken)
      .private === null,
    'guest old gone',
  )

  const again = store.dealWerewolf(code, host.seatId, tok)
  assert(!('error' in again), `redeal auto-board then deal ${again.error || ''}`)
  assert(
    partyStubOf(again.data.room.party).dealtSeatIds.length === 3,
    'untweaked redeal recals auto board for 3',
  )
  assert(again.private?.dealId && again.private.dealId !== oldDealId, 'new dealId')
  void oldRole
}

{
  const { store, code, host, tok } = hostRoom(createRoomStore())
  joinN(store, code, 1)
  const tweaked = store.tweakWerewolfBoard(code, host.seatId, tok, {
    werewolf: 1,
    villager: 0,
    seer: 1,
    witch: 0,
    hunter: 0,
    guard: 0,
  })
  assert(!('error' in tweaked), 'tweak ok')
  const p = partyStubOf(tweaked.data.room.party)
  assert(p.boardTweaked === true, 'tweaked flag')
  assert(p.board.seer === 1 && p.board.villager === 0, 'kept tweak')

  store.joinRoom(code, '第三人')
  const afterJoin = partyStubOf(store.get(code).room.party)
  assert(afterJoin.boardTweaked === true, 'join does not overwrite tweak')
  assert(afterJoin.board.seer === 1 && afterJoin.seatCount === 3, 'tweak kept, seats 3')
  const refuse = store.dealWerewolf(code, host.seatId, tok)
  assert(refuse.error === ACK_REASONS.BOARD_MISMATCH, 'tweak vs 3 seats')

  const reset = store.resetWerewolfBoard(code, host.seatId, tok)
  assert(!('error' in reset), 'reset')
  const auto = partyStubOf(reset.data.room.party)
  assert(auto.boardTweaked === false, 'reset clears flag')
  assert(auto.board.werewolf === 1 && auto.board.villager === 1 && auto.board.seer === 1, 'auto 3')
  const dealt = store.dealWerewolf(code, host.seatId, tok)
  assert(!('error' in dealt), 'deal after reset')
}

{
  const { store, code, host, tok } = hostRoom(createRoomStore())
  const g = store.joinRoom(code, '乙')
  store.setMemberConnected(code, g.session.seatId, false)
  const members = store.get(code).room.members
  assert(members.some((m) => m.seatId === g.session.seatId && !m.connected), 'offline seated')
  const dealt = store.dealWerewolf(code, host.seatId, tok)
  assert(!('error' in dealt), `offline still deals ${dealt.error || ''}`)
  const party = partyStubOf(dealt.data.room.party)
  assert(party.dealtSeatIds.includes(g.session.seatId), 'grace/offline seat got a card')
  const priv = store.getSeatPrivate(code, g.session.seatId, g.session.seatToken)
  assert(priv.private?.roleId, 'offline seat private exists')
}

{
  const { store, code, host, tok } = hostRoom(createRoomStore())
  joinN(store, code, 1)
  const dealt = store.dealWerewolf(code, host.seatId, tok)
  assert(!('error' in dealt), 'deal 2')
  store.joinRoom(code, '丙')
  const mid = partyStubOf(store.get(code).room.party)
  assert(mid.phase === 'dealt' && mid.seatCount === 3, 'drift 3 vs board 2')
  const red = store.redealWerewolf(code, host.seatId, tok)
  assert(!('error' in red), 'redeal always clears')
  const lobby = partyStubOf(red.data.room.party)
  assert(lobby.phase === 'lobby' && lobby.stage === 'idle', 'back to lobby')
  const fix = store.resetWerewolfBoard(code, host.seatId, tok)
  assert(!('error' in fix), 'can reset after redeal')
  const dealt2 = store.dealWerewolf(code, host.seatId, tok)
  assert(!('error' in dealt2), `deal after clear ${dealt2.error || ''}`)
  assert(partyStubOf(dealt2.data.room.party).dealtSeatIds.length === 3, 'new deal 3')
}

{
  const wolf9 = createRoomStore().createEmptyHostRoom({
    mode: 'partyGame',
    gameId: 'werewolf-deal',
    maxSeats: 10,
  })
  assert(!('error' in wolf9), 'werewolf 10 ok')
  assert(wolf9.data.room.maxSeats === 10, 'persist 10')
  const wolf11 = createRoomStore().createEmptyHostRoom({
    mode: 'partyGame',
    gameId: 'werewolf-deal',
    maxSeats: 11,
  })
  assert(wolf11.error === ACK_REASONS.SEATS_RANGE_WEREWOLF, 'werewolf 11')
  const uc9 = createRoomStore().createEmptyHostRoom({
    mode: 'partyGame',
    gameId: 'undercover',
    maxSeats: 9,
  })
  assert(uc9.error === ACK_REASONS.SEATS_RANGE, 'undercover still 2–8')
}

{
  const store = createRoomStore()
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    gameId: 'undercover',
    maxSeats: 4,
  })
  store.claimHostSeat(created.data.room.roomCode, created.session.seatId, 'U')
  store.joinRoom(created.data.room.roomCode, 'A')
  store.joinRoom(created.data.room.roomCode, 'B')
  const started = store.startUndercover(
    created.data.room.roomCode,
    created.session.seatId,
    created.session.seatToken,
  )
  assert(!('error' in started), 'undercover smoke still deals')
  assert(started.private?.word, 'undercover word')
}

console.log('OK test-werewolf-deal')
