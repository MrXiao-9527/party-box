/**
 * Product lock: snapshots only when newer; setRoom gated with same rule;
 * hard-block playing→lobby; equal-age lobby→playing allowed.
 * Run: node --experimental-strip-types scripts/test-stale-sync.mjs
 */
import {
  canApplyHostSnapshot,
  canApplySyncedRoom,
} from '../src/sync/syncedApply.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/** Simulate applySyncedRoom: skip room when gate rejects. */
function applySynced(current, incoming, opts) {
  if (
    !canApplySyncedRoom(
      { snapshotAt: current.at, phase: current.phase },
      { snapshotAt: incoming.table.snapshotAt, phase: incoming.room.phase },
      opts,
    )
  ) {
    return { applied: false, phase: current.phase }
  }
  return {
    applied: true,
    phase: incoming.room.phase,
    at: incoming.table.snapshotAt,
  }
}

// 1) After 开桌 (playing @ 200), late lobby poll (@ 100) must not revert phase
{
  const r = applySynced(
    { at: 200, phase: 'playing' },
    { room: { phase: 'lobby' }, table: { snapshotAt: 100 } },
  )
  assert(!r.applied, 'stale poll rejected')
  assert(r.phase === 'playing', 'phase stays playing')
}

// 2) Same race via onRelayRoomUpdate ordering
{
  const r = applySynced(
    { at: 500, phase: 'playing' },
    { room: { phase: 'lobby' }, table: { snapshotAt: 499 } },
  )
  assert(!r.applied, 'stale WS room update rejected')
}

// 3) Equal-age must NOT overwrite playing with lobby
{
  const r = applySynced(
    { at: 200, phase: 'playing' },
    { room: { phase: 'lobby' }, table: { snapshotAt: 200 } },
  )
  assert(!r.applied, 'equal-age lobby rejected')
  assert(r.phase === 'playing', 'phase stays playing after equal lobby')
}

// 4) NEW: newer lobby after playing still hard-blocked (member-update race)
{
  const r = applySynced(
    { at: 200, phase: 'playing' },
    { room: { phase: 'lobby' }, table: { snapshotAt: 999 } },
  )
  assert(!r.applied, 'newer lobby cannot regress playing→lobby')
  assert(r.phase === 'playing', 'phase stays playing despite newer lobby')
}

// 5) Fresh poll after playing still applies
{
  const r = applySynced(
    { at: 200, phase: 'playing' },
    { room: { phase: 'playing' }, table: { snapshotAt: 250 } },
  )
  assert(r.applied && r.phase === 'playing' && r.at === 250, 'fresh poll ok')
}

// 6) Equal-age lobby→playing advances (setPhase same-ms race)
{
  const r = applySynced(
    { at: 200, phase: 'lobby' },
    { room: { phase: 'playing' }, table: { snapshotAt: 200 } },
  )
  assert(r.applied && r.phase === 'playing', 'equal-age phase advance ok')
}

// 7) startPlaying / forced updates still apply both
{
  const r = applySynced(
    { at: 300, phase: 'playing' },
    { room: { phase: 'playing' }, table: { snapshotAt: 100 } },
    { force: true },
  )
  assert(r.applied && r.phase === 'playing', 'force applies room+table')
}

// 8) First snapshot (no current) applies
{
  assert(
    canApplyHostSnapshot(null, 1),
    'null current accepts first snapshot',
  )
  assert(
    canApplySyncedRoom({ snapshotAt: null, phase: null }, {
      snapshotAt: 1,
      phase: 'lobby',
    }),
    'null current synced room applies',
  )
}

// 9) playing→paused allowed only when newer (intentional host pause)
{
  const blocked = applySynced(
    { at: 200, phase: 'playing' },
    { room: { phase: 'paused' }, table: { snapshotAt: 200 } },
  )
  assert(!blocked.applied, 'equal-age playing→paused rejected')
  const ok = applySynced(
    { at: 200, phase: 'playing' },
    { room: { phase: 'paused' }, table: { snapshotAt: 201 } },
  )
  assert(ok.applied && ok.phase === 'paused', 'newer playing→paused ok')
}

console.log(
  'ok: phase anti-regression + only-newer gate — playing survives stale/newer lobby',
)
