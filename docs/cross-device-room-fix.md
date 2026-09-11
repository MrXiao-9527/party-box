# Cross-device room join — bug & fix

## Old bug (repro)

1. Device A: **开一桌** → nickname → lobby code `ABCD`.
2. Device B: **加入** `ABCD` or `/r/ABCD`.
3. **Observed:** 「房间不存在或已解散」.

**Cause:** `RoomState` only in host `localStorage` (`LocalStoreTransport`).

## Fix

- Shared relay (Node `server/` and/or Cloudflare Worker + Durable Object `workers/relay/`)
- Node relay persists to `PARTY_BOX_DATA_DIR/rooms.json` (survives process remount)
- Cloudflare DO `persist()` survives Worker remount
- `VITE_RELAY_URL` → `SharedRelayTransport` + `roomApi` (bake at **build** time for 稳预览验)
- Unset → `LocalStoreTransport` (solo/dev)
- Toasts: missing →「房间不存在或已解散」; network →「连不上房间服务，请重试」;
  was-in-room + wipe →「房间服务已重启，请重新开桌」+ home (no zombie lobby)

See [`docs/stable-preview.md`](stable-preview.md).

## Verify（真·双端验）

```bash
npm install
npm run relay && npm run test:relay
npm run build
npm run dev:all   # then: node scripts/e2e-two-browser.mjs
```

Cloudflare: `cd workers/relay && npm i && npx wrangler deploy`
