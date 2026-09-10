# party-box · 聚会盒子

移动端优先的聚会工具箱 PWA。切片：**开一桌 / 加入 → 昵称 → 大厅 → 筹码桌** + 座位恢复。

## 本地运行（跨设备必开中继）

```bash
npm install
npm run dev:all
```

- 前端：`http://127.0.0.1:45321`
- 中继：`http://127.0.0.1:45322`（由 `.env.development` 的 `VITE_RELAY_URL` 指向）

仅本地单机（不跨浏览器/手机）可只跑 `npm run dev`；未设置 `VITE_RELAY_URL` 时仍走 `LocalStoreTransport`（localStorage）。

```bash
npm run build && npm run preview
```

跨设备 preview 需另开中继，并在构建时带上 `VITE_RELAY_URL`：

```bash
npm run relay
VITE_RELAY_URL=http://127.0.0.1:45322 npm run build
npm run preview
```

## 共享房间中继（P0 hotfix）

**旧 bug**：房间只写在开房设备的 `localStorage`（`LocalStoreTransport`）。另一台手机/浏览器用同一房码或 `/r/CODE` 会得到「房间不存在或已解散」。

**修复**：`server/` 提供短生命周期内存房间中继（HTTP + WebSocket）。生产构建设置 `VITE_RELAY_URL` 后，创建/加入/ChipOp/快照走 `SharedRelayTransport`；大厅与筹码桌通过 WebSocket 订阅同一 `RoomState`。未配置时仍用 LocalStore（solo/dev）。

### 环境变量

| 变量 | 端 | 说明 |
|------|----|------|
| `VITE_RELAY_URL` | 前端构建 | 中继 origin，如 `https://relay.example.com` 或 `http://127.0.0.1:45322` |
| `PORT` | 中继 | 默认 `45322` |
| `CORS_ORIGIN` | 中继 | 逗号分隔允许的前端 origin；默认 `*` |

### 部署中继

任意能跑 Node 的平台（Railway / Fly / Render / 自有 VPS）：

```bash
npm install
npm run relay
# 或: PORT=8080 CORS_ORIGIN=https://your-app.vercel.app node server/index.mjs
```

健康检查：`GET /health` → `{ ok: true }`。

房间空闲约 **4 小时** 后从内存清除。

### 两浏览器验收

1. `npm run dev:all`
2. 浏览器 A：开一桌 → 昵称 → 记下房码
3. 浏览器 B（无痕或另一设备）：加入同一房码，或打开 `/r/CODE`
4. 两边大厅应看到同一成员列表；开桌后筹码操作互相可见

烟雾测试（中继已启动）：`npm run test:relay`

## Vercel（前端）

`vercel.json` 已配置 SPA rewrite（`/r/:code`）。在 Vercel 项目 Environment Variables 设置：

```
VITE_RELAY_URL=https://<your-relay-host>
```

然后重新部署前端。中继需单独部署（见上）。

```bash
npx vercel
```

## QA DEV

`/r/CODE?dev=1` → 模拟桌主暂停、填满 8 席、断开连接条。

## 座位恢复

localStorage `party-box:identity`：`{ roomCode, seatId, name, role }`

| 情况 | 行为 |
|------|------|
| seatId 仍在房 | 静默恢复（余额/桌主/暂停态；paused 不自动重开） |
| 原席被占 | toast「原席被占，新坐一席」→ 昵称预填 → 新 seatId（旧 seatId 作废） |
| 原席被占且满座 | 仅 toast「本桌已满（最多8人）」，不进新席 |
| 首次进房（从未存过该房 seatId） | 静默进昵称门，无 toast |
| 曾有该房 seatId 但 identity 丢失 | toast「本地身份丢失，已为你新坐一席」 |
| 房间不存在 | 回首页 +「房间已结束」 |
| 双标签 | 第二标签「该席已在其他标签打开」+「接管」；旧标签只读（禁 ChipOp）+「退出房间」清本地 |

## 验收

1. ≤3 步到桌  2. 无昵称挡桌；playing 直达  3. 非桌主无开桌；暂停不自动转让  
4. 最多 8 席  5. 己席 `#FBBF24` + 面额色  6. 点按/长按/锁定/重置 + 中文 fail toast  
7. 断线条 + 房码 `A-Z0-9` /「房码无效」  
8. **跨设备同房码可加入并同步大厅/筹码（需中继）**

包名 `party-box` · 显示名 **聚会盒子**。
