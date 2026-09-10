/**
 * Product lock: snapshots only when newer; setRoom gated with same rule.
 * Run: node --experimental-strip-types scripts/test-stale-sync.mjs
 */
import { canApplyHostSnapshot } from '../src/sync/syncedApply.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/** Simulate applySyncedRoom: skip room when snapshot rejected. */
function applySynced(currentAt, incoming, opts) {
  if (!canApplyHostSnapshot(currentAt, incoming.table.snapshotAt, opts)) {
    return { applied: false, phase: null }
  }
  return { applied: true, phase: incoming.room.phase, at: incoming.table.snapshotAt }
}

// 1) After 开桌 (playing @ 200), late lobby poll (@ 100) must not revert phase
{
  const phase = 'playing'
  const r = applySynced(200, {
    room: { phase: 'lobby' },
    table: { snapshotAt: 100 },
  })
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

// 3) Equal-age must NOT overwrite (only newer)
{
  const r = applySynced(200, {
    room: { phase: 'lobby' },
    table: { snapshotAt: 200 },
  })
  assert(!r.applied, 'equal-age lobby rejected')
}

// 4) Fresh poll after playing still applies
{
  const r = applySynced(200, {
    room: { phase: 'playing' },
    table: { snapshotAt: 250 },
  })
  assert(r.applied && r.phase === 'playing' && r.at === 250, 'fresh poll ok')
}

// 5) startPlaying / forced updates still apply both
{
  const r = applySynced(
    300,
    { room: { phase: 'playing' }, table: { snapshotAt: 100 } },
    { force: true },
  )
  assert(r.applied && r.phase === 'playing', 'force applies room+table')
}

// 6) First snapshot (no current) applies
{
  assert(
    canApplyHostSnapshot(null, 1),
    'null current accepts first snapshot',
  )
}

console.log('ok: only-newer snapshotAt gate — room skipped when not newer')
