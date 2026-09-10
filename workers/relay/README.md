# workers/relay — Cloudflare Durable Object room relay

Same HTTP + WebSocket protocol as `server/` (Node). One DO instance per `roomCode`.

## Deploy

```bash
cd workers/relay
npm install
npx wrangler deploy
```

Set frontend `VITE_RELAY_URL` to the workers.dev (or custom) URL.

## Local

```bash
npm run dev   # wrangler dev --port 45322
```

Point app `.env.development` `VITE_RELAY_URL=http://127.0.0.1:45322`.

## API (compatible with Node relay)

- `GET /health`
- `POST /rooms` → create
- `GET /rooms/:code`
- `POST /rooms/:code/claim-host|join|phase|ops|…`
- `WS /ws?room=CODE`
