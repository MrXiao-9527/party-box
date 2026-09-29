/**
 * Miss-card (十三钗) relay engine + store: 52 no-jokers, turn ring,
 * A–K handlers, 8s-skip helper, late-join snapshot, deck empty.
 * Run: npm run test:miss-card
 */
import {
  createRoomStore,
  ACK_REASONS,
  publicPersisted,
  partyStubOf,
  DISCONNECT_GRACE_MS,
} from '../server/roomLogic.mjs'
import {
  COMMANDS,
  RANKS,
  SUITS,
  DECK_SIZE,
  HISTORY_N,
  buildDeck,
  shuffleDeck,
  createPlayingMissCard,
  drawCard,
  pickTarget,
  completeTurn,
  skipDrawerTurn,
  skipIfTurnOffline,
  setKCups,
  applyK,
  spendToilet,
  remainingCount,
  neighborSeatId,
  nextOnlineSeatId,
  MISS_ACK,
} from '../server/missCard.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function membersOf(...names) {
  return names.map((name, i) => ({
    seatId: `s${i}`,
    name,
    connected: true,
    isHost: i === 0,
  }))
}

function openMiss(store, { maxSeats = 8, host = '桌主' } = {}) {
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats,
    gameId: 'miss-card',
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
  assert(DISCONNECT_GRACE_MS === 8000, 'grace 8s')
  assert(RANKS.length === 13, '13 ranks')
  assert(Object.keys(COMMANDS).length === 13, '13 commands')
  for (const rank of RANKS) {
    assert(COMMANDS[rank]?.name, `name ${rank}`)
    assert(COMMANDS[rank]?.instruction?.length > 4, `copy ${rank}`)
  }
  const names = RANKS.map((r) => COMMANDS[r].name)
  assert(names.includes('指定喝') && names.includes('小姐') && names.includes('逛三园'), 'classic names')
  assert(names.includes('摸鼻子') && names.includes('照相机') && names.includes('扭一扭'), '3-6')
  assert(names.includes('逢7过') && names.includes('厕所牌') && names.includes('自喝'), '7-9')
  assert(names.includes('神经病') && names.includes('左边喝') && names.includes('右边喝'), '10-Q')
  assert(names.includes('定量牌'), 'K')
  const deck = buildDeck()
  assert(deck.length === DECK_SIZE, '52')
  assert(!deck.some((c) => c.rank === 'joker'), 'no jokers')
  const shuffled = shuffleDeck(deck, () => 0)
  assert(shuffled.length === 52, 'shuffle keeps 52')
}

{
  const members = membersOf('甲', '乙', '丙')
  const deck = RANKS.map((rank, i) => ({ rank, suit: SUITS[i % 4] }))
  let party = createPlayingMissCard(members, { deck })
  assert(party.phase === 'playing', 'playing')
  assert(party.turnSeatId === 's0', 'first online')
  assert(remainingCount(party) === 13, 'injected remaining')

  const drawnA = drawCard(party, members, 's0', 1)
  assert(!drawnA.error, 'draw A')
  party = drawnA.party
  assert(party.currentCard.rank === 'A', 'A face')
  assert(party.needPickTarget, 'A needs pick')
  assert(party.phase === 'awaitComplete', 'await')
  const doneEarly = completeTurn(party, members)
  assert(doneEarly.error === MISS_ACK.NEED_PICK_TARGET, 'A complete blocked')
  const ghost = pickTarget(party, members, 's0', 'offline')
  assert(ghost.error === MISS_ACK.PICK_ONLINE, 'ghost blocked')
  const self = pickTarget(party, members, 's0', 's0')
  assert(!self.error, 'A may pick self')
  party = self.party
  assert(party.targetSeatId === 's0', 'self target')
  assert(party.history[0].targetSeatId === 's0', 'history target')
  const doneA = completeTurn(party, members)
  assert(!doneA.error, 'complete A')
  party = doneA.party
  assert(party.turnSeatId === 's1', 'next 乙')
  assert(party.phase === 'playing', 'back playing')
  assert(!party.currentCard, 'cleared card')

  const drawn2 = drawCard(party, members, 's1', 2)
  party = drawn2.party
  assert(party.currentCard.rank === '2', '2')
  assert(party.roles.missSeatId === 's1', 'miss = 乙')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's2', 3).party
  assert(party.currentCard.rank === '3', '3 prompt')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's0', 4).party
  assert(party.currentCard.rank === '4', '4')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's1', 5).party
  assert(party.currentCard.rank === '5', '5')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's2', 6).party
  assert(party.currentCard.rank === '6', '6')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's0', 7).party
  assert(party.currentCard.rank === '7', '7')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's1', 8).party
  assert(party.currentCard.rank === '8', '8')
  assert(party.toiletRemaining.s1 === 1, 'toilet +1')
  const used = spendToilet(party, 's1')
  assert(!used.error, 'use toilet')
  party = used.party
  assert(!party.toiletRemaining.s1, 'toilet cleared')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's2', 9).party
  assert(party.currentCard.rank === '9', '9')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's0', 10).party
  assert(party.roles.psychoSeatId === 's0', 'psycho 甲')
  party = completeTurn(party, members).party

  party = drawCard(party, members, 's1', 11).party
  assert(party.currentCard.rank === 'J', 'J')
  assert(party.resolvedNeighbor.side === 'left', 'J left')
  assert(party.resolvedNeighbor.seatId === 's0', 'J → 甲 (previous online)')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's2', 12).party
  assert(party.currentCard.rank === 'Q', 'Q')
  assert(party.resolvedNeighbor.side === 'right', 'Q right')
  assert(party.resolvedNeighbor.seatId === 's0', 'Q → 甲 (next)')
  party = completeTurn(party, members).party

  party = drawCard(party, members, 's0', 13).party
  assert(party.currentCard.rank === 'K', 'K first')
  assert(party.needSetK, 'must set cups')
  assert(completeTurn(party, members).error === MISS_ACK.NEED_SET_K, 'K blocked')
  party = setKCups(party, 's0', 4).party
  assert(party.kPending.cups === 4, 'k pending 4')
  assert(!party.needSetK, 'set done')
  party = completeTurn(party, members).party
  assert(party.phase === 'deckEmpty', 'deck empty after last complete')
  assert(party.kPending.cups === 4, 'k kept')
}

{
  const members = membersOf('甲', '乙')
  const deck = [
    { rank: '2', suit: 'spade' },
    { rank: '2', suit: 'heart' },
    { rank: '10', suit: 'club' },
    { rank: '10', suit: 'diamond' },
    { rank: 'K', suit: 'spade' },
    { rank: 'K', suit: 'heart' },
  ]
  let party = createPlayingMissCard(members, { deck })
  party = drawCard(party, members, 's0', 1).party
  assert(party.roles.missSeatId === 's0', 'first miss')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's1', 2).party
  assert(party.roles.missSeatId === 's1', '2 replaces')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's0', 3).party
  assert(party.roles.psychoSeatId === 's0', 'first psycho')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's1', 4).party
  assert(party.roles.psychoSeatId === 's1', '10 replaces')
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's0', 5).party
  party = setKCups(party, 's0', 2).party
  party = completeTurn(party, members).party
  party = drawCard(party, members, 's1', 6).party
  assert(party.kExecuteCups === 2, 'execute 2')
  party = applyK(party, 's1').party
  assert(party.kPending == null, 'apply clears')
  party = completeTurn(party, members).party
  assert(party.kPending == null, 'still clear after complete')
}

{
  const members = membersOf('独')
  const left = neighborSeatId(members, 's0', 'left')
  const right = neighborSeatId(members, 's0', 'right')
  assert(left == null && right == null, 'solo no neighbor')
  const deck = [{ rank: 'J', suit: 'spade' }]
  let party = createPlayingMissCard(members, { deck })
  party = drawCard(party, members, 's0', 1).party
  assert(party.resolvedNeighbor.seatId == null, 'J self-drink')
}

{
  const members = membersOf('甲', '乙', '丙')
  members[1].connected = false
  assert(nextOnlineSeatId(members, 's0') === 's2', 'skip offline 乙')
  const nLeft = neighborSeatId(members, 's0', 'left')
  assert(nLeft === 's2', 'left skips offline')
}

{
  const members = membersOf('甲', '乙')
  let party = createPlayingMissCard(members, {
    deck: [
      { rank: '9', suit: 'spade' },
      { rank: '9', suit: 'heart' },
    ],
  })
  const skipped = skipDrawerTurn(party, members, { reason: 'host' })
  assert(!skipped.error, 'skip playing')
  assert(skipped.party.turnSeatId === 's1', 'host skip to 乙')
  party = drawCard(skipped.party, members, 's1', 1).party
  members[1].connected = false
  const off = skipIfTurnOffline(party, members, 's1')
  assert(off && !off.error, 'offline skip awaitComplete')
  assert(off.party.turnSeatId === 's0', 'to 甲')
  assert(off.party.skipNotice.text.includes('离线'), 'offline copy')
  const still = skipIfTurnOffline(off.party, members, 's1')
  assert(still == null, 'not current turn')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openMiss(store)
  const one = store.startMissCard(code, hostSeat, hostTok)
  assert(one.error === ACK_REASONS.NEED_TWO_ONLINE, 'solo cannot start')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openMiss(store)
  const a = store.joinRoom(code, '甲')
  const started = store.startMissCard(code, hostSeat, hostTok)
  assert(!('error' in started), `start ${started.error || 'ok'}`)
  const p0 = partyOf(store, code)
  assert(p0.phase === 'playing', 'store playing')
  assert(p0.deck.length === 52, 'store 52')
  assert(p0.turnSeatId === hostSeat, 'host draws first')
  const deckBefore = p0.deck.map((c) => `${c.rank}${c.suit}`).join(',')
  const idxBefore = p0.deckIndex

  const guestDraw = store.drawCard(code, a.session.seatId, a.session.seatToken)
  assert(guestDraw.error === ACK_REASONS.NOT_YOUR_TURN, 'not turn')

  const drawn = store.drawCard(code, hostSeat, hostTok)
  assert(!('error' in drawn), 'host draw')
  const p1 = partyOf(store, code)
  assert(p1.phase === 'awaitComplete', 'await after draw')
  assert(p1.currentCard, 'public card')
  assert(p1.deckIndex === idxBefore + 1, 'index advanced')
  assert(
    p1.deck.map((c) => `${c.rank}${c.suit}`).join(',') === deckBefore,
    'no reshuffle on draw',
  )

  if (p1.needPickTarget) {
    const pick = store.pickTarget(code, hostSeat, hostTok, hostSeat)
    assert(!('error' in pick), 'pick self')
  }
  if (p1.needSetK) {
    const setk = store.setMissKCups(code, hostSeat, hostTok, 3)
    assert(!('error' in setk), 'set k')
  }
  const done = store.completeTurn(code, hostSeat, hostTok)
  assert(!('error' in done), `complete ${done.error || ''}`)
  const p2 = partyOf(store, code)
  assert(p2.turnSeatId === a.session.seatId, 'next 甲')
  assert(p2.history.length >= 1, 'history')
  assert(p2.history.length <= HISTORY_N, 'history cap')

  const pub = publicPersisted(store.get(code))
  assert(pub.room.party.gameId === 'miss-card', 'public gameId')
  assert(pub.room.party.deckIndex === p2.deckIndex, 'public index')
  assert(!pub.partyPrivates, 'no privates leaked')

  store.setMemberConnected(code, a.session.seatId, false)
  const pOff = partyOf(store, code)
  assert(pOff.turnSeatId === a.session.seatId, 'grace keeps turn')
  const skipped = store.skipMissCardIfOffline(code, a.session.seatId)
  assert(skipped, 'grace fire skip')
  const pSkip = partyOf(store, skipped.room.roomCode)
  assert(pSkip.turnSeatId === hostSeat, 'skip to host')
  assert(pSkip.skipNotice?.text, 'skip notice')

  const late = store.joinRoom(code, '晚进')
  assert(!('error' in late), 'late join')
  const pLate = partyOf(store, code)
  assert(
    pLate.deck.map((c) => `${c.rank}${c.suit}`).join(',') === deckBefore,
    'late join no reshuffle',
  )
  assert(pLate.deckIndex === pSkip.deckIndex, 'late join no steal index')

  const end = store.endMissCard(code, hostSeat, hostTok)
  assert(!('error' in end), 'end')
  assert(partyOf(store, code).phase === 'ended', 'ended')
}

{
  const store = createRoomStore()
  const { code, hostSeat, hostTok } = openMiss(store)
  store.joinRoom(code, '甲')
  assert(!('error' in store.startMissCard(code, hostSeat, hostTok)), 'start for empty deck')
  const data = store.get(code)
  data.room.party = createPlayingMissCard(data.room.members, {
    deck: [{ rank: '9', suit: 'spade' }],
  })
  store.set(data)
  store.drawCard(code, hostSeat, hostTok)
  store.completeTurn(code, hostSeat, hostTok)
  assert(partyOf(store, code).phase === 'deckEmpty', 'store deckEmpty')
  const again = store.reshuffleMissCard(code, hostSeat, hostTok)
  assert(!('error' in again), 'reshuffle')
  const p = partyOf(store, code)
  assert(p.phase === 'playing', 'reshuffle playing')
  assert(p.deck.length === 52, 'new 52')
  assert(p.deckIndex === 0, 'index 0')
  assert(!p.roles.missSeatId && !p.roles.psychoSeatId, 'roles cleared')
  assert(Object.keys(p.toiletRemaining || {}).length === 0, 'toilet cleared')
  assert(!p.kPending, 'k cleared')
  assert((p.history || []).length === 0, 'history cleared')
}

console.log('OK test-miss-card')
