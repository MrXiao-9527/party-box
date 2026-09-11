# party-box · 聚会盒子

移动端优先的聚会工具箱 PWA。切片：**开一桌 / 加入 → 昵称 → 大厅 → 筹码桌** + 座位恢复。

**真·双端验**：设置 `VITE_RELAY_URL` 并启动中继后，两台手机/两个浏览器可用同一房码加入并同步大厅与筹码（非 localStorage、非仅 LAN）。

## 稳预览验（固定 HTTPS + 中继持久化）

见 [`docs/stable-preview.md`](docs/stable-preview.md)。QA 标签：**稳预览验**。

- **禁止** ephemeral `trycloudflare` / 临时 tunnel 作为验收预览。
- Cloudflare Worker DO（推荐）或 Node `PARTY_BOX_DATA_DIR` 文件快照，重启后同房码恢复座位/余额/底池/流水/阶段。
- 无法恢复时 toast 必须为：`房间服务已重启，请重新开桌`，并回首页（禁止僵尸「等候开桌」）。

```bash
npm run test:relay-persist
# UI: node scripts/e2e-relay-restart.mjs
```

## 本地运行（跨设备必开中继）

```bash
npm install
npm run dev:all
```

- 前端：`http://127.0.0.1:45321`
- 中继：`http://127.0.0.1:45322`（`.env.development` → `VITE_RELAY_URL`）

仅单机可 `npm run dev`（无 `VITE_RELAY_URL` 时走 LocalStore）。

```bash
npm run build && npm run preview
```

**真·双端验 preview**（构建时必须带中继地址，并另开中继进程）：

```bash
npm run relay
VITE_RELAY_URL=http://127.0.0.1:45322 npm run build && npm run preview
```

两浏览器冒烟：`npm run test:relay`；UI：`node scripts/e2e-two-browser.mjs`（需 `dev:all` 或 preview+relay）。

## 共享房间中继（P0 hotfix）

**旧 bug**：房间只在开房设备 `localStorage`。另一设备同码 →「房间不存在或已解散」。

**修复**：共享中继保存 `RoomState`；`VITE_RELAY_URL` 启用后走 `RemoteStoreTransport`。未配置则 LocalStore（solo/dev）。

| Toast（勿混用） | 何时 |
|----------------|------|
| `房间不存在或已解散` | 中继 404 / 房间确实不存在 |
| `连不上房间服务，请重试` | 中继网络/超时/5xx |

### 环境变量

| 变量 | 端 | 说明 |
|------|----|------|
| `VITE_RELAY_URL` | 前端构建 | 中继 origin |
| `PORT` | Node 中继 | 默认 `45322` |
| `CORS_ORIGIN` | Node 中继 | 允许的前端 origin；默认 `*` |
| `PARTY_BOX_DATA_DIR` | Node 中继 | 持久化目录（默认 `./data`，写 `rooms.json`） |

### 部署 A — Cloudflare Worker + Durable Object（推荐生产）

```bash
cd workers/relay
npm install
npx wrangler login   # 首次
npm run deploy       # → https://party-box-relay.<account>.workers.dev
```

Vercel / 前端环境变量：

```
VITE_RELAY_URL=https://party-box-relay.<account>.workers.dev
```

本地用 Worker 代替 Node 中继：`cd workers/relay && npm run dev`（端口 45322）。

### 部署 B — Node WebSocket 中继（本地 / VPS）

```bash
npm install
PORT=8080 CORS_ORIGIN=https://your-app.vercel.app npm run relay
```

`GET /health` → `{ ok: true }`。房间空闲约 4h 清除。

### 两浏览器验收（真·双端验）

1. `npm run dev:all`
2. 浏览器 A：开一桌 → 昵称 → 房码
3. 浏览器 B（无痕）：加入同码或 `/r/CODE`
4. 两边大厅同一成员列表；开桌后筹码互相同步

## Vercel

`vercel.json` 已 SPA rewrite。设置 `VITE_RELAY_URL` 后重新部署前端。

## QA DEV

`/r/CODE?dev=1` → 模拟桌主暂停、填满 8 席、断开连接条。

## 座位恢复

localStorage `party-box:identity`：`{ roomCode, seatId, name, role }`

| 情况 | 行为 |
|------|------|
| seatId 仍在房 | 静默恢复 |
| 原席被占 | toast「原席被占，新坐一席」→ 新 seatId |
| 原席被占且满座 | 「本桌已满（最多X人）」X=开房人数 |
| 首次进房 | 静默进昵称门 |
| identity 丢失 | 「本地身份丢失，已为你新坐一席」 |
| 房间不存在 | 回首页 +「房间已结束」 |
| 双标签 | 「该席已在其他标签打开」+ 接管 |

## 验收

1. ≤3 步到桌  2. 无昵称挡桌；playing 直达  3. 非桌主无开桌；暂停不自动转让  
4. 人数 2–8（默认 8）  5. 己席 `#FBBF24` + 面额色  6. 点按/长按/锁定/重置 + 中文 fail toast  
7. 断线条 + 房码 `A-Z0-9` /「房码无效」；QR/复制链接固定 `https://party-box-43z.pages.dev/r/{CODE}`  
8. **真·双端验**：跨设备同房码或扫码可加入并同步（需中继）

包名 `party-box` · 显示名 **聚会盒子**。
