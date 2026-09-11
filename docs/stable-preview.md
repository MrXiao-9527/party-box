# 稳预览验 — Stable HTTPS preview + durable relay

QA label: **「稳预览验」**

## Acceptance

1. Fixed HTTPS frontend URL (not `*.trycloudflare.com` ephemeral tunnel). Survives hard refresh / overnight.
2. Relay remount restores same room snapshot (seats / balances / pot / ledger / phase). If restore impossible → toast exactly `房间服务已重启，请重新开桌` + home. No zombie「等候开桌」.
3. 「开桌」stays in playing; dual-end pot-in still consistent.

## Preferred production path (Cloudflare DO)

Durable Object already `persist()`s room state in `workers/relay`.

```bash
cd workers/relay
npm install
npx wrangler login
npm run deploy
# → https://party-box-relay.<account>.workers.dev
```

Frontend (Vercel / Cloudflare Pages) — bake relay at **build** time:

```bash
VITE_RELAY_URL=https://party-box-relay.<account>.workers.dev npm run build
# deploy dist/ to fixed HTTPS host (Vercel project URL / custom domain)
```

Vercel:

```bash
vercel link
vercel env add VITE_RELAY_URL production   # paste workers.dev URL
vercel --prod
```

## Node relay durable fallback (VPS)

Rooms survive `node server/index.mjs` remount via `PARTY_BOX_DATA_DIR/rooms.json`:

```bash
export PARTY_BOX_DATA_DIR=/var/lib/party-box
export PORT=8080
export CORS_ORIGIN=https://your-fixed-frontend.example
npm run relay
```

Verify remount:

```bash
npm run test:relay-persist
```

## Forbidden for QA「稳预览验」

- Ephemeral `cloudflared tunnel --url` / trycloudflare links that rotate
- Frontend built **without** `VITE_RELAY_URL` (falls back to localStorage)
- In-memory-only Node relay without `PARTY_BOX_DATA_DIR` writable disk

## Local verification

```bash
npm install
npm run test:relay-persist
npm run relay &   # uses ./data by default
VITE_RELAY_URL=http://127.0.0.1:45322 npm run dev
# wipe test (UI): node scripts/e2e-relay-restart.mjs
```
