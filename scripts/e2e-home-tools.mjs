/**
 * Home / tools entry IA: tool wall, page-local create payloads,
 * join unbound to tool, /r/CODE deep link, old /tools/chips redirect.
 *
 * Spawns vite + node relay. Run: npm run test:e2e-home-tools
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { clickText, confirmCreateParty, fillCreateRoom } from './e2e-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45401)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45402)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-home-tools-'))
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

function isCreateRoomPost(url, method) {
  if (method !== 'POST') return false
  try {
    const p = new URL(url).pathname
    return p === '/rooms' || p === '/rooms/'
  } catch {
    return false
  }
}

function blockFontsAndRecord(page, creates) {
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
      void req.abort()
      return
    }
    if (isCreateRoomPost(url, req.method())) {
      let body = {}
      try {
        body = JSON.parse(req.postData() || '{}')
      } catch {
        body = {}
      }
      creates.push(body)
    }
    void req.continue()
  })
}

async function newDevice(browser, creates) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setRequestInterception(true)
  blockFontsAndRecord(page, creates)
  page.setDefaultTimeout(20_000)
  return { ctx, page, creates }
}

async function nickEnter(page, nick) {
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', nick)
  await clickText(page, '进入')
}

function homeCreateButtons(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .map((b) => (b.textContent || '').trim())
      .filter((t) => t === '开一桌' || t === '局桌'),
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

  // ① Home tool wall, no direct-create primary CTAs
  const homeCreates = []
  const home = await newDevice(browser, homeCreates)
  await home.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await home.page.waitForSelector('.brand')
  const homeText = await home.page.evaluate(() => document.body.innerText)
  assert(homeText.includes('工具'), 'home section 工具')
  assert(homeText.includes('筹码桌'), 'card 筹码桌')
  assert(homeText.includes('谁是卧底'), 'card 谁是卧底')
  assert(homeText.includes('真心话大冒险'), 'card 真心话大冒险')
  assert(homeText.includes('加入'), 'secondary 加入')
  const createBtns = await homeCreateButtons(home.page)
  assert(createBtns.length === 0, `home has no 开一桌/局桌 buttons, got ${createBtns}`)
  assert(!(await home.page.$('[data-create-room]')), 'home has no chip create form')
  assert(!(await home.page.$('[data-create-party]')), 'home has no party create form')
  const toolIds = await home.page.$$eval('[data-tool]', (els) =>
    els.map((el) => el.getAttribute('data-tool')),
  )
  assert(
    toolIds.join(',') === 'chip,undercover,truthDare',
    `tool cards ${toolIds}`,
  )
  await home.page.screenshot({
    path: `${ART}/home-tools-wall.png`,
    fullPage: true,
  })
  assert(homeCreates.length === 0, 'home visit must not create a room')
  await home.ctx.close()
  console.log('PASS: ① home tool wall, no direct-create CTAs')

  // ② Chip create payload
  const chipCreates = []
  const chip = await newDevice(browser, chipCreates)
  await chip.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await chip.page.waitForSelector('[data-tool="chip"]')
  await chip.page.click('[data-tool="chip"]')
  await chip.page.waitForSelector('[data-tool-page="chip"]')
  assert(
    new URL(chip.page.url()).pathname === '/tools/chip',
    `chip path ${chip.page.url()}`,
  )
  const chipBlurb = await chip.page.$eval('.hint', (el) => el.textContent || '')
  assert(chipBlurb.includes('多人计数'), `chip blurb ${chipBlurb}`)
  await fillCreateRoom(chip.page, {
    buyIn: '100',
    maxSeats: '6',
    smallBlind: '1',
    bigBlind: '2',
  })
  await clickText(chip.page, '确认')
  await chip.page.waitForSelector('.nickname-card input')
  const chipBody = chipCreates[0]
  assert(chipBody, 'chip POST /rooms')
  assert(chipBody.mode === 'chip', `chip mode ${chipBody.mode}`)
  assert(chipBody.gameId == null, `chip must omit gameId, got ${chipBody.gameId}`)
  assert(Number(chipBody.buyInN) === 100, `chip buyIn ${chipBody.buyInN}`)
  assert(Number(chipBody.maxSeats) === 6, `chip seats ${chipBody.maxSeats}`)
  await chip.page.screenshot({
    path: `${ART}/home-tools-chip-create.png`,
    fullPage: true,
  })
  await chip.ctx.close()
  console.log('PASS: ② chip create mode=chip')

  // ② Undercover create payload
  const ucCreates = []
  const uc = await newDevice(browser, ucCreates)
  await uc.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await uc.page.waitForSelector('[data-tool="undercover"]')
  await uc.page.click('[data-tool="undercover"]')
  await uc.page.waitForSelector('[data-tool-page="undercover"]')
  await confirmCreateParty(uc.page, { maxSeats: '4', gameId: 'undercover' })
  await uc.page.waitForSelector('.nickname-card input')
  const ucBody = ucCreates[0]
  assert(ucBody, 'undercover POST /rooms')
  assert(ucBody.mode === 'partyGame', `undercover mode ${ucBody.mode}`)
  assert(ucBody.gameId === 'undercover', `undercover gameId ${ucBody.gameId}`)
  assert(Number(ucBody.maxSeats) === 4, `undercover seats ${ucBody.maxSeats}`)
  await nickEnter(uc.page, '桌主U')
  await uc.page.waitForSelector('[data-mode="partyGame"][data-game-id="undercover"]')
  const ucCode = await uc.page.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
  await uc.page.screenshot({
    path: `${ART}/home-tools-undercover-lobby.png`,
    fullPage: true,
  })
  await uc.ctx.close()
  console.log('PASS: ② undercover create gameId=undercover', ucCode)

  // ② Truth-or-dare create payload
  const tdCreates = []
  const td = await newDevice(browser, tdCreates)
  await td.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await td.page.waitForSelector('[data-tool="truthDare"]')
  await td.page.click('[data-tool="truthDare"]')
  await td.page.waitForSelector('[data-tool-page="truthDare"]')
  await confirmCreateParty(td.page, { maxSeats: '5', gameId: 'truthDare' })
  await td.page.waitForSelector('.nickname-card input')
  const tdBody = tdCreates[0]
  assert(tdBody, 'truthDare POST /rooms')
  assert(tdBody.mode === 'partyGame', `truthDare mode ${tdBody.mode}`)
  assert(tdBody.gameId === 'truthDare', `truthDare gameId ${tdBody.gameId}`)
  assert(Number(tdBody.maxSeats) === 5, `truthDare seats ${tdBody.maxSeats}`)
  await nickEnter(td.page, '桌主T')
  await td.page.waitForSelector('[data-mode="partyGame"][data-game-id="truthDare"]')
  await td.page.screenshot({
    path: `${ART}/home-tools-truthdare-lobby.png`,
    fullPage: true,
  })
  await td.ctx.close()
  console.log('PASS: ② truthDare create gameId=truthDare')

  // ③ old /tools/chips redirect must not create
  const redirCreates = []
  const redir = await newDevice(browser, redirCreates)
  await redir.page.goto(`${BASE}/tools/chips`, { waitUntil: 'domcontentloaded' })
  await redir.page.waitForSelector('[data-tool-page="chip"]')
  assert(
    new URL(redir.page.url()).pathname === '/tools/chip',
    `chips redirect ${redir.page.url()}`,
  )
  assert(redirCreates.length === 0, 'redirect must not POST /rooms')
  assert(
    !(await redir.page.$('[data-create-room]')),
    'redirect must not auto-open create form',
  )
  await redir.ctx.close()
  console.log('PASS: ③ /tools/chips → /tools/chip, no silent create')

  // Join from home follows room state (undercover), not a selected tool
  const joinCreates = []
  const joiner = await newDevice(browser, joinCreates)
  await joiner.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await joiner.page.click('[data-home-join]')
  await joiner.page.waitForSelector('[data-join-panel] .code-input')
  await joiner.page.type('[data-join-panel] .code-input', ucCode)
  await clickText(joiner.page, '进入')
  await nickEnter(joiner.page, '加入者')
  await joiner.page.waitForSelector('[data-mode="partyGame"][data-game-id="undercover"]')
  const joinGame = await joiner.page.$eval('[data-game-id]', (el) =>
    el.getAttribute('data-game-id'),
  )
  assert(joinGame === 'undercover', `join followed room, got ${joinGame}`)
  assert(joinCreates.length === 0, 'join must not POST /rooms')
  await joiner.page.screenshot({
    path: `${ART}/home-tools-join-room-state.png`,
    fullPage: true,
  })
  await joiner.ctx.close()
  console.log('PASS: join unbound to tool; follows room state')

  // ③ /r/CODE skips tools wall
  const deepCreates = []
  const deep = await newDevice(browser, deepCreates)
  await deep.page.goto(`${BASE}/r/${ucCode}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(deep.page, '深链')
  await deep.page.waitForSelector('[data-mode="partyGame"][data-game-id="undercover"]')
  assert(!deep.page.url().includes('/tools/'), `deep link stayed ${deep.page.url()}`)
  assert(deepCreates.length === 0, 'deep link must not create')
  await deep.page.screenshot({
    path: `${ART}/home-tools-deeplink.png`,
    fullPage: true,
  })
  await deep.ctx.close()
  console.log('PASS: ③ /r/CODE direct entry')

  console.log('OK e2e-home-tools')
} catch (e) {
  console.error('FAIL', e)
  process.exitCode = 1
  try {
    const pages = (await browser?.pages?.()) ?? []
    const p = pages[pages.length - 1]
    if (p) {
      await p.screenshot({
        path: `${ART}/home-tools-fail.png`,
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
