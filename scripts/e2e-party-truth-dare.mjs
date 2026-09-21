/**
 * Slice A (full): 真心话大冒险 turn machine — 直接出题 / 过题 / 指定抽答人 / 晚进.
 * Dual-end phase+prompt; non-drawer toast 还没轮到你. No wheel / no ≥80 bank.
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

function stageOf(page) {
  return page.evaluate(
    () => document.querySelector('[data-stage-copy]')?.textContent?.trim() || '',
  )
}

function turnOf(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-mode="partyGame"]')
    return {
      phase: el?.getAttribute('data-party-phase') || '',
      drawer: el?.getAttribute('data-drawer-seat') || '',
      answerer: el?.getAttribute('data-answerer-seat') || '',
    }
  })
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
      stage: document.querySelector('[data-stage-copy]')?.textContent?.trim() || '',
      hasPromptArea: !!document.querySelector('[data-prompt-area]'),
      hasDraw: !!draw,
      drawLabel: (draw?.textContent || '').trim(),
      drawDisabled: draw?.disabled === true,
      hasRedraw: !!document.querySelector('[data-redraw]'),
      hasSetDrawer: !!document.querySelector('[data-set-drawer]'),
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
  assert(meta.phase === 'drawing', 'host party phase drawing')
  assert(meta.gameId === 'truthDare', 'gameId truthDare')
  assert(meta.stage === '等待 桌主A 抽题', `host stage ${meta.stage}`)
  assert(meta.hasPromptArea, 'public prompt area')
  assert(meta.hasDraw && !meta.drawDisabled, 'host 直接出题 enabled')
  assert(meta.drawLabel === '直接出题', 'draw label')
  assert(!meta.hasRedraw, 'no 重抽')
  assert(meta.hasSetDrawer, 'host 指定抽题人')
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
      phase: document
        .querySelector('[data-mode="partyGame"]')
        ?.getAttribute('data-party-phase'),
      hasPromptArea: !!document.querySelector('[data-prompt-area]'),
      hasDraw: !!document.querySelector('[data-draw]'),
      drawSelf: document.querySelector('[data-draw]')?.getAttribute('data-draw-self'),
      hasRedraw: !!document.querySelector('[data-redraw]'),
      hasSetDrawer: !!document.querySelector('[data-set-drawer]'),
      hasWord: body.includes('你的词'),
      waiting: body.includes('等待 桌主A 抽题'),
      hasHost: body.includes('桌主'),
    }
  })
  assert(guestMeta.gameId === 'truthDare', 'guest gameId')
  assert(guestMeta.phase === 'drawing', 'guest phase drawing')
  assert(guestMeta.hasPromptArea, 'guest prompt area')
  assert(guestMeta.hasDraw, 'guest sees 直接出题')
  assert(guestMeta.drawSelf === 'false', 'guest is not drawer')
  assert(!guestMeta.hasRedraw, 'guest has no redraw button')
  assert(!guestMeta.hasSetDrawer, 'guest has no 指定抽题人')
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
  await clickText(guest.page, '直接出题')
  await guest.page.waitForFunction(
    () =>
      [...document.querySelectorAll('.toast')].some((el) =>
        (el.textContent || '').includes('还没轮到你'),
      ),
    { timeout: 8000 },
  )
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
  assert(guestDrawBody.error === '还没轮到你', 'guest draw copy')
  const emptyPrompt = await promptOf(host.page)
  assert(!emptyPrompt.id && !emptyPrompt.text, 'reject left prompt empty')
  console.log('PASS: non-drawer draw rejected')

  await clickText(host.page, '直接出题')
  await host.page.waitForSelector('[data-prompt-text]')
  await guest.page.waitForSelector('[data-prompt-text]')
  const hostPrompt = await promptOf(host.page)
  const guestPrompt = await promptOf(guest.page)
  assert(hostPrompt.id && hostPrompt.text, 'host prompt')
  assert(hostPrompt.type === 'truth' || hostPrompt.type === 'dare', 'frozen type')
  assert(hostPrompt.id === guestPrompt.id, 'dual-end prompt id')
  assert(hostPrompt.type === guestPrompt.type, 'dual-end prompt type')
  assert(hostPrompt.text === guestPrompt.text, 'dual-end prompt text')
  assert((await stageOf(host.page)) === '轮到 桌主A 答', 'host answering copy')
  assert((await stageOf(guest.page)) === '轮到 桌主A 答', 'guest answering copy')
  const snap = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  const snapParty = snap.data?.room?.party
  const snapPrompt = snapParty?.prompt
  assert(snapParty?.phase === 'answering', 'GET phase answering')
  assert(snapParty?.drawerSeatId, 'GET drawerSeatId')
  assert(snapParty?.answererSeatId === snapParty.drawerSeatId, 'GET answerer=drawer')
  assert(snapPrompt?.id === hostPrompt.id, 'GET prompt id')
  assert(snapPrompt.text === hostPrompt.text, 'GET prompt text')
  assert(snapPrompt.displayType === hostPrompt.type, 'GET displayType')
  assert(!('partyPrivates' in (snap.data || {})), 'GET has no SeatPrivate')
  const hostHasDraw = await host.page.$('[data-draw]')
  const hostHasAdvance = await host.page.$('[data-advance]')
  const hostHasSetAnswerer = await host.page.$('[data-set-answerer]')
  const hostHasSetDrawer = await host.page.$('[data-set-drawer]')
  assert(!hostHasDraw, 'no 直接出题 while answering')
  assert(hostHasAdvance, 'host 过题')
  assert(hostHasSetAnswerer, 'host 指定答题人')
  assert(!hostHasSetDrawer, 'no 指定抽题人 while answering')
  await host.page.screenshot({
    path: `${ART}/truth-dare-host-draw.png`,
    fullPage: true,
  })
  await guest.page.screenshot({
    path: `${ART}/truth-dare-guest-draw.png`,
    fullPage: true,
  })
  console.log('PASS: drawer draw — dual-end same type+text')

  await clickText(host.page, '指定答题人')
  await host.page.waitForSelector('[data-answerer-picker]')
  await clickNamed(host.page, 'data-pick-answerer', '玩家B')
  await host.page.waitForFunction(
    () =>
      (document.querySelector('[data-stage-copy]')?.textContent || '').includes(
        '轮到 玩家B 答',
      ),
  )
  await guest.page.waitForFunction(
    () =>
      (document.querySelector('[data-stage-copy]')?.textContent || '').includes(
        '轮到 玩家B 答',
      ),
  )
  const afterAnswerer = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  assert(
    afterAnswerer.data.room.party.answererSeatId === guestSession.seatId,
    'set-answerer dual-end',
  )
  assert(
    afterAnswerer.data.room.party.prompt.id === hostPrompt.id,
    'set-answerer keeps prompt',
  )
  console.log('PASS: set-answerer dual-end')

  const late = await newDevice(browser)
  await late.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(late.page, '晚进')
  await late.page.waitForSelector('[data-prompt-text]')
  const latePrompt = await promptOf(late.page)
  assert(latePrompt.id === hostPrompt.id, 'late-join prompt id')
  assert(latePrompt.text === hostPrompt.text, 'late-join prompt text')
  assert((await stageOf(late.page)) === '轮到 玩家B 答', 'late-join stage')
  assert((await turnOf(late.page)).phase === 'answering', 'late-join phase')
  const lateHasAdvance = await late.page.$('[data-advance]')
  assert(!lateHasAdvance, 'late join cannot 过题')
  await late.page.screenshot({
    path: `${ART}/truth-dare-late-join.png`,
    fullPage: true,
  })
  console.log('PASS: late join snapshot readable')

  const guestSetDrawer = await fetch(`${RELAY_URL}/rooms/${code}/set-drawer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromSeatId: guestSession.seatId,
      seatToken: guestSession.seatToken,
      seatId: guestSession.seatId,
    }),
  })
  assert(guestSetDrawer.status === 400, 'set-drawer during answering rejected')

  await clickText(host.page, '过题')
  await host.page.waitForFunction(() => !document.querySelector('[data-prompt-text]'))
  await guest.page.waitForFunction(() => !document.querySelector('[data-prompt-text]'))
  await late.page.waitForFunction(() => !document.querySelector('[data-prompt-text]'))
  assert((await turnOf(host.page)).phase === 'drawing', 'advance host drawing')
  assert((await turnOf(guest.page)).phase === 'drawing', 'advance guest drawing')
  assert((await stageOf(host.page)) === '等待 玩家B 抽题', 'next drawer is guest')
  assert((await stageOf(guest.page)) === '等待 玩家B 抽题', 'guest sees next drawer')
  assert((await stageOf(late.page)) === '等待 玩家B 抽题', 'late sees next drawer')
  const afterAdvance = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  assert(!afterAdvance.data.room.party.prompt, 'advance cleared prompt')
  assert(afterAdvance.data.room.party.phase === 'drawing', 'GET drawing after advance')
  assert(
    afterAdvance.data.room.party.drawerSeatId === guestSession.seatId,
    'GET next drawer',
  )
  const hostHasDrawAfter = await host.page.$('[data-draw]')
  const guestDrawSelf = await guest.page.$eval(
    '[data-draw]',
    (el) => el.getAttribute('data-draw-self'),
  )
  assert(hostHasDrawAfter, 'drawing shows 直接出题')
  assert(guestDrawSelf === 'true', 'guest is next drawer')
  await host.page.screenshot({
    path: `${ART}/truth-dare-host-advance.png`,
    fullPage: true,
  })
  await guest.page.screenshot({
    path: `${ART}/truth-dare-guest-advance.png`,
    fullPage: true,
  })
  console.log('PASS: advance — prompt cleared, next drawing')

  await clickText(host.page, '指定抽题人')
  await host.page.waitForSelector('[data-drawer-picker]')
  await clickNamed(host.page, 'data-pick-drawer', '晚进')
  await host.page.waitForFunction(
    () =>
      (document.querySelector('[data-stage-copy]')?.textContent || '').includes(
        '等待 晚进 抽题',
      ),
  )
  await guest.page.waitForFunction(
    () =>
      (document.querySelector('[data-stage-copy]')?.textContent || '').includes(
        '等待 晚进 抽题',
      ),
  )
  await late.page.waitForFunction(
    () =>
      document.querySelector('[data-draw]')?.getAttribute('data-draw-self') ===
      'true',
  )
  console.log('PASS: set-drawer while drawing')
  await late.ctx.close()
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
