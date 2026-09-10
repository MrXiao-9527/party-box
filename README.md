# party-box · 聚会盒子

移动端优先的聚会工具箱 PWA。切片：**开一桌 / 加入 → 昵称 → 大厅 → 筹码桌** + 座位恢复。

## 本地运行

```bash
npm install
npm run dev
```

默认：`http://127.0.0.1:45321`

```bash
npm run build && npm run preview
```

## Vercel

`vercel.json` 已配置 SPA rewrite（`/r/:code`）。本环境无 Vercel token 时用本地 / preview。

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

WebRTC 仍为接口桩。包名 `party-box` · 显示名 **聚会盒子**。
