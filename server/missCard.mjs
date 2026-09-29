/**
 * Miss-card (十三钗) — relay-authoritative deck, turn ring, and A–K handlers.
 * Independent of truthDare / undercover. Shuffle lives only here.
 */

export const DISCONNECT_GRACE_MS = 8000
export const HISTORY_N = 5
export const DECK_SIZE = 52
export const MAX_K_CUPS = 99

export const RANKS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
]
export const SUITS = ['spade', 'heart', 'club', 'diamond']

/** Classic table (PRD v0.2 §5). Self-authored; not an in-room editor. */
export const COMMANDS = {
  A: {
    rank: 'A',
    name: '指定喝',
    instruction: '抽牌人指定一人喝一杯（可点自己）。只可点当前在线席。',
    kind: 'pick',
  },
  2: {
    rank: '2',
    name: '小姐',
    instruction: '抽牌人成为「小姐」。他人输酒可叫小姐陪喝。下一张 2 顶替持有人。',
    kind: 'role',
  },
  3: {
    rank: '3',
    name: '逛三园',
    instruction: '抽牌人先说一个品类，众人轮流接龙；接不上或重复者喝。',
    kind: 'prompt',
  },
  4: {
    rank: '4',
    name: '摸鼻子',
    instruction: '任何人可随时摸鼻子，最后才模仿的人喝。',
    kind: 'prompt',
  },
  5: {
    rank: '5',
    name: '照相机',
    instruction: '有人喊「定格」后，还在动的人喝。',
    kind: 'prompt',
  },
  6: {
    rank: '6',
    name: '扭一扭',
    instruction: '递增「风吹柳树扭一扭」口令接龙，接不上或说错者喝。',
    kind: 'prompt',
  },
  7: {
    rank: '7',
    name: '逢7过',
    instruction: '从抽牌人起数数；逢 7 的倍数或含 7 要说「过」，说错者喝。',
    kind: 'prompt',
  },
  8: {
    rank: '8',
    name: '厕所牌',
    instruction: '获得 1 次上厕所权。徽章显示剩余次数，用完即消失。',
    kind: 'toilet',
  },
  9: {
    rank: '9',
    name: '自喝',
    instruction: '抽牌人自己喝一杯。',
    kind: 'prompt',
  },
  10: {
    rank: '10',
    name: '神经病',
    instruction: '抽牌人成为「神经病」。他人不可与其对话，违者喝。下一张 10 顶替。',
    kind: 'role',
  },
  J: {
    rank: 'J',
    name: '左边喝',
    instruction: '左邻（席位环上一在线，跳过离线）喝一杯。无人邻座则自喝。',
    kind: 'neighbor',
  },
  Q: {
    rank: 'Q',
    name: '右边喝',
    instruction: '右邻（席位环下一在线，跳过离线）喝一杯。无人邻座则自喝。',
    kind: 'neighbor',
  },
  K: {
    rank: 'K',
    name: '定量牌',
    instruction:
      '首次：自喝一杯，并设定「下个 K 喝几杯」。再次：执行该杯数，之后可重定。',
    kind: 'k',
  },
}

export const COPY = {
  skipOffline: (nick) => `${nick} 已离线，跳过`,
  skipHost: '已跳过当前抽牌人',
  noNeighbor: '无人邻座，请自喝',
}

export const MISS_ACK = {
  NEED_TWO_ONLINE: '至少 2 人在线才能开始',
  NEED_PICK_TARGET: '请先指定一人',
  NEED_SET_K: '请先设定杯数',
  DECK_EMPTY: '牌已抽完',
  PICK_ONLINE: '只能指定在线的人',
  NOT_STARTED: '尚未开局',
}

export function isMissCardPhase(raw) {
  return (
    raw === 'lobby' ||
    raw === 'playing' ||
    raw === 'awaitComplete' ||
    raw === 'deckEmpty' ||
    raw === 'ended'
  )
}

export function isMissCardRank(raw) {
  return typeof raw === 'string' && Object.hasOwn(COMMANDS, raw)
}

export function isMissCardSuit(raw) {
  return raw === 'spade' || raw === 'heart' || raw === 'club' || raw === 'diamond'
}

export function commandOf(rank) {
  return isMissCardRank(rank) ? COMMANDS[rank] : null
}

export function buildDeck() {
  /** @type {{ rank: string, suit: string }[]} */
  const deck = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit })
    }
  }
  return deck
}

export function shuffleDeck(deck, rng = Math.random) {
  const out = deck.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

export function cardOf(raw) {
  if (!raw || typeof raw !== 'object') return null
  const rank = isMissCardRank(raw.rank) ? raw.rank : null
  const suit = isMissCardSuit(raw.suit) ? raw.suit : null
  if (!rank || !suit) return null
  return { rank, suit }
}

export function onlineMembers(members = []) {
  return (members || []).filter(
    (m) => m && typeof m.seatId === 'string' && m.seatId && m.connected,
  )
}

export function firstOnlineSeatId(members = []) {
  return onlineMembers(members)[0]?.seatId || null
}

export function memberBySeat(members, seatId) {
  if (!seatId) return null
  return (members || []).find((m) => m && m.seatId === seatId) || null
}

export function nicknameOf(members, seatId) {
  const m = memberBySeat(members, seatId)
  return m && typeof m.name === 'string' ? m.name.trim() : ''
}

/** Next online seat after current, wrapping; full seated order. */
export function nextOnlineSeatId(members = [], currentSeatId = '') {
  const seats = (members || []).filter(
    (m) => m && typeof m.seatId === 'string' && m.seatId,
  )
  const online = seats.filter((m) => m.connected)
  if (!online.length) return null
  if (!currentSeatId) return online[0].seatId
  const start = seats.findIndex((m) => m.seatId === currentSeatId)
  const from = start === -1 ? -1 : start
  for (let i = 1; i <= seats.length; i++) {
    const m = seats[(from + i + seats.length) % seats.length]
    if (m.connected) return m.seatId
  }
  return online[0].seatId
}

/** left = previous online (skip self), right = next. Solo → null. */
export function neighborSeatId(members = [], currentSeatId = '', side = 'left') {
  const seats = (members || []).filter(
    (m) => m && typeof m.seatId === 'string' && m.seatId,
  )
  const online = seats.filter((m) => m.connected)
  if (online.length <= 1) return null
  const start = seats.findIndex((m) => m.seatId === currentSeatId)
  if (start === -1) return online.find((m) => m.seatId !== currentSeatId)?.seatId || null
  const dir = side === 'left' ? -1 : 1
  for (let i = 1; i <= seats.length; i++) {
    const m = seats[(start + dir * i + seats.length * 8) % seats.length]
    if (m.connected && m.seatId !== currentSeatId) return m.seatId
  }
  return null
}

function toiletMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !k.trim()) continue
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isInteger(n) || n <= 0) continue
    out[k.trim()] = n
  }
  return out
}

function historyOf(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const card = cardOf(item)
    const seatId = typeof item.seatId === 'string' ? item.seatId.trim() : ''
    const cmd = commandOf(card?.rank || item.rank)
    if (!seatId || !card || !cmd) continue
    const at = typeof item.at === 'number' ? item.at : Number(item.at)
    const row = {
      seatId,
      rank: card.rank,
      suit: card.suit,
      commandName: cmd.name,
      at: Number.isFinite(at) && at > 0 ? at : 0,
    }
    const target =
      typeof item.targetSeatId === 'string' && item.targetSeatId.trim()
        ? item.targetSeatId.trim()
        : null
    if (target) row.targetSeatId = target
    out.push(row)
    if (out.length >= HISTORY_N) break
  }
  return out
}

function skipNoticeOf(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  const at = typeof raw.at === 'number' ? raw.at : Number(raw.at)
  if (!text) return null
  return { text, at: Number.isFinite(at) && at > 0 ? at : 0 }
}

function kPendingOf(raw) {
  if (!raw || typeof raw !== 'object') return null
  const cups = typeof raw.cups === 'number' ? raw.cups : Number(raw.cups)
  if (!Number.isInteger(cups) || cups <= 0) return null
  return { cups: Math.min(cups, MAX_K_CUPS) }
}

export function remainingCount(party) {
  const deck = Array.isArray(party?.deck) ? party.deck : []
  const idx = Number.isInteger(party?.deckIndex) ? party.deckIndex : 0
  return Math.max(0, deck.length - idx)
}

export function emptyMissCardParty() {
  return {
    gameId: 'miss-card',
    phase: 'lobby',
    deck: [],
    deckIndex: 0,
    currentCard: null,
    turnSeatId: null,
    roles: { missSeatId: null, psychoSeatId: null },
    toiletRemaining: {},
    kPending: null,
    history: [],
    needPickTarget: false,
    targetSeatId: null,
    resolvedNeighbor: null,
    needSetK: false,
    kExecuteCups: null,
    kSetThisTurn: false,
    skipNotice: null,
  }
}

export function missCardStubOf(src) {
  const base = emptyMissCardParty()
  if (!src || typeof src !== 'object') return base
  const phase = isMissCardPhase(src.phase) ? src.phase : 'lobby'
  const deck = Array.isArray(src.deck)
    ? src.deck.map(cardOf).filter(Boolean)
    : []
  const deckIndexRaw =
    typeof src.deckIndex === 'number' ? src.deckIndex : Number(src.deckIndex)
  const deckIndex =
    Number.isInteger(deckIndexRaw) && deckIndexRaw >= 0 ? deckIndexRaw : 0
  const rolesSrc = src.roles && typeof src.roles === 'object' ? src.roles : src
  const missSeatId =
    typeof rolesSrc.missSeatId === 'string' && rolesSrc.missSeatId.trim()
      ? rolesSrc.missSeatId.trim()
      : null
  const psychoSeatId =
    typeof rolesSrc.psychoSeatId === 'string' && rolesSrc.psychoSeatId.trim()
      ? rolesSrc.psychoSeatId.trim()
      : null
  const neighbor =
    src.resolvedNeighbor && typeof src.resolvedNeighbor === 'object'
      ? {
          side:
            src.resolvedNeighbor.side === 'right' ? 'right' : 'left',
          seatId:
            typeof src.resolvedNeighbor.seatId === 'string' &&
            src.resolvedNeighbor.seatId.trim()
              ? src.resolvedNeighbor.seatId.trim()
              : null,
        }
      : null
  const kExecuteRaw =
    typeof src.kExecuteCups === 'number'
      ? src.kExecuteCups
      : Number(src.kExecuteCups)
  const stub = {
    gameId: 'miss-card',
    phase,
    deck,
    deckIndex: Math.min(deckIndex, deck.length),
    currentCard: cardOf(src.currentCard),
    turnSeatId:
      typeof src.turnSeatId === 'string' && src.turnSeatId.trim()
        ? src.turnSeatId.trim()
        : null,
    roles: { missSeatId, psychoSeatId },
    toiletRemaining: toiletMap(src.toiletRemaining),
    kPending: kPendingOf(src.kPending),
    history: historyOf(src.history),
    needPickTarget: !!src.needPickTarget,
    targetSeatId:
      typeof src.targetSeatId === 'string' && src.targetSeatId.trim()
        ? src.targetSeatId.trim()
        : null,
    resolvedNeighbor: neighbor,
    needSetK: !!src.needSetK,
    kExecuteCups:
      Number.isInteger(kExecuteRaw) && kExecuteRaw > 0 ? kExecuteRaw : null,
    kSetThisTurn: !!src.kSetThisTurn,
    skipNotice: skipNoticeOf(src.skipNotice),
  }
  return stub
}

export function createPlayingMissCard(members, { rng = Math.random, deck } = {}) {
  const cards = Array.isArray(deck) && deck.length
    ? deck.map(cardOf).filter(Boolean)
    : shuffleDeck(buildDeck(), rng)
  return {
    ...emptyMissCardParty(),
    phase: 'playing',
    deck: cards,
    deckIndex: 0,
    turnSeatId: firstOnlineSeatId(members),
  }
}

function bumpToilet(map, seatId) {
  const next = { ...map }
  next[seatId] = (next[seatId] || 0) + 1
  return next
}

function prependHistory(history, entry) {
  return historyOf([entry, ...historyOf(history)])
}

function patchHistoryTarget(history, seatId, rank, targetSeatId) {
  const list = historyOf(history)
  if (!list.length) return list
  const head = list[0]
  if (head.seatId !== seatId || head.rank !== rank) return list
  const next = { ...head }
  if (targetSeatId) next.targetSeatId = targetSeatId
  else delete next.targetSeatId
  return [next, ...list.slice(1)]
}

function applyRank(party, members, drawerSeatId, card, now) {
  const cmd = commandOf(card.rank)
  const historyEntry = {
    seatId: drawerSeatId,
    rank: card.rank,
    suit: card.suit,
    commandName: cmd?.name || card.rank,
    at: now,
  }
  let next = {
    ...party,
    currentCard: card,
    phase: 'awaitComplete',
    needPickTarget: false,
    targetSeatId: null,
    resolvedNeighbor: null,
    needSetK: false,
    kExecuteCups: null,
    kSetThisTurn: false,
    skipNotice: null,
  }

  if (card.rank === 'A') {
    next.needPickTarget = true
  } else if (card.rank === '2') {
    next.roles = { ...next.roles, missSeatId: drawerSeatId }
  } else if (card.rank === '10') {
    next.roles = { ...next.roles, psychoSeatId: drawerSeatId }
  } else if (card.rank === '8') {
    next.toiletRemaining = bumpToilet(next.toiletRemaining, drawerSeatId)
  } else if (card.rank === 'J' || card.rank === 'Q') {
    const side = card.rank === 'J' ? 'left' : 'right'
    const seatId = neighborSeatId(members, drawerSeatId, side)
    next.resolvedNeighbor = { side, seatId }
    if (seatId) historyEntry.targetSeatId = seatId
  } else if (card.rank === 'K') {
    if (!next.kPending) {
      next.needSetK = true
    } else {
      next.kExecuteCups = next.kPending.cups
    }
  }

  next.history = prependHistory(next.history, historyEntry)
  return next
}

function clearTurnEphemeral(party) {
  return {
    ...party,
    currentCard: null,
    needPickTarget: false,
    targetSeatId: null,
    resolvedNeighbor: null,
    needSetK: false,
    kExecuteCups: null,
    kSetThisTurn: false,
  }
}

function afterAdvance(party, _members, nextSeatId) {
  const empty = remainingCount(party) <= 0
  if (empty) {
    return {
      ...clearTurnEphemeral(party),
      phase: 'deckEmpty',
      turnSeatId: nextSeatId,
    }
  }
  return {
    ...clearTurnEphemeral(party),
    phase: 'playing',
    turnSeatId: nextSeatId,
  }
}

export function canDraw(party, members, fromSeatId) {
  if (party.phase !== 'playing') return MISS_ACK.NOT_STARTED
  if (remainingCount(party) <= 0) return MISS_ACK.DECK_EMPTY
  if (!fromSeatId || fromSeatId !== party.turnSeatId) return '还没轮到你'
  const m = memberBySeat(members, fromSeatId)
  if (!m || !m.connected) return '还没轮到你'
  return null
}

export function drawCard(party, members, fromSeatId, now = Date.now()) {
  const err = canDraw(party, members, fromSeatId)
  if (err) return { error: err }
  const card = party.deck[party.deckIndex]
  if (!card) return { error: MISS_ACK.DECK_EMPTY }
  const drawn = applyRank(
    { ...party, deckIndex: party.deckIndex + 1 },
    members,
    fromSeatId,
    card,
    now,
  )
  return { party: drawn }
}

export function pickTarget(party, members, fromSeatId, targetSeatId) {
  if (party.phase !== 'awaitComplete') return { error: '操作无效' }
  if (!party.currentCard || party.currentCard.rank !== 'A') {
    return { error: '操作无效' }
  }
  if (fromSeatId !== party.turnSeatId) return { error: '还没轮到你' }
  const drawer = memberBySeat(members, fromSeatId)
  if (!drawer || !drawer.connected) return { error: '还没轮到你' }
  const target = memberBySeat(members, targetSeatId)
  if (!target || !target.connected) return { error: MISS_ACK.PICK_ONLINE }
  return {
    party: {
      ...party,
      needPickTarget: false,
      targetSeatId,
      history: patchHistoryTarget(
        party.history,
        fromSeatId,
        'A',
        targetSeatId,
      ),
    },
  }
}

function parseCups(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n <= 0 || n > MAX_K_CUPS) return null
  return n
}

export function setKCups(party, fromSeatId, cupsRaw) {
  if (party.phase !== 'awaitComplete') return { error: '操作无效' }
  if (!party.currentCard || party.currentCard.rank !== 'K') {
    return { error: '操作无效' }
  }
  if (fromSeatId !== party.turnSeatId) return { error: '还没轮到你' }
  const cups = parseCups(cupsRaw)
  if (cups == null) return { error: '请输入正整数' }
  return {
    party: {
      ...party,
      kPending: { cups },
      needSetK: false,
      kSetThisTurn: true,
    },
  }
}

export function applyK(party, fromSeatId) {
  if (party.phase !== 'awaitComplete') return { error: '操作无效' }
  if (!party.currentCard || party.currentCard.rank !== 'K') {
    return { error: '操作无效' }
  }
  if (fromSeatId !== party.turnSeatId) return { error: '还没轮到你' }
  if (party.kExecuteCups == null) return { error: '操作无效' }
  return {
    party: {
      ...party,
      kPending: null,
      kExecuteCups: party.kExecuteCups,
      kSetThisTurn: true,
    },
  }
}

export function completeErr(party) {
  if (party.phase !== 'awaitComplete') return '操作无效'
  if (!party.currentCard) return '操作无效'
  if (party.needPickTarget || (party.currentCard.rank === 'A' && !party.targetSeatId)) {
    return MISS_ACK.NEED_PICK_TARGET
  }
  if (party.needSetK) return MISS_ACK.NEED_SET_K
  return null
}

export function completeTurn(party, members) {
  const err = completeErr(party)
  if (err) return { error: err }
  let next = party
  if (party.currentCard?.rank === 'K' && party.kExecuteCups != null && !party.kSetThisTurn) {
    next = { ...next, kPending: null }
  }
  const nextSeat = nextOnlineSeatId(members, party.turnSeatId)
  return { party: afterAdvance(next, members, nextSeat) }
}

function skipNotice(text, at = Date.now()) {
  return { text, at }
}

export function skipDrawerTurn(party, members, { reason, nick } = {}) {
  if (party.phase !== 'playing' && party.phase !== 'awaitComplete') {
    return { error: '操作无效' }
  }
  const from = party.turnSeatId
  const nextSeat = nextOnlineSeatId(members, from)
  const noticeText =
    reason === 'offline'
      ? COPY.skipOffline(nick || '该席')
      : COPY.skipHost
  if (party.phase === 'playing') {
    return {
      party: {
        ...party,
        turnSeatId: nextSeat,
        skipNotice: skipNotice(noticeText),
      },
    }
  }
  const advanced = afterAdvance(party, members, nextSeat)
  return {
    party: {
      ...advanced,
      skipNotice: skipNotice(noticeText),
    },
  }
}

export function skipIfTurnOffline(party, members, seatId) {
  if (party.gameId !== 'miss-card') return null
  if (party.phase !== 'playing' && party.phase !== 'awaitComplete') return null
  if (!seatId || party.turnSeatId !== seatId) return null
  const m = memberBySeat(members, seatId)
  if (m && m.connected) return null
  const nick = nicknameOf(members, seatId) || '该席'
  return skipDrawerTurn(party, members, { reason: 'offline', nick })
}

export function spendToilet(party, fromSeatId) {
  const n = party.toiletRemaining?.[fromSeatId] || 0
  if (n <= 0) return { error: '操作无效' }
  const toiletRemaining = { ...party.toiletRemaining }
  if (n <= 1) delete toiletRemaining[fromSeatId]
  else toiletRemaining[fromSeatId] = n - 1
  return { party: { ...party, toiletRemaining } }
}

export function endGame(party) {
  if (
    party.phase !== 'playing' &&
    party.phase !== 'awaitComplete' &&
    party.phase !== 'deckEmpty'
  ) {
    return { error: '操作无效' }
  }
  return {
    party: {
      ...party,
      phase: 'ended',
      currentCard: party.currentCard,
    },
  }
}

export function assignTurnIfVacant(party, members, preferredSeatId) {
  if (party.gameId !== 'miss-card') return party
  if (party.phase !== 'playing' && party.phase !== 'awaitComplete') return party
  if (party.turnSeatId) {
    const holder = memberBySeat(members, party.turnSeatId)
    if (holder && holder.connected) return party
    return party
  }
  const next =
    (preferredSeatId && memberBySeat(members, preferredSeatId)?.connected
      ? preferredSeatId
      : null) || firstOnlineSeatId(members)
  if (!next) return party
  return { ...party, turnSeatId: next }
}
