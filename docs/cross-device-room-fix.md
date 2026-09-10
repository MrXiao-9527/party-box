# Cross-device room join — bug & fix

## Old bug (repro)

1. Device A: open app → **开一桌** → enter nickname → lobby shows room code `ABCD`.
2. Device B (other browser / phone): **加入** with `ABCD`, or open `/r/ABCD`.
3. **Observed:** toast / redirect with「房间不存在或已解散」.

**Cause:** `RoomState` lived only in `LocalStoreTransport` / `localStorage` on the host device (`party-box:room:CODE`). Device B has no shared store, so `loadRoom` returns null.

LAN-only tricks (same Wi-Fi localStorage) do not help mobile share links.

## Fix

- Add `server/` Node HTTP+WebSocket relay: in-memory rooms, host-authoritative `ChipOp` / ack / snapshot (same rules as `localRoom.applyChipOp`).
- Frontend: when `VITE_RELAY_URL` is set, create/join/mutations/ops use `SharedRelayTransport` + `roomApi`; WebSocket keeps lobby/table in sync. Cache still writes through to localStorage for UI.
- When `VITE_RELAY_URL` is unset, keep `LocalStoreTransport` for solo/dev.

## Verify

```bash
npm install
npm run relay          # terminal 1
npm run test:relay     # create → GET → join → op
npm run build
```

Manual: `npm run dev:all` → two browsers, create on A, join code on B.
