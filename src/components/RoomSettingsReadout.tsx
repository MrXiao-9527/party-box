import { tableSettingsView, type RoomState } from '../types'

interface RoomSettingsReadoutProps {
  room: Pick<RoomState, 'buyInN' | 'maxSeats' | 'smallBlind' | 'bigBlind'>
}

/** Read-only table settings (locked after creation / 开桌). Never 「—」. */
export function RoomSettingsReadout({ room }: RoomSettingsReadoutProps) {
  const view = tableSettingsView(room)

  return (
    <dl className="room-settings" aria-label="桌面设置">
      <div>
        <dt>买入</dt>
        <dd data-setting="buyInN">{view.buyInN}</dd>
      </div>
      <div>
        <dt>人数</dt>
        <dd data-setting="maxSeats">{view.maxSeats}</dd>
      </div>
      {view.smallBlind != null && (
        <div>
          <dt>小盲</dt>
          <dd data-setting="smallBlind">{view.smallBlind}</dd>
        </div>
      )}
      {view.bigBlind != null && (
        <div>
          <dt>大盲</dt>
          <dd data-setting="bigBlind">{view.bigBlind}</dd>
        </div>
      )}
    </dl>
  )
}
