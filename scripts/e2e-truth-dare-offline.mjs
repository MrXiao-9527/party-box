/**
 * Gate ④: close a player's tab → seat goes 离线; next-draw / default-answerer
 * skip the ghost. Spawns vite + node relay.
 *
 * Run: npm run test:e2e-truth-dare-offline
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { clickText, confirmCreateParty } from './e2e-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45393)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45394)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-td-off-'))
fs.mkdirSync(ART, { recursive: true })

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function waitUrl(url, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`timeout waiting ${url}`)
}

function spawnLogged(cmd, args, env) {
  return spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function stop(child) {
  if (!child || child.exitCode != null || child.signalCode) return
  await Promise.race([
    new Promise((resolve) => {
      child.once('exit', () => resolve())
      try {
        child.kill('SIGTERM')
      } catch {
        resolve()
      }
    }),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ])
  if (child.exitCode == null && child.signalCode == null) {
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
}

function blockFonts(page) {
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
      void req.abort()
      return
    }
    void req.continue()
  })
}

async function newDevice(browser) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setRequestInterception(true)
  blockFonts(page)
  page.setDefaultTimeout(20_000)
  return { ctx, page }
}

async function hostCreate(page, name) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.brand')
  await confirmCreateParty(page, { maxSeats: '8', gameId: 'truthDare' })
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', name)
  await clickText(page, '进入')
  await page.waitForSelector('[data-mode="partyGame"][data-game-id="truthDare"]')
  return page.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
}

async function nickEnter(page, nick) {
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', nick)
  await clickText(page, '进入')
}

function memberOf(page, name) {
  return page.evaluate((n) => {
    const items = [...document.querySelectorAll('.member-list li')]
    const li = items.find((el) => {
      const raw = el.querySelector('.member-name')?.textContent || ''
      return raw.replace('（我）', '').trim() === n
    })
    return {
      found: !!li,
      online: !!li?.querySelector('.online-dot'),
      offline: !!li?.querySelector('.offline-dot'),
      isDrawer: li?.getAttribute('data-is-drawer') === 'true',
      isAnswerer: li?.getAttribute('data-is-answerer') === 'true',
    }
  }, name)
}

function stageOf(page) {
  return page.evaluate(
    () => document.querySelector('[data-stage-copy]')?.textContent?.trim() || '',
  )
}

async function clickNamed(page, attr, name) {
  await page.waitForFunction(
    (a, n) =>
      [...document.querySelectorAll(`[${a}]`)].some(
        (b) => (b.textContent || '').trim() === n,
      ),
    {},
    attr,
    name,
  )
  await page.evaluate(
    (a, n) => {
      const b = [...document.querySelectorAll(`[${a}]`)].find(
        (el) => (el.textContent || '').trim() === n,
      )
      b?.click()
    },
    attr,
    name,
  )
}

let relay
let vite
let browser

try {
  relay = spawnLogged(process.execPath, ['server/index.mjs'], {
    PORT: String(RELAY),
    PARTY_BOX_DATA_DIR: DATA,
  })
  await waitUrl(`${RELAY_URL}/health`)

  vite = spawnLogged(
    process.execPath,
    [
      path.join(ROOT, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(FE),
    ],
    { VITE_RELAY_URL: RELAY_URL },
  )
  await waitUrl(BASE)

  browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: 'new',
    protocolTimeout: 60_000,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    defaultViewport: { width: 390, height: 844 },
  })

  const host = await newDevice(browser)
  const code = await hostCreate(host.page, '桌主')
  const p2 = await newDevice(browser)
  await p2.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(p2.page, '玩家B')
  await p2.page.waitForSelector('[data-mode="partyGame"][data-game-id="truthDare"]')
  const p3 = await newDevice(browser)
  await p3.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(p3.page, '玩家C')
  await p3.page.waitForSelector('[data-mode="partyGame"][data-game-id="truthDare"]')

  await host.page.waitForFunction(
    () =>
      (document.body?.innerText || '').includes('玩家B') &&
      (document.body?.innerText || '').includes('玩家C'),
  )
  assert((await memberOf(host.page, '玩家B')).online, 'B online before close')
  assert((await memberOf(host.page, '玩家C')).online, 'C online before close')

  await clickText(host.page, '指定抽题人')
  await host.page.waitForSelector('[data-drawer-picker]')
  await clickNamed(host.page, 'data-pick-drawer', '玩家B')
  await host.page.waitForFunction(
    () =>
      (document.querySelector('[data-stage-copy]')?.textContent || '').includes(
        '等待 玩家B 抽题',
      ),
  )
  await p3.page.waitForFunction(
    () =>
      (document.querySelector('[data-stage-copy]')?.textContent || '').includes(
        '等待 玩家B 抽题',
      ),
  )

  await p2.page.close()
  await host.page.waitForFunction(
    () => {
      const items = [...document.querySelectorAll('.member-list li')]
      const li = items.find((el) => {
        const raw = el.querySelector('.member-name')?.textContent || ''
        return raw.replace('（我）', '').trim() === '玩家B'
      })
      return !!li?.querySelector('.offline-dot')
    },
    { timeout: 8000 },
  )
  await p3.page.waitForFunction(
    () => {
      const items = [...document.querySelectorAll('.member-list li')]
      const li = items.find((el) => {
        const raw = el.querySelector('.member-name')?.textContent || ''
        return raw.replace('（我）', '').trim() === '玩家B'
      })
      return !!li?.querySelector('.offline-dot')
    },
    { timeout: 8000 },
  )
  const hostB = await memberOf(host.page, '玩家B')
  const p3B = await memberOf(p3.page, '玩家B')
  assert(hostB.offline && !hostB.online, 'host sees B 离线 after tab close')
  assert(p3B.offline && !p3B.online, 'C sees B 离线 after tab close')
  assert(!(await memberOf(host.page, '玩家B')).isDrawer, 'B no longer drawer')
  const afterCloseStage = await stageOf(host.page)
  assert(
    afterCloseStage === '等待 玩家C 抽题',
    `drawing auto-advance, got ${afterCloseStage}`,
  )
  assert((await stageOf(p3.page)) === '等待 玩家C 抽题', 'C sees new drawer')
  const snap = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  const bSeat = snap.data.room.members.find((m) => m.name === '玩家B')
  const cSeat = snap.data.room.members.find((m) => m.name === '玩家C')
  assert(bSeat && bSeat.connected === false, 'GET B connected=false')
  assert(snap.data.room.party.drawerSeatId === cSeat.seatId, 'GET drawer=C')

  await host.page.screenshot({
    path: `${ART}/truth-dare-tabclose-offline.png`,
    fullPage: true,
  })

  await clickText(host.page, '指定抽题人')
  await host.page.waitForSelector('[data-drawer-picker]')
  await clickNamed(host.page, 'data-pick-drawer', '桌主')
  await host.page.waitForFunction(
    () =>
      (document.querySelector('[data-stage-copy]')?.textContent || '').includes(
        '等待 桌主 抽题',
      ),
  )
  await clickText(host.page, '直接出题')
  await host.page.waitForSelector('[data-prompt-text]')
  await p3.page.waitForSelector('[data-prompt-text]')
  assert((await stageOf(host.page)) === '轮到 玩家C 答', 'default answerer skips ghost B')
  assert((await stageOf(p3.page)) === '轮到 玩家C 答', 'C sees default self')
  const afterDraw = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  assert(
    afterDraw.data.room.party.answererSeatId === cSeat.seatId,
    'GET answerer=C not ghost B',
  )
  assert(afterDraw.data.room.party.answererSeatId !== bSeat.seatId, 'answerer not B')

  await host.page.screenshot({
    path: `${ART}/truth-dare-tabclose-answerer.png`,
    fullPage: true,
  })
  console.log('PASS: tab close → offline + pointers skip ghost')

  await p3.ctx.close()
  await host.ctx.close()
} finally {
  if (browser) await browser.close().catch(() => {})
  await stop(vite)
  await stop(relay)
  fs.rmSync(DATA, { recursive: true, force: true })
}
