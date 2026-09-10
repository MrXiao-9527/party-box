/**
 * Pure decideRestore smoke checks (mirrors src/sync/seatRestore.ts).
 * Run: node scripts/check-decide-restore.mjs
 */

const RESTORE_COPY = {
  SEAT_TAKEN: '原席被占，新坐一席',
  IDENTITY_LOST: '本地身份丢失，已为你新坐一席',
  ROOM_GONE: '房间已结束',
  OTHER_TAB: '该席已在其他标签打开',
  TAKEN_OVER: '已在其他标签接管',
}

function decideRestore(args) {
  const code = args.roomCode.toUpperCase()

  if (!args.room || args.room.roomCode.toUpperCase() !== code) {
    return { kind: 'room_gone', toast: RESTORE_COPY.ROOM_GONE }
  }

  const identity =
    args.identity && args.identity.roomCode.toUpperCase() === code
      ? args.identity
      : null

  if (!identity) {
    if (args.hadPriorSeat) {
      return { kind: 'identity_lost', toast: RESTORE_COPY.IDENTITY_LOST }
    }
    return { kind: 'fresh_join' }
  }

  if (args.seatHeldByOtherTab) {
    return {
      kind: 'other_tab',
      toast: RESTORE_COPY.OTHER_TAB,
      identity,
    }
  }

  const stillThere = args.room.members.some((m) => m.seatId === identity.seatId)
  if (stillThere) {
    return { kind: 'silent', identity }
  }

  return {
    kind: 'seat_taken',
    toast: RESTORE_COPY.SEAT_TAKEN,
    prefillName: identity.name,
    identity,
  }
}

const room = {
  roomCode: 'ABCD',
  hostSeatId: 'seat_1',
  phase: 'playing',
  members: [
    { seatId: 'seat_1', name: '阿明', connected: true },
    { seatId: 'seat_2', name: '小李', connected: false },
  ],
  seats: [
    { seatId: 'seat_1', name: '阿明' },
    { seatId: 'seat_2', name: '小李' },
  ],
}

const identity = {
  roomCode: 'ABCD',
  seatId: 'seat_1',
  name: '阿明',
  role: 'host',
}

const cases = [
  [
    'silent',
    {
      roomCode: 'ABCD',
      room,
      identity,
      seatHeldByOtherTab: false,
      hadPriorSeat: true,
    },
    'silent',
  ],
  [
    'other_tab',
    {
      roomCode: 'ABCD',
      room,
      identity,
      seatHeldByOtherTab: true,
      hadPriorSeat: true,
    },
    'other_tab',
  ],
  [
    'seat_taken',
    {
      roomCode: 'ABCD',
      room,
      identity: { ...identity, seatId: 'seat_gone' },
      seatHeldByOtherTab: false,
      hadPriorSeat: true,
    },
    'seat_taken',
  ],
  [
    'fresh_join',
    {
      roomCode: 'ABCD',
      room,
      identity: null,
      seatHeldByOtherTab: false,
      hadPriorSeat: false,
    },
    'fresh_join',
  ],
  [
    'identity_lost',
    {
      roomCode: 'ABCD',
      room,
      identity: null,
      seatHeldByOtherTab: false,
      hadPriorSeat: true,
    },
    'identity_lost',
  ],
  [
    'room_gone',
    {
      roomCode: 'ABCD',
      room: null,
      identity,
      seatHeldByOtherTab: false,
      hadPriorSeat: true,
    },
    'room_gone',
  ],
  [
    'paused silent still silent',
    {
      roomCode: 'ABCD',
      room: { ...room, phase: 'paused' },
      identity,
      seatHeldByOtherTab: false,
      hadPriorSeat: true,
    },
    'silent',
  ],
]

let failed = 0
for (const [label, args, expect] of cases) {
  const got = decideRestore(args)
  if (got.kind !== expect) {
    console.error(`FAIL ${label}: expected ${expect}, got ${got.kind}`)
    failed++
  } else {
    console.log(`ok ${label}`)
  }
}

const lost = decideRestore({
  roomCode: 'ABCD',
  room,
  identity: null,
  seatHeldByOtherTab: false,
  hadPriorSeat: true,
})
if (lost.toast !== RESTORE_COPY.IDENTITY_LOST) {
  console.error('FAIL identity_lost toast copy')
  failed++
} else {
  console.log('ok identity_lost toast copy')
}

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('all decideRestore checks passed')
