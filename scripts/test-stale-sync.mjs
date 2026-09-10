/**
 * Regression: stale relay poll/WS must not apply room when table snapshot is rejected.
 * Run: node --experimental-strip-types scripts/test-stale-sync.mjs
 */
import { canApplyHostSnapshot } from '../src/sync/syncedApply.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/** Simulate applySyncedRoom gate: skip room when snapshot rejected. */
function applySynced(currentAt, incoming, opts) {
  if (!canApplyHostSnapshot(currentAt, incoming.table.snapshotAt, opts)) {
    return { applied: false, phase: null }
  }
  return { applied: true, phase: incoming.room.phase, at: incoming.table.snapshotAt }
}

// 1) After 开桌 (playing @ 200), late lobby poll (@ 100) must not revert phase
{
  let phase = 'playing'
  let at = 200
  const stale = {
    room: { phase: 'lobby' },
    table: { snapshotAt: 100 },
  }
  const r = applySynced(at, stale)
  assert(!r.applied, 'stale poll rejected')
  assert(phase === 'playing', 'phase stays playing')
}

// 2) Same race via onRelayRoomUpdate ordering
{
  const r = applySynced(500, {
    room: { phase: 'lobby' },
    table: { snapshotAt: 499 },
  })
  assert(!r.applied, 'stale WS room update rejected')
}

// 3) Fresh poll after playing still applies
{
  const r = applySynced(200, {
    room: { phase: 'playing' },
    table: { snapshotAt: 250 },
  })
  assert(r.applied && r.phase === 'playing' && r.at === 250, 'fresh poll ok')
}

// 4) startPlaying / forced updates still apply both even if older clock
{
  const r = applySynced(
    300,
    { room: { phase: 'playing' }, table: { snapshotAt: 100 } },
    { force: true },
  )
  assert(r.applied && r.phase === 'playing', 'force applies room+table')
}

// 5) Pending ops: same-age echo rejected (room gated too)
{
  const r = applySynced(
    200,
    { room: { phase: 'playing' }, table: { snapshotAt: 200 } },
    { hasPendingOps: true },
  )
  assert(!r.applied, 'pending same-age rejected')
}

console.log('ok: stale sync gate — room skipped when snapshot rejected')
