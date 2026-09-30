/**
 * Werewolf deal (发牌器). Independent of undercover / miss-card / truthDare.
 * Public snapshot is role×count only — never who-is-who.
 */
export const WEREWOLF_GAME_ID = 'werewolf-deal'
export const WEREWOLF_MIN_SEATS = 2
export const WEREWOLF_MAX_SEATS = 10

export const ROLE_IDS = [
  'werewolf',
  'villager',
  'seer',
  'witch',
  'hunter',
  'guard',
]

export const ROLE_META = {
  werewolf: {
    label: '狼人',
    camp: 'wolf',
    blurb: '夜间与狼队一起行动（线下）',
  },
  villager: {
    label: '平民',
    camp: 'good',
    blurb: '没有技能，靠发言和投票找出狼人',
  },
  seer: {
    label: '预言家',
    camp: 'good',
    blurb: '夜间查验一名玩家的阵营（线下）',
  },
  witch: {
    label: '女巫',
    camp: 'good',
    blurb: '解药和毒药各一瓶，夜间使用（线下）',
  },
  hunter: {
    label: '猎人',
    camp: 'good',
    blurb: '出局时可开枪带走一人（线下）',
  },
  guard: {
    label: '守卫',
    camp: 'good',
    blurb: '夜间守护一名玩家（线下）',
  },
}

/** PRD §5 default boards by seated count. */
export const DEFAULT_BOARDS = {
  2: { werewolf: 1, villager: 1, seer: 0, witch: 0, hunter: 0, guard: 0 },
  3: { werewolf: 1, villager: 1, seer: 1, witch: 0, hunter: 0, guard: 0 },
  4: { werewolf: 1, villager: 2, seer: 1, witch: 0, hunter: 0, guard: 0 },
  5: { werewolf: 1, villager: 2, seer: 1, witch: 1, hunter: 0, guard: 0 },
  6: { werewolf: 2, villager: 2, seer: 1, witch: 1, hunter: 0, guard: 0 },
  7: { werewolf: 2, villager: 3, seer: 1, witch: 1, hunter: 0, guard: 0 },
  8: { werewolf: 2, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 0 },
  9: { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 0 },
  10: { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 1 },
}

export const WW_ACK = {
  BOARD_MISMATCH: '人数与板子对不上',
  NO_WOLF: '狼人不能为 0',
  NO_GOOD: '好人不能为 0',
  BOARD_LOCKED: '发牌后不能改角色数量',
  NEED_TWO_SEATED: '至少 2 人入座才能发牌',
  SEATS_RANGE: '人数须为2–10',
  NOT_DEALT: '发牌后才能切换阶段',
  NOT_IN_LOBBY: '未发牌时才能改板',
}

export const STAGE_COPY = {
  idle: '未开始',
  night: '天黑了',
  day: '白天了',
  vote: '开始投票',
}

export function emptyBoard() {
  return {
    werewolf: 0,
    villager: 0,
    seer: 0,
    witch: 0,
    hunter: 0,
    guard: 0,
  }
}

export function isWerewolfRoleId(raw) {
  return ROLE_IDS.includes(raw)
}

export function isWerewolfPhase(raw) {
  return raw === 'lobby' || raw === 'dealt'
}

export function isWerewolfStage(raw) {
  return raw === 'idle' || raw === 'night' || raw === 'day' || raw === 'vote'
}

export function campOf(roleId) {
  return ROLE_META[roleId]?.camp === 'wolf' ? 'wolf' : 'good'
}

export function labelOf(roleId) {
  return ROLE_META[roleId]?.label || ''
}

export function blurbOf(roleId) {
  return ROLE_META[roleId]?.blurb || ''
}

export function boardOf(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = emptyBoard()
  for (const id of ROLE_IDS) {
    const n = typeof src[id] === 'number' ? src[id] : Number(src[id])
    out[id] = Number.isInteger(n) && n > 0 ? n : 0
  }
  return out
}

export function sumBoard(board) {
  const b = boardOf(board)
  return ROLE_IDS.reduce((n, id) => n + b[id], 0)
}

export function goodCount(board) {
  const b = boardOf(board)
  return b.villager + b.seer + b.witch + b.hunter + b.guard
}

export function defaultBoard(seatCount) {
  const n = typeof seatCount === 'number' ? seatCount : Number(seatCount)
  if (!Number.isInteger(n) || !DEFAULT_BOARDS[n]) return emptyBoard()
  return { ...DEFAULT_BOARDS[n] }
}

export function compositionOf(board) {
  const b = boardOf(board)
  return ROLE_IDS.filter((id) => b[id] > 0).map((id) => ({
    roleId: id,
    label: labelOf(id),
    count: b[id],
  }))
}

export function compositionOfStub(raw) {
  if (!Array.isArray(raw)) return compositionOf(emptyBoard())
  const out = []
  const seen = new Set()
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const roleId = isWerewolfRoleId(row.roleId) ? row.roleId : null
    if (!roleId || seen.has(roleId)) continue
    const n = typeof row.count === 'number' ? row.count : Number(row.count)
    if (!Number.isInteger(n) || n <= 0) continue
    seen.add(roleId)
    out.push({ roleId, label: labelOf(roleId), count: n })
  }
  return out
}

export function seatIdList(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const x of raw) {
    if (typeof x !== 'string' || !x.trim()) continue
    const id = x.trim()
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Occupied seats, including members still in DISCONNECT_GRACE.
 * Never filter on instantaneous connected===true.
 */
export function dealSeats(members) {
  return (members || []).filter((m) => m && typeof m.seatId === 'string' && m.seatId)
}

export function dealSeatIds(members) {
  return dealSeats(members).map((m) => m.seatId)
}

export function dealRefusal(board, seatCount) {
  const n = typeof seatCount === 'number' ? seatCount : Number(seatCount)
  if (!Number.isInteger(n) || n < WEREWOLF_MIN_SEATS || n > WEREWOLF_MAX_SEATS) {
    return n < WEREWOLF_MIN_SEATS ? WW_ACK.NEED_TWO_SEATED : WW_ACK.SEATS_RANGE
  }
  const b = boardOf(board)
  if (sumBoard(b) !== n) return WW_ACK.BOARD_MISMATCH
  if (b.werewolf < 1) return WW_ACK.NO_WOLF
  if (goodCount(b) < 1) return WW_ACK.NO_GOOD
  return null
}

export function canDeal(board, seatCount) {
  return dealRefusal(board, seatCount) == null
}

function fisherYates(items, rng) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

export function nextDealId(existingPrivates, prevDealId) {
  const fromPrev = Number(String(prevDealId || '').replace(/\D/g, ''))
  let max = Number.isInteger(fromPrev) ? fromPrev : 0
  for (const p of Object.values(existingPrivates || {})) {
    const n = Number(String(p?.dealId || '').replace(/\D/g, ''))
    if (Number.isInteger(n) && n > max) max = n
  }
  return String(max + 1)
}

export function dealRoles(seatIds, board, rng = Math.random, dealId = '1') {
  const ids = seatIdList(seatIds)
  const b = boardOf(board)
  const refuse = dealRefusal(b, ids.length)
  if (refuse) return { error: refuse }
  const bag = []
  for (const roleId of ROLE_IDS) {
    for (let i = 0; i < b[roleId]; i++) bag.push(roleId)
  }
  const shuffled = fisherYates(bag, rng)
  const privates = ids.map((seatId, i) => {
    const roleId = shuffled[i]
    return {
      seatId,
      gameId: WEREWOLF_GAME_ID,
      dealId: String(dealId),
      roleId,
      camp: campOf(roleId),
      label: labelOf(roleId),
    }
  })
  return { privates, dealId: String(dealId), board: b }
}

export function sanitizeWerewolfPrivate(seatId, raw) {
  if (!raw || typeof raw !== 'object') return null
  const roleId = isWerewolfRoleId(raw.roleId) ? raw.roleId : null
  if (!roleId) return null
  const dealId = typeof raw.dealId === 'string' && raw.dealId.trim() ? raw.dealId.trim() : '1'
  return {
    seatId,
    gameId: WEREWOLF_GAME_ID,
    dealId,
    roleId,
    camp: campOf(roleId),
    label: labelOf(roleId),
  }
}

export function isWerewolfPrivate(raw) {
  if (!raw || typeof raw !== 'object') return false
  if (raw.gameId === WEREWOLF_GAME_ID) return true
  return isWerewolfRoleId(raw.roleId) && typeof raw.word !== 'string'
}

export function werewolfStubOf(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const phase = src.phase === 'dealt' ? 'dealt' : 'lobby'
  const stage = isWerewolfStage(src.stage) ? src.stage : 'idle'
  const board = boardOf(src.board)
  const seatRaw =
    typeof src.seatCount === 'number' ? src.seatCount : Number(src.seatCount)
  const seatCount = Number.isInteger(seatRaw) && seatRaw >= 0 ? seatRaw : sumBoard(board)
  const roleComposition =
    Array.isArray(src.roleComposition) && src.roleComposition.length
      ? compositionOfStub(src.roleComposition)
      : compositionOf(board)
  const stub = {
    gameId: WEREWOLF_GAME_ID,
    phase,
    stage: phase === 'lobby' ? (stage === 'idle' ? 'idle' : stage) : stage,
    seatCount,
    board,
    boardTweaked: !!src.boardTweaked,
    roleComposition,
    dealtSeatIds: phase === 'dealt' ? seatIdList(src.dealtSeatIds) : [],
  }
  const dealSeq =
    typeof src.dealSeq === 'string' && src.dealSeq.trim()
      ? src.dealSeq.trim()
      : typeof src.dealSeq === 'number'
        ? String(src.dealSeq)
        : ''
  if (dealSeq) stub.dealSeq = dealSeq
  return stub
}

/** Lobby: auto-recalc unless host tweaked. Dealt: keep board, refresh seatCount only. */
export function syncWerewolfOnMembers(party, members) {
  if (!party || party.gameId !== WEREWOLF_GAME_ID) return party
  const seatCount = dealSeats(members).length
  if (party.phase === 'dealt') {
    return {
      ...party,
      seatCount,
      roleComposition: compositionOf(party.board),
    }
  }
  if (party.boardTweaked) {
    return {
      ...party,
      phase: 'lobby',
      seatCount,
      roleComposition: compositionOf(party.board),
    }
  }
  const board = defaultBoard(seatCount)
  return {
    ...party,
    phase: 'lobby',
    stage: party.stage && isWerewolfStage(party.stage) ? party.stage : 'idle',
    seatCount,
    board,
    boardTweaked: false,
    roleComposition: compositionOf(board),
    dealtSeatIds: [],
  }
}

export function lobbyParty(members, tweakedBoard, dealSeq) {
  const seatCount = dealSeats(members).length
  const seq =
    typeof dealSeq === 'string' && dealSeq.trim() ? dealSeq.trim() : undefined
  if (tweakedBoard) {
    const board = boardOf(tweakedBoard)
    const next = {
      gameId: WEREWOLF_GAME_ID,
      phase: 'lobby',
      stage: 'idle',
      seatCount,
      board,
      boardTweaked: true,
      roleComposition: compositionOf(board),
      dealtSeatIds: [],
    }
    if (seq) next.dealSeq = seq
    return next
  }
  const board = defaultBoard(seatCount)
  const next = {
    gameId: WEREWOLF_GAME_ID,
    phase: 'lobby',
    stage: 'idle',
    seatCount,
    board,
    boardTweaked: false,
    roleComposition: compositionOf(board),
    dealtSeatIds: [],
  }
  if (seq) next.dealSeq = seq
  return next
}

export function clearToLobby(party, members) {
  const prev = werewolfStubOf(party)
  const seatCount = dealSeats(members).length
  if (prev.boardTweaked) {
    const next = {
      gameId: WEREWOLF_GAME_ID,
      phase: 'lobby',
      stage: 'idle',
      seatCount,
      board: boardOf(prev.board),
      boardTweaked: true,
      roleComposition: compositionOf(prev.board),
      dealtSeatIds: [],
    }
    if (prev.dealSeq) next.dealSeq = prev.dealSeq
    return next
  }
  return lobbyParty(members, null, prev.dealSeq)
}

const SECRET_KEY_RE =
  /"(partyPrivates|seatRoles|whoIsWho|hostRoster|seatTokens|seatToken)"\s*:/

/** Public JSON must never carry a seat→role map or privates. */
export function publicPayloadLeaks(payload) {
  const raw = JSON.stringify(payload)
  if (!raw) return 'empty'
  if (SECRET_KEY_RE.test(raw)) return 'secret-key'
  if (/"hostRoster"\s*:/.test(raw)) return 'host-roster'
  if (/"whoIsWho"\s*:/.test(raw)) return 'who'
  // A public seat object that names a role is a roster leak.
  if (/"seatId"\s*:\s*"[^"]+"\s*,\s*"roleId"\s*:/.test(raw)) return 'seat-role'
  if (/"roleId"\s*:\s*"[^"]+"\s*,\s*"seatId"\s*:/.test(raw)) return 'role-seat'
  return null
}
