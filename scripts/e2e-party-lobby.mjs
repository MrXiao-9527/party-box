/**
 * Slice A: 局桌 lobby — create/join/deep-link, dual-end seats, error copy.
 * No word/privacy. Spawns vite + node relay.
 *
 * Run: npm run test:e2e-party-lobby
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { clickText, confirmCreateParty, setInputValue } from './e2e-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45381)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45382)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-party-'))
fs.mkdirSync(ART, { recursive: true })

const MISSING = '房间不存在或已解散'
const UNREACHABLE = '连不上房间服务，请重试'
const FULL_2 = '本桌已满（最多2人）'

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
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  return child
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

async function newDevice(browser, { intercept } = {}) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setRequestInterception(true)
  if (intercept) {
    page.on('request', intercept)
  } else {
    blockFonts(page)
  }
  page.setDefaultTimeout(20_000)
  return { ctx, page }
}

async function hostCreateParty(page, { name = '桌主', maxSeats = '8' } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.brand')
  await confirmCreateParty(page, { maxSeats })
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', name)
  await clickText(page, '进入')
  await page.waitForSelector('[data-mode="partyGame"]')
  return page.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
}

async function nickEnter(page, nick) {
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', nick)
  await clickText(page, '进入')
}

function membersOf(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.member-list li .member-name')].map((el) =>
      (el.textContent || '').replace('（我）', '').trim(),
    ),
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

  // Home: 局桌 primary, chip demoted, dice hidden
  const home = await newDevice(browser)
  await home.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await home.page.waitForSelector('.brand')
  const homeText = await home.page.evaluate(() => document.body.innerText)
  assert(homeText.includes('局桌'), 'home has 局桌')
  assert(homeText.includes('开一桌'), 'chip create kept')
  assert(homeText.includes('筹码桌'), 'chip tile kept')
  assert(!homeText.includes('骰子'), 'dice hidden')
  assert(!homeText.includes('随机工具'), 'random tile hidden')
  const primary = await home.page.$eval('.cta-row .btn.primary', (el) =>
    (el.textContent || '').trim(),
  )
  assert(primary === '局桌', `primary CTA is 局桌, got ${primary}`)
  await home.page.screenshot({
    path: `${ART}/party-home.png`,
    fullPage: true,
  })
  await home.ctx.close()
  console.log('PASS: home promotes 局桌, keeps 开一桌, hides dice')

  // Dual-end: typed join
  const host = await newDevice(browser)
  const code = await hostCreateParty(host.page, { name: '桌主A', maxSeats: '8' })
  console.log('code', code)
  assert(/^[A-Z0-9]{4}$/.test(code), `4-digit code, got ${code}`)

  const partyMeta = await host.page.evaluate(() => {
    const el = document.querySelector('[data-mode="partyGame"]')
    return {
      mode: el?.getAttribute('data-mode'),
      phase: el?.getAttribute('data-party-phase'),
      gameId: el?.getAttribute('data-game-id'),
      hasChipStart: [...document.querySelectorAll('button')].some(
        (b) => (b.textContent || '').trim() === '开桌',
      ),
      hasSeat: !!document.querySelector('.seat-self'),
      hasWord: (document.body.innerText || '').includes('你的词'),
    }
  })
  assert(partyMeta.mode === 'partyGame', 'host lobby mode')
  assert(partyMeta.phase === 'lobby', 'host party phase lobby')
  assert(partyMeta.gameId === 'undercover', 'gameId undercover')
  assert(!partyMeta.hasChipStart, 'no chip 开桌')
  assert(!partyMeta.hasSeat, 'no ChipTable')
  assert(!partyMeta.hasWord, 'no private word')

  const guest = await newDevice(browser)
  await guest.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await clickText(guest.page, '加入')
  await guest.page.waitForSelector('.join-panel input')
  await guest.page.type('.join-panel input', code)
  await clickText(guest.page, '进入')
  await nickEnter(guest.page, '玩家B')
  await guest.page.waitForSelector('[data-mode="partyGame"]')

  await host.page.waitForFunction(() =>
    (document.body?.innerText || '').includes('玩家B'),
  )
  const hostMembers = await membersOf(host.page)
  const guestMembers = await membersOf(guest.page)
  assert(hostMembers.includes('桌主A') && hostMembers.includes('玩家B'), 'host seats')
  assert(
    guestMembers.includes('桌主A') && guestMembers.includes('玩家B'),
    'guest seats',
  )
  assert(hostMembers.length === guestMembers.length, 'dual-end seat count')
  await host.page.screenshot({
    path: `${ART}/party-host-lobby.png`,
    fullPage: true,
  })
  await guest.page.screenshot({
    path: `${ART}/party-guest-lobby.png`,
    fullPage: true,
  })
  console.log('PASS: typed join — dual-end seats match, party lobby')
  await guest.ctx.close()
  await host.ctx.close()

  // Deep link + full copy
  const host2 = await newDevice(browser)
  const code2 = await hostCreateParty(host2.page, { name: '桌主C', maxSeats: '2' })
  const guest2 = await newDevice(browser)
  await guest2.page.goto(`${BASE}/r/${code2}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(guest2.page, '玩家D')
  await guest2.page.waitForSelector('[data-mode="partyGame"]')
  await host2.page.waitForFunction(() =>
    (document.body?.innerText || '').includes('玩家D'),
  )
  const host2Members = await membersOf(host2.page)
  const guest2Members = await membersOf(guest2.page)
  assert(host2Members.includes('玩家D') && guest2Members.includes('桌主C'), 'deeplink seats')
  console.log('PASS: /r/CODE deep link seats match')

  const full = await newDevice(browser)
  await full.page.goto(`${BASE}/r/${code2}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(full.page, '乙')
  await full.page.waitForFunction(
    (copy) =>
      [...document.querySelectorAll('.toast, .error, h1')].some((el) =>
        (el.textContent || '').includes(copy),
      ),
    { timeout: 12000 },
    FULL_2,
  )
  await full.page.screenshot({
    path: `${ART}/party-table-full.png`,
    fullPage: true,
  })
  console.log('PASS: full room →', FULL_2)
  await full.ctx.close()
  await guest2.ctx.close()
  await host2.ctx.close()

  // Missing room
  const miss = await newDevice(browser)
  await miss.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await clickText(miss.page, '加入')
  await miss.page.waitForSelector('.join-panel input')
  await miss.page.type('.join-panel input', 'ZZZZ')
  await clickText(miss.page, '进入')
  await miss.page.waitForFunction(
    (copy) =>
      [...document.querySelectorAll('.toast, .error')].some((el) =>
        (el.textContent || '').includes(copy),
      ),
    { timeout: 12000 },
    MISSING,
  )
  await miss.page.screenshot({
    path: `${ART}/party-room-missing.png`,
    fullPage: true,
  })
  console.log('PASS: invalid/missing →', MISSING)
  await miss.ctx.close()

  // Relay fail
  const fail = await newDevice(browser, {
    intercept: async (req) => {
      const url = req.url()
      const method = req.method()
      if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
        await req.abort()
        return
      }
      let pathname = ''
      try {
        pathname = new URL(url).pathname
      } catch {
        pathname = ''
      }
      if (method === 'POST' && (pathname === '/rooms' || pathname === '/rooms/')) {
        await req.abort('failed')
        return
      }
      await req.continue()
    },
  })
  await fail.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await clickText(fail.page, '局桌')
  await fail.page.waitForSelector('[data-create-party]')
  await setInputValue(fail.page, '[data-create-party] [name="maxSeats"]', '8')
  await clickText(fail.page, '确认')
  await fail.page.waitForFunction(
    (copy) =>
      [...document.querySelectorAll('.toast, .error')].some((el) =>
        (el.textContent || '').includes(copy),
      ),
    { timeout: 12000 },
    UNREACHABLE,
  )
  await fail.page.screenshot({
    path: `${ART}/party-relay-fail.png`,
    fullPage: true,
  })
  console.log('PASS: relay fail →', UNREACHABLE)
  await fail.ctx.close()

  console.log('OK e2e-party-lobby')
} catch (e) {
  console.error('FAIL', e)
  process.exitCode = 1
  try {
    const pages = (await browser?.pages?.()) ?? []
    const p = pages[pages.length - 1]
    if (p) {
      await p.screenshot({
        path: `${ART}/party-lobby-fail.png`,
        fullPage: true,
      })
    }
  } catch {
    /* ignore */
  }
} finally {
  try {
    await Promise.race([
      browser?.close() ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ])
  } catch {
    /* ignore */
  }
  await stop(vite)
  await stop(relay)
  fs.rmSync(DATA, { recursive: true, force: true })
  process.exit(process.exitCode ?? 0)
}
