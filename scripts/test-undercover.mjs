/**
 * Slice B: dealing + SeatPrivate privacy (public snapshot has no words).
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

  const dumped = store.exportAll()
  const store2 = createRoomStore()
  store2.importAll(dumped)
  const restored = store2.getSeatPrivate(code, j1.session.seatId, j1.session.seatToken)
  assert(restored.private?.word === guestA.private.word, 'persist keeps private')
  const restoredPub = publicPersisted(store2.get(code))
  assert(!publicPayloadLeaks(restoredPub, words), 'imported public clean')
}

console.log('OK test-undercover')
