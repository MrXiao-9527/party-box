import type { TableSnapshot } from '../types'

/** Host TableSnapshot sanitize — pot always numeric (same path as seat balances). */
export function sanitizeTableSnapshot(snap: TableSnapshot): TableSnapshot {
  return {
    ...snap,
    seats: snap.seats.map((s) => ({ ...s, balance: Math.max(0, s.balance) })),
    pot: Math.max(0, Math.floor(Number.isFinite(snap.pot) ? snap.pot : 0)),
    ledger: Array.isArray(snap.ledger) ? snap.ledger : [],
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
  opts?: { force?: boolean },
): boolean {
  if (opts?.force) return true
  if (currentSnapshotAt == null) return true
  return incomingSnapshotAt > currentSnapshotAt
}
