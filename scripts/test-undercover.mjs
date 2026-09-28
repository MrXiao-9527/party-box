/**
 * Slice B+C: dealing, SeatPrivate privacy, reveal public words, next-round.
 * Run: npm run test:undercover
 */
import { createRoomStore, ACK_REASONS, publicPersisted, partyStubOf } from '../server/roomLogic.mjs'
import {
  WORDBANK,
  allPairs,
  checkUndercoverWinner,
  dealRound,
  publicPayloadLeaks,
  settleVoteParty,
  undercoverCountFor,
  VOTE_NOTICE_REVOTE,
  VOTE_NOTICE_TIE_NONE,
} from '../server/undercover.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

{
  assert(undercoverCountFor(3) === 1, 'n=3 → 1')
  assert(undercoverCountFor(8) === 1, 'n=8 → 1')
  assert(undercoverCountFor(9) === 1, 'Q4 n=9 → 1')
  const pairs = allPairs(WORDBANK)
  assert(pairs.length >= 24, `wordbank size ${pairs.length}`)
  assert(WORDBANK.categories.length >= 4, 'categories')
  const ids = new Set(pairs.map((p) => p.id))
  assert(ids.size === pairs.length, 'pair ids unique')
  for (const p of pairs) {
    assert(p.civilian && p.undercover && p.civilian !== p.undercover, `pair ${p.id}`)
  }
}

{
  const seats = ['a', 'b', 'c']
  const dealt = dealRound(seats, WORDBANK, () => 0.1)
  assert(dealt.undercoverCount === 1, 'deal count')
  assert(dealt.privates.length === 3, '3 privates')
  assert(dealt.privates.filter((p) => p.role === 'undercover').length === 1, '1 undercover')
  const words = dealt.privates.map((p) => p.word)
  assert(new Set(words).size === 2, 'two distinct words')
}

{
  const store = createRoomStore()
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats: 8,
    gameId: 'undercover',
  })
  assert(!('error' in created), 'create')
  const code = created.data.room.roomCode
  const hostTok = created.session.seatToken
  assert(hostTok, 'host token')
  store.claimHostSeat(code, created.session.seatId, '桌主')

  const tooFew = store.startUndercover(code, created.session.seatId, hostTok)
  assert(tooFew.error === ACK_REASONS.NEED_THREE_ONLINE, 'need 3')

  const j1 = store.joinRoom(code, '甲')
  const j2 = store.joinRoom(code, '乙')
  assert(!('error' in j1) && !('error' in j2), 'join 2')

  const notHost = store.startUndercover(code, j1.session.seatId, j1.session.seatToken)
  assert(notHost.error === ACK_REASONS.NOT_HOST, 'guest cannot start')

  const badTok = store.startUndercover(code, created.session.seatId, j1.session.seatToken)
  assert(badTok.error === ACK_REASONS.INVALID, 'wrong token cannot start')

  const started = store.startUndercover(code, created.session.seatId, hostTok)
  assert(!('error' in started), `start ${started.error || ''}`)
  assert(started.private?.seatId === created.session.seatId, 'start private is host only')
  assert(started.private?.word && started.private.role, 'host word+role')

  const pub = publicPersisted(started.data)
  const party = partyStubOf(pub.room.party)
  assert(party.phase === 'speaking', 'speaking after deal')
  assert(party.round === 1, 'round 1 on deal')
  assert(party.undercoverCount === 1, 'Q4 undercoverCount 1')
  assert(party.pairId && !party.pairId.match(/[\u4e00-\u9fff]/), 'opaque pairId')
  assert(party.seats?.every((s) => s.hasWord === true), 'dealt seats hasWord')
  assert(party.seats?.every((s) => !('word' in s) && !('role' in s)), 'public seats flags only')
  assert(Array.isArray(party.speakOrder) && party.speakOrder.length === 3, 'speakOrder 3')
  assert(party.speakerSeatId && party.speakOrder.includes(party.speakerSeatId), 'speaker in order')
  assert(Array.isArray(party.spokeSeatIds) && party.spokeSeatIds.length === 0, 'nobody spoke yet')

  const hostWord = started.private.word
  const guestA = store.getSeatPrivate(code, j1.session.seatId, j1.session.seatToken)
  const guestB = store.getSeatPrivate(code, j2.session.seatId, j2.session.seatToken)
  assert(guestA.private?.word && guestB.private?.word, 'guests have words')
  const words = [hostWord, guestA.private.word, guestB.private.word]
  assert(!publicPayloadLeaks(pub, words), `public leak ${publicPayloadLeaks(pub, words)}`)
  assert(!publicPayloadLeaks(started.data.room, words), 'room object leak')

  const peek = store.getSeatPrivate(code, created.session.seatId, j1.session.seatToken)
  assert(peek.private === null, 'guest token cannot peek host')

  const again = store.startUndercover(code, created.session.seatId, hostTok)
  assert(again.error === ACK_REASONS.ALREADY_STARTED, 'no re-deal in B')

  const mid = store.joinRoom(code, '丁')
  assert(!('error' in mid), 'mid-join ok')
  const midParty = partyStubOf(mid.data.room.party)
  const midSeat = midParty.seats?.find((s) => s.seatId === mid.session.seatId)
  assert(midSeat && midSeat.hasWord === false, 'mid-join hasWord false')
  const midPriv = store.getSeatPrivate(code, mid.session.seatId, mid.session.seatToken)
  assert(midPriv.private === null && midPriv.hasWord === false, 'mid-join no private')
  const midPub = publicPersisted(mid.data)
  assert(!publicPayloadLeaks(midPub, words), 'mid-join public still clean')

  {
    const injected = partyStubOf({
      gameId: 'undercover',
      phase: 'playing',
      seats: [{ seatId: 'x', hasWord: true, word: '机密词', role: 'civilian' }],
    })
    assert(
      injected.seats.every((s) => !('word' in s) && !('role' in s)),
      'playing stub strips word/role',
    )
  }

  const guestReveal = store.revealUndercover(
    code,
    j1.session.seatId,
    j1.session.seatToken,
  )
  assert(guestReveal.error === ACK_REASONS.NOT_HOST, 'guest cannot reveal')

  const nextTooSoon = store.nextRoundUndercover(
    code,
    created.session.seatId,
    hostTok,
  )
  assert(nextTooSoon.error === ACK_REASONS.NOT_REVEALED, 'next-round needs reveal')

  const revealed = store.revealUndercover(code, created.session.seatId, hostTok)
  assert(!('error' in revealed), `reveal ${revealed.error || ''}`)
  const revPub = publicPersisted(revealed.data)
  const revParty = partyStubOf(revPub.room.party)
  assert(revParty.phase === 'revealed', 'revealed phase')
  assert(revParty.round === 1, 'round 1')
  const dealtSeats = revParty.seats.filter((s) => s.seatId !== mid.session.seatId)
  assert(dealtSeats.length === 3, '3 dealt seats')
  assert(
    dealtSeats.every((s) => s.hasWord && s.word && (s.role === 'civilian' || s.role === 'undercover')),
    'every dealt seat has public word+role',
  )
  const midReveal = revParty.seats.find((s) => s.seatId === mid.session.seatId)
  assert(midReveal && midReveal.hasWord === false, 'mid-join still no word')
  assert(!midReveal.word && !midReveal.role, 'mid-join no public identity')
  const roles = dealtSeats.map((s) => s.role)
  assert(roles.filter((r) => r === 'undercover').length === 1, '1 undercover revealed')
  const pubWords = dealtSeats.map((s) => s.word)
  assert(new Set(pubWords).size === 2, 'two public words')
  for (const w of words) {
    assert(pubWords.includes(w), `revealed includes ${w}`)
  }

  const againStart = store.startUndercover(code, created.session.seatId, hostTok)
  assert(againStart.error === ACK_REASONS.ALREADY_STARTED, 'no start after reveal')

  const dumpedRev = store.exportAll()
  const storeRev = createRoomStore()
  storeRev.importAll(dumpedRev)
  const restoredRev = partyStubOf(publicPersisted(storeRev.get(code)).room.party)
  assert(restoredRev.phase === 'revealed', 'persist keeps revealed')
  assert(
    restoredRev.seats.filter((s) => s.hasWord).every((s) => s.word && s.role),
    'persisted reveal still has word+role',
  )

  const next = store.nextRoundUndercover(code, created.session.seatId, hostTok)
  assert(!('error' in next), `next-round ${next.error || ''}`)
  const nextPub = publicPersisted(next.data)
  const nextParty = partyStubOf(nextPub.room.party)
  assert(nextParty.phase === 'speaking', 'next-round speaking')
  assert(nextParty.round === 2, 'round 2')
  assert(
    nextParty.seats?.every((s) => s.hasWord === true && !('word' in s) && !('role' in s)),
    'next-round public flags only',
  )
  const nextWords = []
  for (const sess of [
    created.session,
    j1.session,
    j2.session,
    mid.session,
  ]) {
    const priv = store.getSeatPrivate(code, sess.seatId, sess.seatToken)
    assert(priv.private?.word, `${sess.name || sess.seatId} has new word`)
    assert(priv.private.round === 2, 'private round 2')
    nextWords.push(priv.private.word)
  }
  assert(!publicPayloadLeaks(nextPub, nextWords), `next-round public leak ${publicPayloadLeaks(nextPub, nextWords)}`)
  const internals = store.get(code)
  assert(
    Object.values(internals.partyPrivates).every((p) => p.round === 2),
    'previous privates replaced',
  )
  const peekOld = store.getSeatPrivate(code, j1.session.seatId, j1.session.seatToken)
  assert(peekOld.private.round === 2, 'cannot keep previous private')

  const dumped = store.exportAll()
  const store2 = createRoomStore()
  store2.importAll(dumped)
  const restored = store2.getSeatPrivate(code, j1.session.seatId, j1.session.seatToken)
  assert(restored.private?.word === peekOld.private.word, 'persist keeps private')
  const restoredPub = publicPersisted(store2.get(code))
  assert(!publicPayloadLeaks(restoredPub, nextWords), 'imported public clean')
}

{
  const store = createRoomStore()
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats: 8,
    gameId: 'undercover',
  })
  const code = created.data.room.roomCode
  const hostTok = created.session.seatToken
  const hostSeat = created.session.seatId
  store.claimHostSeat(code, hostSeat, '桌主')
  const j1 = store.joinRoom(code, '甲')
  const j2 = store.joinRoom(code, '乙')
  const started = store.startUndercover(code, hostSeat, hostTok)
  assert(!('error' in started), 'ring start')
  const p0 = partyStubOf(publicPersisted(started.data).room.party)
  assert(p0.phase === 'speaking', 'ring speaking')
  assert(p0.undercoverCount === 1, 'ring count 1')
  const firstSpeaker = p0.speakerSeatId
  assert(firstSpeaker === hostSeat, 'first speaker is first seated (host)')
  assert(p0.speakOrder.join(',') === [hostSeat, j1.session.seatId, j2.session.seatId].join(','), 'order = seat order')

  const guestPush = store.speakDoneUndercover(code, j1.session.seatId, j1.session.seatToken)
  assert(guestPush.error === ACK_REASONS.NOT_YOUR_TURN, 'non-speaker guest cannot 说完了')
  const still = partyStubOf(store.get(code).room.party)
  assert(still.speakerSeatId === firstSpeaker, 'refused speak-done does not move')

  const done1 = store.speakDoneUndercover(code, hostSeat, hostTok)
  assert(!('error' in done1), 'host speak-done')
  const p1 = partyStubOf(publicPersisted(done1.data).room.party)
  assert(p1.phase === 'speaking', 'still speaking after first')
  assert(p1.speakerSeatId === j1.session.seatId, 'advanced to 甲')
  assert(p1.spokeSeatIds.includes(hostSeat), 'host marked spoke')
  assert(p1.speakerSeatId !== firstSpeaker, 'speaker moved')

  const hostProxy = store.speakDoneUndercover(code, hostSeat, hostTok)
  assert(!('error' in hostProxy), 'host 代推')
  const p2 = partyStubOf(publicPersisted(hostProxy.data).room.party)
  assert(p2.speakerSeatId === j2.session.seatId, '代推 to 乙')
  assert(p2.spokeSeatIds.includes(j1.session.seatId), '甲 marked spoke')

  store.setMemberConnected(code, j2.session.seatId, false)
  const skipped = partyStubOf(publicPersisted(store.get(code)).room.party)
  assert(skipped.phase === 'voting', 'last online unspoken disconnect → voting')
  assert(skipped.voteRound === 0, 'voteRound 0')
  assert(skipped.votes && Object.keys(skipped.votes).length === 0, 'votes cleared')
  assert(skipped.speakerSeatId == null, 'no speaker in voting')
  const skipWords = [
    started.private.word,
    store.getSeatPrivate(code, j1.session.seatId, j1.session.seatToken).private.word,
    store.getSeatPrivate(code, j2.session.seatId, j2.session.seatToken).private.word,
  ]
  assert(!publicPayloadLeaks(publicPersisted(store.get(code)), skipWords), 'voting public clean')
}

{
  const store = createRoomStore()
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats: 8,
    gameId: 'undercover',
  })
  const code = created.data.room.roomCode
  const hostTok = created.session.seatToken
  const hostSeat = created.session.seatId
  store.claimHostSeat(code, hostSeat, '桌主')
  const j1 = store.joinRoom(code, '甲')
  const j2 = store.joinRoom(code, '乙')
  store.startUndercover(code, hostSeat, hostTok)
  store.speakDoneUndercover(code, hostSeat, hostTok)
  const before = partyStubOf(store.get(code).room.party)
  assert(before.speakerSeatId === j1.session.seatId, '甲 is speaking')
  const speakerBefore = before.speakerSeatId

  store.setMemberConnected(code, j2.session.seatId, false)
  const afterOff = partyStubOf(store.get(code).room.party)
  assert(afterOff.speakerSeatId === speakerBefore, 'non-speaker disconnect does not steal')
  assert(afterOff.phase === 'speaking', 'still speaking')
  store.setMemberConnected(code, j2.session.seatId, true)
  const etBack = partyStubOf(store.get(code).room.party)
  assert(etBack.speakerSeatId === speakerBefore, '乙 rejoin while 甲 speaks does not steal')
  assert(etBack.speakOrder[etBack.speakOrder.length - 1] === j2.session.seatId, '乙 rejoin goes to tail')

  store.setMemberConnected(code, j1.session.seatId, false)
  const afterSkip = partyStubOf(store.get(code).room.party)
  assert(afterSkip.speakerSeatId === j2.session.seatId || afterSkip.phase === 'voting' || afterSkip.speakerSeatId === hostSeat, 'skip disconnected speaker')
  assert(afterSkip.speakerSeatId !== j1.session.seatId, 'skipped 甲 is not speaker')
  assert(!(afterSkip.spokeSeatIds || []).includes(j1.session.seatId), 'skip does not mark spoke')
  const speakerWhileGone = afterSkip.speakerSeatId

  store.setMemberConnected(code, j1.session.seatId, true)
  const rejoined = partyStubOf(store.get(code).room.party)
  assert(rejoined.phase === 'speaking', 'rejoin stays speaking')
  assert(rejoined.speakerSeatId === speakerWhileGone, 'Q5 rejoin does not steal speaker')
  assert(rejoined.speakOrder[rejoined.speakOrder.length - 1] === j1.session.seatId, 'Q5 rejoin appends tail')

  const mid = store.joinRoom(code, '丁')
  const midParty = partyStubOf(mid.data.room.party)
  assert(!(midParty.speakOrder || []).includes(mid.session.seatId), 'late join without word stays off ring')
  assert(midParty.speakerSeatId === rejoined.speakerSeatId, 'late join does not steal')

  const leftover = [hostSeat, j1.session.seatId, j2.session.seatId].filter(
    (id) => id === midParty.speakerSeatId || !(midParty.spokeSeatIds || []).includes(id),
  )
  let cur = partyStubOf(store.get(code).room.party)
  let guard = 0
  while (cur.phase === 'speaking' && guard++ < 8) {
    const r = store.speakDoneUndercover(code, hostSeat, hostTok)
    assert(!('error' in r), `drain ${guard}`)
    cur = partyStubOf(r.data.room.party)
  }
  assert(cur.phase === 'voting', 'drain ring → voting')
  assert(cur.voteRound === 0, 'auto voting voteRound=0')
  assert(Object.keys(cur.votes || {}).length === 0, 'auto voting empty votes')
  void leftover
}

{
  const nine = dealRound(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], WORDBANK, () => 0.2)
  assert(nine.undercoverCount === 1, 'deal n=9 still 1')
  assert(nine.privates.filter((p) => p.role === 'undercover').length === 1, 'one undercover at n=9')
}

{
  const playing = partyStubOf({
    gameId: 'undercover',
    phase: 'playing',
    pairId: 'x',
    seats: [{ seatId: 'a', hasWord: true }],
  })
  assert(playing.phase === 'playing', 'old playing kept')
  assert(playing.speakerSeatId == null, 'old playing does not invent speaker')
  assert(!playing.speakOrder, 'old playing no empty speakOrder')
}

{
  const store = createRoomStore()
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats: 8,
    gameId: 'truthDare',
  })
  assert(!('error' in created), 'truthDare create')
  const code = created.data.room.roomCode
  store.claimHostSeat(code, created.session.seatId, '桌主')
  store.joinRoom(code, '甲')
  store.joinRoom(code, '乙')
  const started = store.startUndercover(
    code,
    created.session.seatId,
    created.session.seatToken,
  )
  assert(started.error === ACK_REASONS.INVALID, 'truthDare cannot start-undercover')
  const spoken = store.speakDoneUndercover(
    code,
    created.session.seatId,
    created.session.seatToken,
  )
  assert(spoken.error === ACK_REASONS.INVALID, 'truthDare cannot speak-done')
  const voted = store.castVoteUndercover(
    code,
    created.session.seatId,
    created.session.seatToken,
    'abstain',
  )
  assert(voted.error === ACK_REASONS.INVALID, 'truthDare cannot cast-vote')
  const party = partyStubOf(store.get(code).room.party)
  assert(party.gameId === 'truthDare' && party.phase === 'drawing', 'truthDare stays drawing')
}

{
  const priv3 = {
    u: { role: 'undercover' },
    a: { role: 'civilian' },
    b: { role: 'civilian' },
  }
  assert(checkUndercoverWinner(['u'], priv3, ['a', 'b']) === 'civilian', '3p u out → civ')
  assert(checkUndercoverWinner(['a'], priv3, ['u', 'b']) === 'undercover', '3p c out → uc')
  assert(checkUndercoverWinner([], priv3, ['u', 'a', 'b']) === null, '3p none')

  const priv4 = {
    u: { role: 'undercover' },
    a: { role: 'civilian' },
    b: { role: 'civilian' },
    c: { role: 'civilian' },
  }
  assert(checkUndercoverWinner(['a'], priv4, ['u', 'b', 'c']) === null, '4p first c')
  assert(checkUndercoverWinner(['a', 'b'], priv4, ['u', 'c']) === 'undercover', '4p two c')
  assert(checkUndercoverWinner(['u'], priv4, ['a', 'b', 'c']) === 'civilian', '4p u out')

  const priv5 = {
    u: { role: 'undercover' },
    a: { role: 'civilian' },
    b: { role: 'civilian' },
    c: { role: 'civilian' },
    d: { role: 'civilian' },
  }
  assert(checkUndercoverWinner(['a', 'b'], priv5, ['u', 'c', 'd']) === null, '5p two c')
  assert(checkUndercoverWinner(['a', 'b', 'c'], priv5, ['u', 'd']) === 'undercover', '5p three c')

  const members = ['a', 'b', 'c'].map((seatId) => ({
    seatId,
    connected: true,
  }))
  const voting = {
    phase: 'voting',
    gameId: 'undercover',
    seats: ['a', 'b', 'c'].map((seatId) => ({ seatId, hasWord: true })),
    speakOrder: ['a', 'b', 'c'],
    voteRound: 0,
    votes: { a: 'abstain', b: 'abstain', c: 'abstain' },
    eliminatedSeatIds: [],
  }
  const revote = settleVoteParty(voting, members, priv3)
  assert(revote.phase === 'voting' && revote.voteRound === 1, 'all abstain → revote')
  assert(revote.voteNotice === VOTE_NOTICE_REVOTE, 'revote copy')
  assert(Object.keys(revote.votes || {}).length === 0, 'revote clears votes')
  const second = settleVoteParty(
    { ...revote, votes: { a: 'b', b: 'c', c: 'a' } },
    members,
    priv3,
  )
  assert(second.phase === 'speaking', 'second tie → speaking')
  assert(second.voteNotice === VOTE_NOTICE_TIE_NONE, 'tie-none copy')
  assert(!(second.eliminatedSeatIds || []).length, 'second tie nobody out')
}

{
  const notice = partyStubOf({
    gameId: 'undercover',
    phase: 'voting',
    voteRound: 1,
    voteNotice: VOTE_NOTICE_REVOTE,
    eliminatedSeatIds: ['x'],
    votes: { a: 'abstain', b: 'c' },
    seats: [
      { seatId: 'x', hasWord: true, word: '机密词', role: 'civilian' },
      { seatId: 'a', hasWord: true },
    ],
  })
  assert(notice.voteNotice === VOTE_NOTICE_REVOTE, 'stub keeps revote copy')
  assert(notice.seats.find((s) => s.seatId === 'x').alive === false, 'elim alive false')
  assert(notice.seats.find((s) => s.seatId === 'a').alive === true, 'alive true')
  assert(
    notice.seats.every((s) => !('word' in s) && !('role' in s)),
    'voting stub strips word/role',
  )
}

function drainToVoting(store, code, hostSeat, hostTok) {
  let cur = partyStubOf(store.get(code).room.party)
  let guard = 0
  while (cur.phase === 'speaking' && guard++ < 16) {
    const r = store.speakDoneUndercover(code, hostSeat, hostTok)
    assert(!('error' in r), `drain ${guard} ${r.error || ''}`)
    cur = partyStubOf(r.data.room.party)
  }
  assert(cur.phase === 'voting', 'drain → voting')
  return cur
}

{
  const store = createRoomStore()
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats: 8,
    gameId: 'undercover',
  })
  const code = created.data.room.roomCode
  const hostTok = created.session.seatToken
  const hostSeat = created.session.seatId
  store.claimHostSeat(code, hostSeat, '桌主')
  const j1 = store.joinRoom(code, '甲')
  const j2 = store.joinRoom(code, '乙')
  store.startUndercover(code, hostSeat, hostTok)
  drainToVoting(store, code, hostSeat, hostTok)

  const mid = store.joinRoom(code, '丁')
  const midVote = store.castVoteUndercover(
    code,
    mid.session.seatId,
    mid.session.seatToken,
    'abstain',
  )
  assert(midVote.error === ACK_REASONS.NOT_ALIVE_VOTER, 'late join cannot vote')

  const selfVote = store.castVoteUndercover(code, hostSeat, hostTok, hostSeat)
  assert(selfVote.error === ACK_REASONS.BAD_VOTE_TARGET, 'no self vote')

  const first = store.castVoteUndercover(code, hostSeat, hostTok, j1.session.seatId)
  assert(!('error' in first), 'host vote')
  const overwrite = store.castVoteUndercover(code, hostSeat, hostTok, 'abstain')
  assert(!('error' in overwrite), 'overwrite own vote')
  let p = partyStubOf(publicPersisted(overwrite.data).room.party)
  assert(p.phase === 'voting', 'not settled after one vote')
  assert(p.votes[hostSeat] === 'abstain', 'overwrite to abstain')

  store.castVoteUndercover(code, j1.session.seatId, j1.session.seatToken, 'abstain')
  const last = store.castVoteUndercover(
    code,
    j2.session.seatId,
    j2.session.seatToken,
    'abstain',
  )
  assert(!('error' in last), 'third abstain')
  p = partyStubOf(publicPersisted(last.data).room.party)
  assert(p.phase === 'voting' && p.voteRound === 1, 'Q1 first tie → revote')
  assert(p.voteNotice === VOTE_NOTICE_REVOTE, 'revote notice public')
  assert(Object.keys(p.votes || {}).length === 0, 'revote empty box')
  const words = [
    store.getSeatPrivate(code, hostSeat, hostTok).private.word,
    store.getSeatPrivate(code, j1.session.seatId, j1.session.seatToken).private.word,
    store.getSeatPrivate(code, j2.session.seatId, j2.session.seatToken).private.word,
  ]
  assert(!publicPayloadLeaks(publicPersisted(last.data), words), 'revote public clean')

  store.castVoteUndercover(code, hostSeat, hostTok, j1.session.seatId)
  store.castVoteUndercover(code, j1.session.seatId, j1.session.seatToken, j2.session.seatId)
  const tie2 = store.castVoteUndercover(
    code,
    j2.session.seatId,
    j2.session.seatToken,
    hostSeat,
  )
  p = partyStubOf(publicPersisted(tie2.data).room.party)
  assert(p.phase === 'speaking', 'second tie → speaking')
  assert(p.voteNotice === VOTE_NOTICE_TIE_NONE, '无人出局 copy')
  assert(!(p.eliminatedSeatIds || []).length, 'nobody out')
  assert(p.speakerSeatId, 'next ring has speaker')
}

{
  const store = createRoomStore()
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats: 8,
    gameId: 'undercover',
  })
  const code = created.data.room.roomCode
  const hostTok = created.session.seatToken
  const hostSeat = created.session.seatId
  store.claimHostSeat(code, hostSeat, '桌主')
  const j1 = store.joinRoom(code, '甲')
  const j2 = store.joinRoom(code, '乙')
  store.startUndercover(code, hostSeat, hostTok)
  drainToVoting(store, code, hostSeat, hostTok)

  store.castVoteUndercover(code, hostSeat, hostTok, j1.session.seatId)
  store.castVoteUndercover(code, j1.session.seatId, j1.session.seatToken, 'abstain')
  store.setMemberConnected(code, j2.session.seatId, false)
  const settled = partyStubOf(publicPersisted(store.get(code)).room.party)
  assert(settled.phase === 'revealed', 'offline last voter abstains → settle')
  assert(settled.eliminatedSeatIds.includes(j1.session.seatId), 'unique top out')
  assert(settled.winner === 'civilian' || settled.winner === 'undercover', '3p unique → win')
  const outSeat = settled.seats.find((s) => s.seatId === j1.session.seatId)
  assert(outSeat && outSeat.alive === false, 'out seat alive false')
  assert(outSeat.word && outSeat.role, 'reveal writes word+role')
  const words = settled.seats.filter((s) => s.word).map((s) => s.word)
  const pub = publicPersisted(store.get(code))
  assert(pub.room.party.phase === 'revealed', 'persisted reveal')
  assert(settled.seats.filter((s) => s.role === 'undercover').length === 1, 'one uc public')
  void words

  store.setMemberConnected(code, j2.session.seatId, true)
  const guestNext = store.nextRoundUndercover(code, j1.session.seatId, j1.session.seatToken)
  assert(guestNext.error === ACK_REASONS.NOT_HOST, 'guest cannot 再来一局')
  const next = store.nextRoundUndercover(code, hostSeat, hostTok)
  assert(!('error' in next), 'host 再来一局')
  const np = partyStubOf(publicPersisted(next.data).room.party)
  assert(np.phase === 'speaking', '再来一局 speaking')
  assert(np.round === 2, 'round++')
  assert(!(np.eliminatedSeatIds || []).length, 'clears elim')
  assert(!np.winner, 'clears winner')
  assert(np.seats.every((s) => s.alive !== false && !('word' in s)), 'new deal public clean flags')
}

{
  const store = createRoomStore()
  const created = store.createEmptyHostRoom({
    mode: 'partyGame',
    maxSeats: 8,
    gameId: 'undercover',
  })
  const code = created.data.room.roomCode
  const hostTok = created.session.seatToken
  const hostSeat = created.session.seatId
  store.claimHostSeat(code, hostSeat, '桌主')
  const j1 = store.joinRoom(code, '甲')
  const j2 = store.joinRoom(code, '乙')
  const j3 = store.joinRoom(code, '丙')
  store.startUndercover(code, hostSeat, hostTok)
  drainToVoting(store, code, hostSeat, hostTok)
  const privates = store.get(code).partyPrivates
  const civId = Object.values(privates).find((p) => p.role === 'civilian').seatId
  const voters = [created.session, j1.session, j2.session, j3.session]
  for (const sess of voters) {
    const target = sess.seatId === civId
      ? voters.find((s) => s.seatId !== civId).seatId
      : civId
    const r = store.castVoteUndercover(code, sess.seatId, sess.seatToken, target)
    assert(!('error' in r), `4p vote ${sess.seatId}`)
  }
  const p = partyStubOf(publicPersisted(store.get(code)).room.party)
  const ucStillIn = Object.values(privates).some(
    (x) => x.role === 'undercover' && x.seatId !== civId,
  )
  if (ucStillIn && p.phase === 'speaking') {
    assert((p.eliminatedSeatIds || []).includes(civId), '4p civ out stays speaking')
    assert(!p.winner, 'no winner yet')
    assert(!p.seats.some((s) => 'word' in s || 'role' in s), 'continue public no words')
    assert(p.speakerSeatId !== civId, 'elim not speaker')
    assert(!(p.speakOrder || []).includes(civId), 'elim off ring')
    drainToVoting(store, code, hostSeat, hostTok)
    const outSess = voters.find((s) => s.seatId === civId)
    const outVote = store.castVoteUndercover(
      code,
      civId,
      outSess.seatToken,
      'abstain',
    )
    assert(outVote.error === ACK_REASONS.NOT_ALIVE_VOTER, 'eliminated cannot vote')
  } else {
    assert(p.phase === 'revealed', '4p unique that hits uc → reveal')
  }
}

console.log('OK test-undercover')
