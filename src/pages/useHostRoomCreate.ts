import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createEmptyHostRoom } from '../sync/roomApi'
import { ACK_REASONS, parseRoomCreate, type RoomCreateInput } from '../types'

export function useHostRoomCreate() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([])
  const busyRef = useRef(false)

  const toast = (text: string) => {
    const id = `t_${Date.now()}`
    setToasts((prev) => [...prev, { id, text }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 2800)
  }

  const runCreate = async (
    input: RoomCreateInput,
    opts?: { strictBuyIn?: boolean },
  ) => {
    const parsed = parseRoomCreate(input, opts)
    if (!parsed.ok) {
      setCreateError(parsed.error)
      toast(parsed.error)
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setCreateError('')
    try {
      const payload: RoomCreateInput =
        parsed.mode === 'chip'
          ? {
              buyInN: parsed.buyInN,
              maxSeats: parsed.maxSeats,
              smallBlind: parsed.smallBlind,
              bigBlind: parsed.bigBlind,
              mode: 'chip',
            }
          : {
              maxSeats: parsed.maxSeats,
              mode: 'partyGame',
              gameId: input.gameId,
            }
      const result = await createEmptyHostRoom(payload)
      if ('error' in result) {
        setCreateError(result.error)
        toast(result.error)
        return
      }
      navigate(`/r/${result.session.roomCode}`)
    } catch {
      const msg = ACK_REASONS.RELAY_UNREACHABLE
      setCreateError(msg)
      toast(msg)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return {
    busy,
    createError,
    toasts,
    runCreate,
    dismissToast: (id: string) =>
      setToasts((prev) => prev.filter((t) => t.id !== id)),
  }
}
