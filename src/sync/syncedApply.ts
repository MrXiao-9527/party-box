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

/**
 * Room+table apply gate for poll/WS.
 * - Hard-block playing → lobby (even if snapshotAt is newer/equal/older)
 * - Allow equal-age when phase advances lobby → playing
 * - Otherwise require strictly newer snapshotAt
 */
export function canApplySyncedRoom(
  current: {
    snapshotAt?: number | null
    phase?: Phase | null
  },
  incoming: { snapshotAt: number; phase: Phase },
  opts?: { force?: boolean },
): boolean {
  if (opts?.force) return true
  if (current.phase === 'playing' && incoming.phase === 'lobby') {
    return false
  }
  const phaseAdvance =
    current.phase === 'lobby' && incoming.phase === 'playing'
  return canApplyHostSnapshot(current.snapshotAt, incoming.snapshotAt, {
    allowEqual: phaseAdvance,
  })
}
