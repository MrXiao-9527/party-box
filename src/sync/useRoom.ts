import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadRoom,
  loadSession,
  newOpId,
  saveSession,
  type PersistedRoom,
  type Session,
} from '../store/localRoom'
import type {
  ChipOp,
  ChipOpType,
  RoomState,
  Seat,
  TableSnapshot,
} from '../types'
import { ACK_REASONS, findLastUndoable, ledgerEntrySummary } from '../types'
import { defaultTransport, type ChipTransport } from './transport'
import { loadIdentity, roleForSeat, saveIdentity } from './seatRestore'
import {
  fillSeatsToMax,
  pickNewHost,
  RelayNetworkError,
  resumeAsHost,
  setMemberConnected,
  setPhase,
  syncRoomFromRelay,
} from './roomApi'
import {
  isRelayEnabled,
  onRelayRoomUpdate,
  subscribeRelayRoom,
} from './relayClient'
import { canApplyHostSnapshot, sanitizeTableSnapshot } from './syncedApply'

export interface ToastMessage {
  id: string
  text: string
}

function seatsFromSnapshot(
  table: TableSnapshot,
  selfSeatId: string,
): Seat[] {
  return table.seats.map((s) => ({
    seatId: s.seatId,
    name: s.name,
    isSelf: s.seatId === selfSeatId,
    isHost: s.isHost,
    locked: s.locked,
    balance: Math.max(0, s.balance),
  }))
}

function denomKey(
  type: ChipOpType,
  extra?: { denom?: number; amount?: number; targetSeatIds?: string[] },
): string | null {
  if (type === '+denom' || type === '-denom') {
    return `${type}:${extra?.denom ?? ''}`
  }
  if (type === '+batch' || type === '-batch') {
    return `${type}:${extra?.amount ?? ''}`
  }
  if (type === 'transfer') {
    const ids = [...(extra?.targetSeatIds ?? [])].sort().join(',')
    return `transfer:${ids}:${extra?.amount ?? ''}`
  }
  if (type === 'uniformBuyIn') {
    return `uniformBuyIn:${extra?.amount ?? ''}`
  }
  if (type === 'potIn') {
    return `potIn:${extra?.amount ?? ''}`
  }
  if (type === 'potOut') {
    return `potOut:${extra?.amount ?? ''}`
  }
  if (type === 'potSplit') {
    return `potSplit:${extra?.amount ?? ''}`
  }
  if (type === 'undoLast') {
    return 'undoLast'
  }
  return null
}

export function useRoom(roomCode: string | undefined, transport: ChipTransport = defaultTransport) {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [room, setRoom] = useState<RoomState | null>(null)
  const [table, setTable] = useState<TableSnapshot | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [pendingOps, setPendingOps] = useState<Set<string>>(new Set())
  const [connectionState, setConnectionState] = useState<'online' | 'offline'>(
    () => transport.getConnectionState(),
  )
  const snapshotRef = useRef<TableSnapshot | null>(null)
  /** Drop same-key denom taps while awaiting ack. */
  const inflightKeysRef = useRef<Set<string>>(new Set())
  const pendingOpsRef = useRef<Set<string>>(new Set())

  const pushToast = useCallback((text: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setToasts((prev) => [...prev, { id, text }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 2800)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  /** Apply host-authoritative table. Optimistic keeps base.snapshotAt so it never outranks host. */
  const applyHostSnapshot = useCallback(
    (snap: TableSnapshot, opts?: { force?: boolean }) => {
      const sanitized = sanitizeTableSnapshot(snap)
      if (
        !canApplyHostSnapshot(
          snapshotRef.current?.snapshotAt,
          sanitized.snapshotAt,
          {
            force: opts?.force,
            hasPendingOps: pendingOpsRef.current.size > 0,
          },
        )
      ) {
        return false
      }
      setTable(sanitized)
      snapshotRef.current = sanitized
      return true
    },
    [],
  )

  /**
   * Room + table must move together. If the table snapshot is rejected as
   * stale, skip the accompanying room payload (avoids poll/WS races that
   * would revert phase playing → lobby after 开桌).
   */
  const applySyncedRoom = useCallback(
    (data: PersistedRoom, opts?: { force?: boolean }) => {
      if (!applyHostSnapshot(data.table, opts)) return false
      setRoom(data.room)
      return true
    },
    [applyHostSnapshot],
  )

  const refresh = useCallback(() => {
    if (!roomCode) return
    const data = loadRoom(roomCode)
    if (!data) {
      setRoom(null)
      setTable(null)
      snapshotRef.current = null
      return
    }
    applySyncedRoom(data)
  }, [roomCode, applySyncedRoom])

  useEffect(() => {
    refresh()
    if (!roomCode) return

    const onStorage = (e: StorageEvent) => {
      if (e.key === `party-box:room:${roomCode.toUpperCase()}`) {
        refresh()
      }
    }
    window.addEventListener('storage', onStorage)

    const unsubRelayEvent = onRelayRoomUpdate(roomCode, (data) => {
      if (!data) {
        setRoom(null)
        setTable(null)
        snapshotRef.current = null
        return
      }
      applySyncedRoom(data)
    })

    const unsubWs = isRelayEnabled()
      ? subscribeRelayRoom(roomCode)
      : () => {}

    // Relay: poll shared host snapshot (not only localStorage) so pot survives WS blips.
    const poll = window.setInterval(() => {
      if (isRelayEnabled()) {
        void syncRoomFromRelay(roomCode).then((synced) => {
          if (synced.status === 'ok') {
            applySyncedRoom(synced.data)
          }
        })
      } else {
        refresh()
      }
    }, isRelayEnabled() ? 2000 : 800)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.clearInterval(poll)
      unsubRelayEvent()
      unsubWs()
    }
  }, [roomCode, refresh, applySyncedRoom])

  const applyLocalOptimistic = useCallback(
    (op: ChipOp, base: TableSnapshot): TableSnapshot => {
      const seats = base.seats.map((s) => ({ ...s, balance: Math.max(0, s.balance) }))
      const target = seats.find((s) => s.seatId === op.targetSeatId)
      if (
        !target &&
        op.type !== 'resetTable' &&
        op.type !== 'transfer' &&
        op.type !== 'uniformBuyIn' &&
        op.type !== 'potIn' &&
        op.type !== 'potOut' &&
        op.type !== 'potSplit' &&
        op.type !== 'undoLast'
      ) {
        return base
      }
      let ledger = [...(base.ledger ?? [])]
      let pot = Math.max(
        0,
        Math.floor(Number.isFinite(base.pot) ? base.pot : 0),
      )

      switch (op.type) {
        case '+denom':
          if (target && op.denom) {
            const before = target.balance
            target.balance = Math.max(0, target.balance + op.denom)
            const actual = target.balance - before
            if (actual !== 0) {
              ledger.push({
                id: `led_opt_${op.opId}_adj`,
                kind: 'seatAdjust',
                fromSeatId: target.seatId,
                fromName: target.name,
                toSeatId: '',
                toName: '',
                amount: actual,
                at: Date.now(),
              })
            }
          }
          break
        case '-denom':
          if (target && op.denom) {
            const before = target.balance
            target.balance = Math.max(0, target.balance - op.denom)
            const actual = target.balance - before
            if (actual !== 0) {
              ledger.push({
                id: `led_opt_${op.opId}_adj`,
                kind: 'seatAdjust',
                fromSeatId: target.seatId,
                fromName: target.name,
                toSeatId: '',
                toName: '',
                amount: actual,
                at: Date.now(),
              })
            }
          }
          break
        case '+batch':
          if (target && op.amount) {
            const before = target.balance
            target.balance = Math.max(0, target.balance + op.amount)
            const actual = target.balance - before
            if (actual !== 0) {
              ledger.push({
                id: `led_opt_${op.opId}_adj`,
                kind: 'seatAdjust',
                fromSeatId: target.seatId,
                fromName: target.name,
                toSeatId: '',
                toName: '',
                amount: actual,
                at: Date.now(),
              })
            }
          }
          break
        case '-batch':
          if (target && op.amount) {
            const before = target.balance
            target.balance = Math.max(0, target.balance - op.amount)
            const actual = target.balance - before
            if (actual !== 0) {
              ledger.push({
                id: `led_opt_${op.opId}_adj`,
                kind: 'seatAdjust',
                fromSeatId: target.seatId,
                fromName: target.name,
                toSeatId: '',
                toName: '',
                amount: actual,
                at: Date.now(),
              })
            }
          }
          break
        case 'set':
          if (target) target.balance = Math.max(0, op.amount ?? 0)
          break
        case 'resetSeat':
          if (target) {
            target.balance = 0
            target.locked = false
          }
          break
        case 'resetTable':
          for (const s of seats) {
            s.balance = 0
            s.locked = false
          }
          break
        case 'lock':
          if (target) target.locked = true
          break
        case 'unlock':
          if (target) target.locked = false
          break
        case 'transfer': {
          const amount = op.amount ?? 0
          if (!Number.isInteger(amount) || amount <= 0) return base
          const rawIds =
            op.targetSeatIds && op.targetSeatIds.length > 0
              ? op.targetSeatIds
              : [op.targetSeatId]
          const sender = seats.find((s) => s.seatId === op.fromSeatId)
          if (!sender) return base
          const receivers = rawIds
            .filter((id, i, arr) => id && arr.indexOf(id) === i && id !== op.fromSeatId)
            .map((id) => seats.find((s) => s.seatId === id))
            .filter((s): s is NonNullable<typeof s> => !!s)
          if (receivers.length === 0) return base
          const total = amount * receivers.length
          if (sender.balance < total) return base
          sender.balance -= total
          const at = Date.now()
          for (const t of receivers) {
            t.balance += amount
            ledger.push({
              id: `led_opt_${op.opId}_${t.seatId}`,
              kind: 'transfer',
              fromSeatId: sender.seatId,
              fromName: sender.name,
              toSeatId: t.seatId,
              toName: t.name,
              amount,
              at,
            })
          }
          break
        }
        case 'uniformBuyIn': {
          const amount = op.amount ?? 0
          if (!Number.isInteger(amount) || amount <= 0) return base
          const prevBalances = seats.map((s) => ({
            seatId: s.seatId,
            balance: s.balance,
          }))
          for (const s of seats) {
            s.balance = amount
          }
          ledger.push({
            id: `led_opt_${op.opId}_buyin`,
            kind: 'uniformBuyIn',
            fromSeatId: op.fromSeatId,
            fromName: '',
            toSeatId: '',
            toName: '',
            amount,
            at: Date.now(),
            prevBalances,
          })
          break
        }
        case 'potIn': {
          const amount = Number(op.amount)
          if (!Number.isInteger(amount) || amount <= 0) return base
          const sender = seats.find((s) => s.seatId === op.fromSeatId)
          if (!sender || sender.locked || sender.balance < amount) return base
          sender.balance -= amount
          pot += amount
          ledger.push({
            id: `led_opt_${op.opId}_potIn`,
            kind: 'potIn',
            fromSeatId: sender.seatId,
            fromName: sender.name,
            toSeatId: '',
            toName: '锅',
            amount,
            at: Date.now(),
          })
          break
        }
        case 'potOut': {
          const amount = Number(op.amount)
          if (!Number.isInteger(amount) || amount <= 0) return base
          if (!target || pot < amount) return base
          pot -= amount
          target.balance += amount
          ledger.push({
            id: `led_opt_${op.opId}_potOut`,
            kind: 'potOut',
            fromSeatId: '',
            fromName: '锅',
            toSeatId: target.seatId,
            toName: target.name,
            amount,
            at: Date.now(),
          })
          break
        }
        case 'potSplit': {
          const amount = Number(op.amount)
          if (!Number.isInteger(amount) || amount <= 0) return base
          if (pot < amount) return base
          const eligible = seats.filter((s) => !s.locked)
          if (eligible.length === 0) return base
          const share = Math.floor(amount / eligible.length)
          if (share < 1) return base
          const totalOut = share * eligible.length
          pot -= totalOut
          for (const s of eligible) s.balance += share
          ledger.push({
            id: `led_opt_${op.opId}_potSplit`,
            kind: 'potSplit',
            fromSeatId: '',
            fromName: '锅',
            toSeatId: '',
            toName: '',
            amount: share,
            at: Date.now(),
            splitSeatIds: eligible.map((s) => s.seatId),
            splitRemainder: amount - totalOut,
          })
          break
        }
        case 'undoLast': {
          const entry = findLastUndoable(ledger)
          if (!entry) return base
          const summary = ledgerEntrySummary(entry)
          if (entry.kind === 'uniformBuyIn') {
            if (!entry.prevBalances || entry.prevBalances.length === 0) return base
            const byId = new Map(
              entry.prevBalances.map((p) => [p.seatId, p.balance]),
            )
            for (const s of seats) {
              if (byId.has(s.seatId)) s.balance = byId.get(s.seatId)!
            }
          } else if (entry.kind === 'seatAdjust') {
            const seat = seats.find((s) => s.seatId === entry.fromSeatId)
            if (!seat) return base
            const delta = entry.amount
            if (!Number.isInteger(delta) || delta === 0) return base
            seat.balance = Math.max(0, seat.balance - delta)
          } else if (entry.kind === 'potIn') {
            const seat = seats.find((s) => s.seatId === entry.fromSeatId)
            if (!seat) return base
            const amt = entry.amount
            if (!Number.isInteger(amt) || amt <= 0) return base
            pot = Math.max(0, pot - amt)
            seat.balance += amt
          } else if (entry.kind === 'potOut') {
            const seat = seats.find((s) => s.seatId === entry.toSeatId)
            if (!seat) return base
            const amt = entry.amount
            if (!Number.isInteger(amt) || amt <= 0) return base
            seat.balance = Math.max(0, seat.balance - amt)
            pot += amt
          } else if (entry.kind === 'potSplit') {
            const ids = entry.splitSeatIds ?? []
            const amt = entry.amount
            if (!Number.isInteger(amt) || amt <= 0 || ids.length === 0) return base
            for (const sid of ids) {
              const seat = seats.find((s) => s.seatId === sid)
              if (!seat) return base
              seat.balance = Math.max(0, seat.balance - amt)
            }
            pot += amt * ids.length
          } else {
            const sender = seats.find((s) => s.seatId === entry.fromSeatId)
            const receiver = seats.find((s) => s.seatId === entry.toSeatId)
            if (!sender || !receiver) return base
            const amt = entry.amount
            if (!Number.isInteger(amt) || amt <= 0) return base
            receiver.balance = Math.max(0, receiver.balance - amt)
            sender.balance += amt
          }
          ledger.push({
            id: `led_opt_${op.opId}_undo`,
            kind: 'undo',
            fromSeatId: op.fromSeatId,
            fromName: summary,
            toSeatId: '',
            toName: '',
            amount: entry.amount,
            at: Date.now(),
            undoneId: entry.id,
          })
          break
        }
      }
      return { ...base, seats, pot, ledger, snapshotAt: base.snapshotAt }
    },
    [],
  )

  const forceSnapshot = useCallback(async () => {
    if (!roomCode) return
    const snap = await transport.requestSnapshot(roomCode)
    if (snap) {
      const data = loadRoom(roomCode)
      if (data) {
        applySyncedRoom({ ...data, table: snap }, { force: true })
      } else {
        applyHostSnapshot(snap, { force: true })
      }
    } else {
      refresh()
    }
  }, [roomCode, transport, refresh, applyHostSnapshot, applySyncedRoom])

  const submitOp = useCallback(
    async (
      type: ChipOpType,
      targetSeatId: string,
      extra?: { denom?: number; amount?: number; targetSeatIds?: string[] },
    ) => {
      if (!session || !roomCode || !snapshotRef.current) return

      const key = denomKey(type, extra)
      if (key && inflightKeysRef.current.has(key)) {
        return
      }
      if (key) inflightKeysRef.current.add(key)

      const op: ChipOp = {
        opId: newOpId(),
        roomCode,
        fromSeatId: session.seatId,
        targetSeatId,
        type,
        denom: extra?.denom,
        amount: extra?.amount,
        targetSeatIds: extra?.targetSeatIds,
      }

      const before = snapshotRef.current
      const optimistic = applyLocalOptimistic(op, before)
      setTable(optimistic)
      snapshotRef.current = optimistic
      pendingOpsRef.current.add(op.opId)
      setPendingOps((prev) => new Set(prev).add(op.opId))

      try {
        const ack = await transport.sendOp(op)
        pendingOpsRef.current.delete(op.opId)
        setPendingOps((prev) => {
          const next = new Set(prev)
          next.delete(op.opId)
          return next
        })

        if (!ack.ok) {
          if (ack.reason) pushToast(ack.reason)
          await forceSnapshot()
          return
        }

        // Prefer host snapshot already cached by relaySendOp / local applyChipOp
        // (includes pot) before a follow-up GET — avoids stale overwrite races.
        const cached = loadRoom(roomCode)
        if (cached) {
          applySyncedRoom(cached, { force: true })
        }
        await forceSnapshot()
      } finally {
        pendingOpsRef.current.delete(op.opId)
        if (key) inflightKeysRef.current.delete(key)
      }
    },
    [
      session,
      roomCode,
      applyLocalOptimistic,
      transport,
      pushToast,
      forceSnapshot,
      applySyncedRoom,
    ],
  )

  const startPlaying = useCallback(() => {
    if (!roomCode || !session) return
    void (async () => {
      try {
        const data = await setPhase(roomCode, 'playing')
        if (data) {
          applySyncedRoom(data, { force: true })
          return
        }
        pushToast('开桌失败，请重开一桌或检查网络')
      } catch (e) {
        pushToast(
          e instanceof RelayNetworkError
            ? ACK_REASONS.RELAY_UNREACHABLE
            : '开桌失败，请重开一桌或检查网络',
        )
      }
    })()
  }, [roomCode, session, applySyncedRoom, pushToast])

  const signalHostDisconnect = useCallback(() => {
    if (!roomCode || !session || !room) return
    if (session.seatId !== room.hostSeatId) {
      pushToast('仅桌主可模拟离线')
      return
    }
    void (async () => {
      try {
        await setMemberConnected(roomCode, session.seatId, false)
        const data = await setPhase(roomCode, 'paused')
        if (data) {
          const refreshed = loadRoom(roomCode)
          const next = refreshed ?? data
          applySyncedRoom(next, { force: true })
          pushToast('桌主已离开 · 桌子已暂停')
          return
        }
        pushToast('操作失败，请重试或检查网络')
      } catch (e) {
        pushToast(
          e instanceof RelayNetworkError
            ? ACK_REASONS.RELAY_UNREACHABLE
            : '操作失败，请重试或检查网络',
        )
      }
    })()
  }, [roomCode, session, room, pushToast, applySyncedRoom])

  const resumeTable = useCallback(() => {
    if (!roomCode || !session) return
    void (async () => {
      try {
        const data = await resumeAsHost(roomCode, session.seatId)
        if (!data) {
          pushToast('仅桌主可执行此操作')
          return
        }
        const connected = await setMemberConnected(roomCode, session.seatId, true)
        const next = connected ?? data
        applySyncedRoom(next, { force: true })
      } catch (e) {
        pushToast(
          e instanceof RelayNetworkError
            ? ACK_REASONS.RELAY_UNREACHABLE
            : '开桌失败，请重开一桌或检查网络',
        )
      }
    })()
  }, [roomCode, session, pushToast, applySyncedRoom])

  const claimHost = useCallback(
    (newHostSeatId?: string) => {
      if (!roomCode || !session) return
      const seatId = newHostSeatId ?? session.seatId
      void (async () => {
        const result = await pickNewHost(roomCode, seatId)
        if ('error' in result) {
          pushToast(result.error)
          return
        }
        applySyncedRoom(result, { force: true })
        const id = loadIdentity()
        if (id && id.roomCode.toUpperCase() === roomCode.toUpperCase()) {
          saveIdentity({
            ...id,
            role: roleForSeat(result.room.hostSeatId, id.seatId),
          })
        }
        pushToast(
          seatId === session.seatId ? '你已成为新桌主' : '已选出新桌主',
        )
      })()
    },
    [roomCode, session, pushToast, applySyncedRoom],
  )

  const fillSeats = useCallback(() => {
    if (!roomCode) return
    void (async () => {
      const result = await fillSeatsToMax(roomCode)
      if ('error' in result) {
        pushToast(result.error)
        return
      }
      applySyncedRoom(result, { force: true })
      pushToast(`已填满 ${result.room.members.length} 席`)
    })()
  }, [roomCode, pushToast, applySyncedRoom])

  useEffect(() => {
    if (!roomCode || !session?.name) return
    const onPageHide = () => {
      void setMemberConnected(roomCode, session.seatId, false)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [roomCode, session])

  const bindSession = useCallback((next: Session) => {
    saveSession(next)
    setSession(next)
  }, [])

  const clearSession = useCallback(() => {
    saveSession(null)
    setSession(null)
  }, [])

  const seats: Seat[] =
    table && session ? seatsFromSnapshot(table, session.seatId) : []

  const isHost = !!(session && room && session.seatId === room.hostSeatId)

  const setOffline = useCallback(
    (offline: boolean) => {
      if ('setOffline' in transport && typeof transport.setOffline === 'function') {
        ;(transport as { setOffline: (v: boolean) => void }).setOffline(offline)
      }
      setConnectionState(offline ? 'offline' : 'online')
      if (offline) pushToast('以桌主为准')
    },
    [transport, pushToast],
  )

  return {
    session,
    room,
    table,
    seats,
    isHost,
    connectionState,
    pendingOps,
    toasts,
    pushToast,
    dismissToast,
    refresh,
    submitOp,
    startPlaying,
    signalHostDisconnect,
    resumeTable,
    claimHost,
    fillSeats,
    bindSession,
    clearSession,
    setOffline,
    setPersisted: (data: PersistedRoom) => {
      setPendingOps(new Set())
      pendingOpsRef.current.clear()
      inflightKeysRef.current.clear()
      applySyncedRoom(data, { force: true })
    },
  }
}
