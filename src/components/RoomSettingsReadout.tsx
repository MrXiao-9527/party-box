import type { RoomState } from '../types'

interface RoomSettingsReadoutProps {
  room: Pick<RoomState, 'buyInN' | 'maxSeats' | 'smallBlind' | 'bigBlind'>
}

/** Read-only table settings (locked after creation / 开桌). */
export function RoomSettingsReadout({ room }: RoomSettingsReadoutProps) {
  const blinds =
    room.smallBlind || room.bigBlind
      ? `${room.smallBlind ?? '—'} / ${room.bigBlind ?? '—'}`
      : null

  return (
    <dl className="room-settings" aria-label="桌面设置">
      <div>
        <dt>买入</dt>
        <dd>{room.buyInN > 0 ? room.buyInN : '—'}</dd>
      </div>
      <div>
        <dt>人数</dt>
        <dd>{room.maxSeats}</dd>
      </div>
      {blinds && (
        <div>
          <dt>盲注</dt>
          <dd>{blinds}</dd>
        </div>
      )}
    </dl>
  )
}
