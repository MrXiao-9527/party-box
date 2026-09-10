# Cross-device room join — bug & fix

## Old bug (repro)

1. Device A: **开一桌** → nickname → lobby code `ABCD`.
2. Device B: **加入** `ABCD` or `/r/ABCD`.
3. **Observed:** 「房间不存在或已解散」.

**Cause:** `RoomState` only in host `localStorage` (`LocalStoreTransport`).

## Fix

- Shared relay (Node `server/` and/or Cloudflare Worker + Durable Object `workers/relay/`)
- `VITE_RELAY_URL` → `SharedRelayTransport` + `roomApi`
- Unset → `LocalStoreTransport` (solo/dev)
- Toasts: missing →「房间不存在或已解散」; network →「连不上房间服务，请重试」

## Verify（真·双端验）

```bash
npm install
npm run relay && npm run test:relay
npm run build
npm run dev:all   # then: node scripts/e2e-two-browser.mjs
```

Cloudflare: `cd workers/relay && npm i && npx wrangler deploy`
