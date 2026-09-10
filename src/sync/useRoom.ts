import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fillSeatsToMax,
  loadRoom,
  loadSession,
  newOpId,
  pickNewHost,
  resumeAsHost,
  saveSession,
  setMemberConnected,
  setPhase,
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
import { defaultTransport, type ChipTransport } from './transport'
import { loadIdentity, roleForSeat, saveIdentity } from './seatRestore'

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
  extra?: { denom?: number; amount?: number },
): string | null {
  if (type === '+denom' || type === '-denom') {
    return `${type}:${extra?.denom ?? ''}`
  }
  if (type === '+batch' || type === '-batch') {
    return `${type}:${extra?.amount ?? ''}`
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

  const refresh = useCallback(() => {
    if (!roomCode) return
    const data = loadRoom(roomCode)
    if (!data) {
      setRoom(null)
      setTable(null)
      snapshotRef.current = null
      return
    }
    setRoom(data.room)
    // Host snapshot is authoritative (localStorage host in this slice).
    setTable(data.table)
    snapshotRef.current = data.table
  }, [roomCode])

  useEffect(() => {
    refresh()
    if (!roomCode) return
    const onStorage = (e: StorageEvent) => {
      if (e.key === `party-box:room:${roomCode.toUpperCase()}`) {
        refresh()
      }
    }
    window.addEventListener('storage', onStorage)
    const poll = window.setInterval(refresh, 800)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.clearInterval(poll)
    }
  }, [roomCode, refresh])

  const applyLocalOptimistic = useCallback(
    (op: ChipOp, base: TableSnapshot): TableSnapshot => {
      const seats = base.seats.map((s) => ({ ...s, balance: Math.max(0, s.balance) }))
      const target = seats.find((s) => s.seatId === op.targetSeatId)
      if (!target && op.type !== 'resetTable') return base

      switch (op.type) {
        case '+denom':
          if (target && op.denom) target.balance = Math.max(0, target.balance + op.denom)
          break
        case '-denom':
          if (target && op.denom) {
            target.balance = Math.max(0, target.balance - op.denom)
          }
          break
        case '+batch':
          if (target && op.amount) target.balance = Math.max(0, target.balance + op.amount)
          break
        case '-batch':
          if (target && op.amount) {
            target.balance = Math.max(0, target.balance - op.amount)
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
      }
      return { ...base, seats, snapshotAt: Date.now() }
    },
    [],
  )

  const forceSnapshot = useCallback(async () => {
    if (!roomCode) return
    const snap = await transport.requestSnapshot(roomCode)
    if (snap) {
      const sanitized: TableSnapshot = {
        ...snap,
        seats: snap.seats.map((s) => ({ ...s, balance: Math.max(0, s.balance) })),
      }
      // Always take host snapshot — never keep stale optimistic local balances.
      setTable(sanitized)
      snapshotRef.current = sanitized
      const data = loadRoom(roomCode)
      if (data) setRoom(data.room)
    } else {
      refresh()
    }
  }, [roomCode, transport, refresh])

  const submitOp = useCallback(
    async (
      type: ChipOpType,
      targetSeatId: string,
      extra?: { denom?: number; amount?: number },
    ) => {
      if (!session || !roomCode || !snapshotRef.current) return

      const key = denomKey(type, extra)
      if (key && inflightKeysRef.current.has(key)) {
        // Drop same-key tap while awaiting ack
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
      }

      const before = snapshotRef.current
      const optimistic = applyLocalOptimistic(op, before)
      setTable(optimistic)
      snapshotRef.current = optimistic
      setPendingOps((prev) => new Set(prev).add(op.opId))

      try {
        const ack = await transport.sendOp(op)
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

        await forceSnapshot()
      } finally {
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
    ],
  )

  const startPlaying = useCallback(() => {
    if (!roomCode || !session) return
    const data = setPhase(roomCode, 'playing')
    if (data) {
      setRoom(data.room)
      setTable(data.table)
      snapshotRef.current = data.table
    }
  }, [roomCode, session])

  const signalHostDisconnect = useCallback(() => {
    if (!roomCode || !session || !room) return
    if (session.seatId !== room.hostSeatId) {
      pushToast('仅桌主可模拟离线')
      return
    }
    // Mark host disconnected; force pause for QA even from lobby.
    setMemberConnected(roomCode, session.seatId, false)
    const data = setPhase(roomCode, 'paused')
    if (data) {
      const refreshed = loadRoom(roomCode)
      const next = refreshed ?? data
      setRoom(next.room)
      setTable(next.table)
      snapshotRef.current = next.table
      pushToast('桌主已离开 · 桌子已暂停')
    }
  }, [roomCode, session, room, pushToast])

  const resumeTable = useCallback(() => {
    if (!roomCode || !session) return
    const data = resumeAsHost(roomCode, session.seatId)
    if (!data) {
      pushToast('仅桌主可执行此操作')
      return
    }
    const connected = setMemberConnected(roomCode, session.seatId, true)
    const next = connected ?? data
    setRoom(next.room)
    setTable(next.table)
    snapshotRef.current = next.table
  }, [roomCode, session, pushToast])

  const claimHost = useCallback(
    (newHostSeatId?: string) => {
      if (!roomCode || !session) return
      const seatId = newHostSeatId ?? session.seatId
      const result = pickNewHost(roomCode, seatId)
      if ('error' in result) {
        pushToast(result.error)
        return
      }
      setRoom(result.room)
      setTable(result.table)
      snapshotRef.current = result.table
      // Keep party-box:identity.role in sync with hostSeatId after handoff.
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
    },
    [roomCode, session, pushToast],
  )

  const fillSeats = useCallback(() => {
    if (!roomCode) return
    const result = fillSeatsToMax(roomCode)
    if ('error' in result) {
      pushToast(result.error)
      return
    }
    setRoom(result.room)
    setTable(result.table)
    snapshotRef.current = result.table
    pushToast(`已填满 ${result.room.members.length} 席`)
  }, [roomCode, pushToast])

  useEffect(() => {
    if (!roomCode || !session?.name) return
    const onPageHide = () => {
      setMemberConnected(roomCode, session.seatId, false)
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
        transport.setOffline(offline)
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
      // Silent restore / takeover: bind host snapshotAt balances, drop optimistic.
      setPendingOps(new Set())
      inflightKeysRef.current.clear()
      setRoom(data.room)
      setTable(data.table)
      snapshotRef.current = data.table
    },
  }
}
