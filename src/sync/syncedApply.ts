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
 * Whether an incoming host snapshot may replace the current one.
 * Stale / same-age-while-pending must be rejected — callers must also
 * skip the accompanying room payload when this returns false.
 */
export function canApplyHostSnapshot(
  currentSnapshotAt: number | null | undefined,
  incomingSnapshotAt: number,
  opts?: { force?: boolean; hasPendingOps?: boolean },
): boolean {
  if (opts?.force) return true
  if (
    currentSnapshotAt != null &&
    incomingSnapshotAt < currentSnapshotAt
  ) {
    return false
  }
  if (
    currentSnapshotAt != null &&
    opts?.hasPendingOps &&
    incomingSnapshotAt <= currentSnapshotAt
  ) {
    return false
  }
  return true
}
