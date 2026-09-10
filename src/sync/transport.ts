import type { ChipAck, ChipOp, TableSnapshot } from '../types'
import { applyChipOp, loadRoom } from '../store/localRoom'

/**
 * Transport abstraction. LocalStore is the working solo/host path;
 * WebRTC DataChannel is stubbed for a later multiplayer slice.
 */
export interface ChipTransport {
  sendOp(op: ChipOp): Promise<ChipAck>
  requestSnapshot(roomCode: string): Promise<TableSnapshot | null>
  /** Soft disconnect signal for UI strip / toast copy. */
  getConnectionState(): 'online' | 'offline'
}

const ACK_TIMEOUT_MS = 2500

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (v) => {
        window.clearTimeout(t)
        resolve(v)
      },
      (e) => {
        window.clearTimeout(t)
        reject(e)
      },
    )
  })
}

/** In-memory / localStorage host-authoritative transport (solo + same-browser join). */
export class LocalStoreTransport implements ChipTransport {
  private offline = false

  setOffline(offline: boolean): void {
    this.offline = offline
  }

  getConnectionState(): 'online' | 'offline' {
    return this.offline ? 'offline' : 'online'
  }

  async sendOp(op: ChipOp): Promise<ChipAck> {
    if (this.offline) {
      return {
        opId: op.opId,
        ok: false,
        reason: '以桌主为准',
      }
    }

    const run = async (): Promise<ChipAck> => {
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 80))
      return applyChipOp(op).ack
    }

    try {
      return await withTimeout(run(), ACK_TIMEOUT_MS)
    } catch {
      return {
        opId: op.opId,
        ok: false,
        reason: '以桌主为准',
      }
    }
  }

  async requestSnapshot(roomCode: string): Promise<TableSnapshot | null> {
    const data = loadRoom(roomCode)
    return data?.table ?? null
  }
}

/**
 * Stub WebRTC DataChannel transport — interface only.
 * Multiplayer peer sync is intentionally not implemented in this slice.
 */
export class WebRtcDataChannelTransport implements ChipTransport {
  getConnectionState(): 'online' | 'offline' {
    return 'offline'
  }

  async sendOp(op: ChipOp): Promise<ChipAck> {
    return {
      opId: op.opId,
      ok: false,
      reason: '以桌主为准',
    }
  }

  async requestSnapshot(): Promise<TableSnapshot | null> {
    return null
  }
}

export const defaultTransport = new LocalStoreTransport()
