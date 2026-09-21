/**
 * Slice B+C: dealing, SeatPrivate privacy, reveal public words, next-round.
 * Run: npm run test:undercover
 */
import { createRoomStore, ACK_REASONS, publicPersisted, partyStubOf } from '../server/roomLogic.mjs'
import {
  WORDBANK,
  allPairs,
  dealRound,
  publicPayloadLeaks,
  undercoverCountFor,
} from '../server/undercover.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

{
  assert(undercoverCountFor(3) === 1, 'n=3 → 1')
  assert(undercoverCountFor(8) === 1, 'n=8 → 1')
  assert(undercoverCountFor(9) === 2, 'n=9 → 2')
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
  assert(party.phase === 'playing', 'playing')
  assert(party.round === 1, 'round 1 on deal')
  assert(party.pairId && !party.pairId.match(/[\u4e00-\u9fff]/), 'opaque pairId')
  assert(party.seats?.every((s) => s.hasWord === true), 'dealt seats hasWord')
  assert(party.seats?.every((s) => !('word' in s) && !('role' in s)), 'public seats flags only')

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
  assert(nextParty.phase === 'playing', 'next-round playing')
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
  const party = partyStubOf(store.get(code).room.party)
  assert(party.gameId === 'truthDare' && party.phase === 'lobby', 'truthDare stays lobby')
}

console.log('OK test-undercover')
