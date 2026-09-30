/** Client/local copy of server/werewolfDeal.mjs deal + lobby sync. */
import {
  ROLE_IDS,
  WW_ACK,
  WEREWOLF_GAME_ID,
  boardOf,
  campOf,
  emptyBoard,
  goodCount,
  isWerewolfStage,
  labelOf,
  sumBoard,
  type WerewolfBoard,
  type WerewolfRoleCount,
  type WerewolfRoleId,
  type WerewolfSeatPrivate,
  type WerewolfStage,
} from './roles'

export { sumBoard, boardOf, goodCount } from './roles'

export const WEREWOLF_MIN_SEATS = 2
export const WEREWOLF_MAX_SEATS = 10

export const DEFAULT_BOARDS: Record<number, WerewolfBoard> = {
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

export function defaultBoard(seatCount: number): WerewolfBoard {
  const n = seatCount
  if (!Number.isInteger(n) || !DEFAULT_BOARDS[n]) return emptyBoard()
  return { ...DEFAULT_BOARDS[n] }
}

export function compositionOf(board: unknown): WerewolfRoleCount[] {
  const b = boardOf(board)
  return ROLE_IDS.filter((id) => b[id] > 0).map((id) => ({
    roleId: id,
    label: labelOf(id),
    count: b[id],
  }))
}

export function dealSeats<T extends { seatId?: string }>(members: T[] | undefined) {
  return (members || []).filter((m) => m && typeof m.seatId === 'string' && m.seatId)
}

export function dealSeatIds(members: { seatId?: string }[] | undefined): string[] {
  return dealSeats(members).map((m) => m.seatId as string)
}

export function dealRefusal(board: unknown, seatCount: number): string | null {
  const n = seatCount
  if (!Number.isInteger(n) || n < WEREWOLF_MIN_SEATS || n > WEREWOLF_MAX_SEATS) {
    return n < WEREWOLF_MIN_SEATS ? WW_ACK.NEED_TWO_SEATED : WW_ACK.SEATS_RANGE
  }
  const b = boardOf(board)
  if (sumBoard(b) !== n) return WW_ACK.BOARD_MISMATCH
  if (b.werewolf < 1) return WW_ACK.NO_WOLF
  if (goodCount(b) < 1) return WW_ACK.NO_GOOD
  return null
}

export function canDeal(board: unknown, seatCount: number): boolean {
  return dealRefusal(board, seatCount) == null
}

function fisherYates<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

export function nextDealId(
  existingPrivates: Record<string, { dealId?: string } | undefined> | undefined,
  prevDealId?: string,
): string {
  const fromPrev = Number(String(prevDealId || '').replace(/\D/g, ''))
  let max = Number.isInteger(fromPrev) ? fromPrev : 0
  for (const p of Object.values(existingPrivates || {})) {
    const n = Number(String(p?.dealId || '').replace(/\D/g, ''))
    if (Number.isInteger(n) && n > max) max = n
  }
  return String(max + 1)
}

export function dealRoles(
  seatIds: string[],
  board: unknown,
  rng: () => number = Math.random,
  dealId = '1',
): { privates: WerewolfSeatPrivate[]; dealId: string; board: WerewolfBoard } | { error: string } {
  const ids = seatIds.filter((id) => typeof id === 'string' && id)
  const b = boardOf(board)
  const refuse = dealRefusal(b, ids.length)
  if (refuse) return { error: refuse }
  const bag: WerewolfRoleId[] = []
  for (const roleId of ROLE_IDS) {
    for (let i = 0; i < b[roleId]; i++) bag.push(roleId)
  }
  const shuffled = fisherYates(bag, rng)
  const privates: WerewolfSeatPrivate[] = ids.map((seatId, i) => {
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

export interface WerewolfPartySync {
  gameId: typeof WEREWOLF_GAME_ID
  phase: 'lobby' | 'dealt'
  stage: WerewolfStage
  seatCount: number
  board: WerewolfBoard
  boardTweaked: boolean
  roleComposition: WerewolfRoleCount[]
  dealtSeatIds: string[]
  dealSeq?: string
}

export function lobbyParty(
  members: { seatId?: string }[],
  tweakedBoard?: unknown,
  dealSeq?: string,
): WerewolfPartySync {
  const seatCount = dealSeats(members).length
  if (tweakedBoard) {
    const board = boardOf(tweakedBoard)
    return {
      gameId: WEREWOLF_GAME_ID,
      phase: 'lobby',
      stage: 'idle',
      seatCount,
      board,
      boardTweaked: true,
      roleComposition: compositionOf(board),
      dealtSeatIds: [],
      dealSeq,
    }
  }
  const board = defaultBoard(seatCount)
  return {
    gameId: WEREWOLF_GAME_ID,
    phase: 'lobby',
    stage: 'idle',
    seatCount,
    board,
    boardTweaked: false,
    roleComposition: compositionOf(board),
    dealtSeatIds: [],
    dealSeq,
  }
}

/** PRD v0.1.2 §5.1.5 / §3.8 / §7⑦: wipe cards → lobby + idle. Never refuse. */
export function clearToLobby(
  party: Partial<WerewolfPartySync> | null | undefined,
  members: { seatId?: string }[],
): WerewolfPartySync {
  if (party?.boardTweaked) {
    const board = boardOf(party.board)
    return {
      gameId: WEREWOLF_GAME_ID,
      phase: 'lobby',
      stage: 'idle',
      seatCount: dealSeats(members).length,
      board,
      boardTweaked: true,
      roleComposition: compositionOf(board),
      dealtSeatIds: [],
      dealSeq: party.dealSeq,
    }
  }
  return lobbyParty(members, undefined, party?.dealSeq)
}

export function syncWerewolfOnMembers(
  party: WerewolfPartySync,
  members: { seatId?: string }[],
): WerewolfPartySync {
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
    stage: isWerewolfStage(party.stage) ? party.stage : 'idle',
    seatCount,
    board,
    boardTweaked: false,
    roleComposition: compositionOf(board),
    dealtSeatIds: [],
  }
}
