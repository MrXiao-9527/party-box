/**
 * Slice A+B: 真心话大冒险 enter-room + host draw/redraw.
 * Dual-end same public prompt; non-host cannot draw; redraw changes text.
 * Spawns vite + node relay.
 *
 * Run: npm run test:e2e-party-truth-dare
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { clickText, confirmCreateParty, setInputValue } from './e2e-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45391)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45392)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-td-'))
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

async function hostCreateTruthDare(page, { name = '桌主', maxSeats = '8' } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.brand')
  await confirmCreateParty(page, { maxSeats, gameId: 'truthDare' })
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

function membersOf(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.member-list li .member-name')].map((el) =>
      (el.textContent || '').replace('（我）', '').trim(),
    ),
  )
}

function promptOf(page) {
  return page.evaluate(() => {
    const area = document.querySelector('[data-prompt-area]')
    const textEl = document.querySelector('[data-prompt-text]')
    return {
      id: area?.getAttribute('data-prompt-id') || '',
      type: area?.getAttribute('data-prompt-type') || '',
      text: textEl?.getAttribute('data-prompt-text') || textEl?.textContent?.trim() || '',
    }
  })
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

  const home = await newDevice(browser)
  await home.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await home.page.waitForSelector('.brand')
  await clickText(home.page, '局桌')
  await home.page.waitForSelector('[data-create-party]')
  const homeText = await home.page.evaluate(() => document.body.innerText)
  assert(homeText.includes('谁是卧底'), 'home keeps 谁是卧底')
  assert(homeText.includes('真心话大冒险'), 'home has 真心话大冒险')
  const selected = await home.page.$eval('[data-create-party]', (el) =>
    el.getAttribute('data-selected-game'),
  )
  assert(selected === 'undercover', 'default game remains undercover')
  await home.page.screenshot({
    path: `${ART}/truth-dare-home-pick.png`,
    fullPage: true,
  })
  await home.ctx.close()
  console.log('PASS: home keeps 谁是卧底 and adds 真心话大冒险')

  const host = await newDevice(browser)
  const code = await hostCreateTruthDare(host.page, { name: '桌主A', maxSeats: '8' })
  console.log('code', code)
  assert(/^[A-Z0-9]{4}$/.test(code), `4-digit code, got ${code}`)

  const meta = await host.page.evaluate(() => {
    const el = document.querySelector('[data-mode="partyGame"]')
    const body = document.body.innerText || ''
    const draw = document.querySelector('[data-draw]')
    return {
      mode: el?.getAttribute('data-mode'),
      phase: el?.getAttribute('data-party-phase'),
      gameId: el?.getAttribute('data-game-id'),
      hasPromptArea: !!document.querySelector('[data-prompt-area]'),
      hasDraw: !!draw,
      drawDisabled: draw?.disabled === true,
      hasRedraw: !!document.querySelector('[data-redraw]'),
      hasStart: [...document.querySelectorAll('button')].some(
        (b) => (b.textContent || '').trim() === '开始游戏',
      ),
      hasWord: body.includes('你的词'),
      hasSeat: !!document.querySelector('.seat-self'),
      hasPrivate: !!document.querySelector('.private-screen'),
      hasQr: !!document.querySelector('[data-join-url]'),
      hasHost: body.includes('桌主'),
    }
  })
  assert(meta.mode === 'partyGame', 'host lobby mode')
  assert(meta.phase === 'lobby', 'host party phase lobby')
  assert(meta.gameId === 'truthDare', 'gameId truthDare')
  assert(meta.hasPromptArea, 'public prompt area')
  assert(meta.hasDraw && !meta.drawDisabled, 'host 抽题 enabled')
  assert(!meta.hasRedraw, 'no 重抽 before draw')
  assert(!meta.hasStart, 'no undercover 开始游戏')
  assert(!meta.hasWord, 'no SeatPrivate word')
  assert(!meta.hasPrivate, 'no private screen')
  assert(!meta.hasSeat, 'no ChipTable')
  assert(meta.hasQr, 'QR invite')
  assert(meta.hasHost, 'host badge visible')

  const guest = await newDevice(browser)
  await guest.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await clickText(guest.page, '加入')
  await guest.page.waitForSelector('.join-panel input')
  await guest.page.type('.join-panel input', code)
  await clickText(guest.page, '进入')
  await nickEnter(guest.page, '玩家B')
  await guest.page.waitForSelector('[data-mode="partyGame"][data-game-id="truthDare"]')

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

  const guestMeta = await guest.page.evaluate(() => {
    const body = document.body.innerText || ''
    return {
      gameId: document
        .querySelector('[data-mode="partyGame"]')
        ?.getAttribute('data-game-id'),
      hasPromptArea: !!document.querySelector('[data-prompt-area]'),
      hasDraw: !!document.querySelector('[data-draw]'),
      hasRedraw: !!document.querySelector('[data-redraw]'),
      hasWord: body.includes('你的词'),
      waiting: body.includes('等待桌主抽题'),
      hasHost: body.includes('桌主'),
    }
  })
  assert(guestMeta.gameId === 'truthDare', 'guest gameId')
  assert(guestMeta.hasPromptArea, 'guest prompt area')
  assert(!guestMeta.hasDraw, 'guest has no host draw button')
  assert(!guestMeta.hasRedraw, 'guest has no redraw button')
  assert(!guestMeta.hasWord, 'guest no private word')
  assert(guestMeta.waiting, 'guest waiting copy')
  assert(guestMeta.hasHost, 'guest sees host seat')

  await host.page.screenshot({
    path: `${ART}/truth-dare-host-lobby.png`,
    fullPage: true,
  })
  await guest.page.screenshot({
    path: `${ART}/truth-dare-guest-lobby.png`,
    fullPage: true,
  })
  console.log('PASS: typed join — dual-end seats match, truth-dare shell')

  const guestSession = await guest.page.evaluate(() =>
    JSON.parse(localStorage.getItem('party-box:session') || 'null'),
  )
  const guestDraw = await fetch(`${RELAY_URL}/rooms/${code}/draw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromSeatId: guestSession.seatId,
      seatToken: guestSession.seatToken,
    }),
  })
  const guestDrawBody = await guestDraw.json()
  assert(guestDraw.status === 400, `guest draw status ${guestDraw.status}`)
  assert(guestDrawBody.error === '仅桌主可执行此操作', 'guest draw copy')
  const emptyPrompt = await promptOf(host.page)
  assert(!emptyPrompt.id && !emptyPrompt.text, 'reject left prompt empty')
  console.log('PASS: non-host draw rejected')

  await clickText(host.page, '抽题')
  await host.page.waitForSelector('[data-prompt-text]')
  await guest.page.waitForSelector('[data-prompt-text]')
  const hostPrompt = await promptOf(host.page)
  const guestPrompt = await promptOf(guest.page)
  assert(hostPrompt.id && hostPrompt.text, 'host prompt')
  assert(hostPrompt.type === 'truth' || hostPrompt.type === 'dare', 'frozen type')
  assert(hostPrompt.id === guestPrompt.id, 'dual-end prompt id')
  assert(hostPrompt.type === guestPrompt.type, 'dual-end prompt type')
  assert(hostPrompt.text === guestPrompt.text, 'dual-end prompt text')
  const snap = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  const snapPrompt = snap.data?.room?.party?.prompt
  assert(snapPrompt?.id === hostPrompt.id, 'GET prompt id')
  assert(snapPrompt.text === hostPrompt.text, 'GET prompt text')
  assert(snapPrompt.displayType === hostPrompt.type, 'GET displayType')
  assert(!('partyPrivates' in (snap.data || {})), 'GET has no SeatPrivate')
  const hostHasDraw = await host.page.$('[data-draw]')
  const hostHasRedraw = await host.page.$('[data-redraw]')
  const guestHasDraw = await guest.page.$('[data-draw]')
  assert(!hostHasDraw && hostHasRedraw, 'host 抽题 → 重抽')
  assert(!guestHasDraw, 'guest still no draw')
  await host.page.screenshot({
    path: `${ART}/truth-dare-host-draw.png`,
    fullPage: true,
  })
  await guest.page.screenshot({
    path: `${ART}/truth-dare-guest-draw.png`,
    fullPage: true,
  })
  console.log('PASS: host draw — dual-end same type+text')

  await clickText(host.page, '重抽')
  await host.page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[data-prompt-text]')
      const text = el?.getAttribute('data-prompt-text') || el?.textContent?.trim() || ''
      const id = document.querySelector('[data-prompt-area]')?.getAttribute('data-prompt-id') || ''
      return text && id && text !== prev.text && id !== prev.id
    },
    {},
    hostPrompt,
  )
  await guest.page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[data-prompt-text]')
      const text = el?.getAttribute('data-prompt-text') || el?.textContent?.trim() || ''
      const id = document.querySelector('[data-prompt-area]')?.getAttribute('data-prompt-id') || ''
      return text && id && text !== prev.text && id !== prev.id
    },
    {},
    hostPrompt,
  )
  const hostRedraw = await promptOf(host.page)
  const guestRedrawPrompt = await promptOf(guest.page)
  assert(hostRedraw.id !== hostPrompt.id, 'redraw id changed')
  assert(hostRedraw.text !== hostPrompt.text, 'redraw text changed')
  assert(hostRedraw.id === guestRedrawPrompt.id, 'dual-end redraw id')
  assert(hostRedraw.text === guestRedrawPrompt.text, 'dual-end redraw text')
  assert(hostRedraw.type === guestRedrawPrompt.type, 'dual-end redraw type')
  await host.page.screenshot({
    path: `${ART}/truth-dare-host-redraw.png`,
    fullPage: true,
  })
  await guest.page.screenshot({
    path: `${ART}/truth-dare-guest-redraw.png`,
    fullPage: true,
  })
  console.log('PASS: redraw — dual-end refresh, text changed')
  await guest.ctx.close()
  await host.ctx.close()

  const host2 = await newDevice(browser)
  const code2 = await hostCreateTruthDare(host2.page, { name: '桌主C', maxSeats: '2' })
  const guest2 = await newDevice(browser)
  await guest2.page.goto(`${BASE}/r/${code2}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(guest2.page, '玩家D')
  await guest2.page.waitForSelector('[data-mode="partyGame"][data-game-id="truthDare"]')
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
    path: `${ART}/truth-dare-table-full.png`,
    fullPage: true,
  })
  console.log('PASS: full room →', FULL_2)
  await full.ctx.close()
  await guest2.ctx.close()
  await host2.ctx.close()

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
  console.log('PASS: invalid/missing →', MISSING)
  await miss.ctx.close()

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
  await fail.page.click('[data-create-party] [data-game-id="truthDare"]')
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
  console.log('PASS: relay fail →', UNREACHABLE)
  await fail.ctx.close()

  console.log('OK e2e-party-truth-dare')
} catch (e) {
  console.error('FAIL', e)
  process.exitCode = 1
  try {
    const pages = (await browser?.pages?.()) ?? []
    const p = pages[pages.length - 1]
    if (p) {
      await p.screenshot({
        path: `${ART}/truth-dare-lobby-fail.png`,
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
