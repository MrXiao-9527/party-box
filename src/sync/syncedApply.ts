import type { Phase, TableSnapshot } from '../types'

/** Host TableSnapshot sanitize — pot always numeric (same path as seat balances). */
export function sanitizeTableSnapshot(snap: TableSnapshot): TableSnapshot {
  return {
    ...snap,
    seats: snap.seats.map((s) => ({
      ...s,
      balance: Math.max(0, s.balance),
      buyIn: Math.max(0, Math.floor(Number.isFinite(s.buyIn) ? s.buyIn : 0)),
    })),
    pot: Math.max(0, Math.floor(Number.isFinite(snap.pot) ? snap.pot : 0)),
    ledger: Array.isArray(snap.ledger) ? snap.ledger : [],
    settling: !!snap.settling,
  }
}

/**
 * Product lock: snapshots may only apply when newer by snapshotAt.
 * Never overwrite newer state with older/equal lobby or table.
 * Callers must gate setRoom with this same rule (see applySyncedRoom).
 */
export function canApplyHostSnapshot(
  currentSnapshotAt: number | null | undefined,
  incomingSnapshotAt: number,
  opts?: { force?: boolean; allowEqual?: boolean },
): boolean {
  if (opts?.force) return true
  if (currentSnapshotAt == null) return true
  if (opts?.allowEqual) return incomingSnapshotAt >= currentSnapshotAt
  return incomingSnapshotAt > currentSnapshotAt
}

function incomingAddsSeat(
  currentIds?: string[] | null,
  incomingIds?: string[] | null,
): boolean {
  if (!incomingIds?.length) return false
  const have = new Set(currentIds ?? [])
  return incomingIds.some((id) => !!id && !have.has(id))
}

/**
 * Room+table apply gate for poll/WS.
 * - Hard-block playing → lobby (even if snapshotAt is newer/equal/older)
 * - Allow equal-age when phase advances lobby → playing
 * - Allow equal-age when incoming adds a seat (same-ms join); never drop seats
 * - Otherwise require strictly newer snapshotAt
 */
export function canApplySyncedRoom(
  current: {
    snapshotAt?: number | null
    phase?: Phase | null
    seatIds?: string[] | null
  },
  incoming: {
    snapshotAt: number
    phase: Phase
    seatIds?: string[] | null
  },
  opts?: { force?: boolean },
): boolean {
  if (opts?.force) return true
  if (current.phase === 'playing' && incoming.phase === 'lobby') {
    return false
  }
  const phaseAdvance =
    current.phase === 'lobby' && incoming.phase === 'playing'
  if (
    canApplyHostSnapshot(current.snapshotAt, incoming.snapshotAt, {
      allowEqual: phaseAdvance,
    })
  ) {
    return true
  }
  // Same-ms `/r/CODE` join: host snapshotAt can equal the join mutation.
  // Apply only when a new seatId appears — never a same-age shrink (stale poll).
  return (
    incoming.snapshotAt === current.snapshotAt &&
    incoming.phase === current.phase &&
    incomingAddsSeat(current.seatIds, incoming.seatIds)
  )
}
