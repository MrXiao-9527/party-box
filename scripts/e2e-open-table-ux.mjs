/**
 * Homepage「开一桌」/「确认」and lobby「开桌」must show 开桌中…
 * then a human toast on failure (never silent no-op).
 *
 * Spawns vite + node relay. Run: node scripts/e2e-open-table-ux.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { clickText, fillCreateRoom } from './e2e-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45361)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45362)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-open-ux-'))
fs.mkdirSync(ART, { recursive: true })

const BUSY = '开桌中…'
const UNREACHABLE = '连不上房间服务，请重试'

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
  if (child.exitCode == null && !child.signalCode) {
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

function hasButton(page, text) {
  return page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('button')].some(
        (b) => (b.textContent || '').trim() === t,
      ),
    {},
    text,
  )
}

function toastText(page, text) {
  return page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('.toast, .error')].some((el) =>
        (el.textContent || '').includes(t),
      ),
    { timeout: 8000 },
    text,
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

  /** @type {'ok' | 'slow-fail'} */
  let roomsMode = 'ok'
  /** @type {'ok' | 'slow-fail'} */
  let phaseMode = 'ok'

  async function newInterceptedPage() {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    await page.setRequestInterception(true)
    page.on('request', async (req) => {
      const url = req.url()
      const method = req.method()
      if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
        await req.abort()
        return
      }
      if (isCreateRoomPost(url, method) && roomsMode === 'slow-fail') {
        await new Promise((r) => setTimeout(r, 1100))
        await req.abort('failed')
        return
      }
      if (method === 'POST' && url.includes('/phase') && phaseMode === 'slow-fail') {
        await new Promise((r) => setTimeout(r, 1100))
        await req.abort('failed')
        return
      }
      await req.continue()
    })
    page.setDefaultTimeout(20_000)
    return { ctx, page }
  }

  // —— Home create: Loading then fail toast ——
  roomsMode = 'slow-fail'
  phaseMode = 'ok'
  const home = await newInterceptedPage()
  await home.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await home.page.waitForSelector('.brand')
  await clickText(home.page, '开一桌')
  await fillCreateRoom(home.page)
  await clickText(home.page, '确认')
  await hasButton(home.page, BUSY)
  await home.page.screenshot({
    path: `${ART}/open-table-home-loading.png`,
    fullPage: true,
  })
  await toastText(home.page, UNREACHABLE)
  const homeToast = await home.page.$eval('.toast', (el) => el.textContent.trim())
  assert(homeToast === UNREACHABLE, `home toast: ${homeToast}`)
  assert(
    await home.page.$('.page.home'),
    'home create fail must stay on homepage',
  )
  await home.page.screenshot({
    path: `${ART}/open-table-home-fail-toast.png`,
    fullPage: true,
  })
  console.log('PASS: homepage 确认 shows 开桌中… then RELAY_UNREACHABLE toast')
  await home.ctx.close()

  // —— Lobby 开桌: Loading then fail toast, then success still works ——
  roomsMode = 'ok'
  phaseMode = 'ok'
  const lobby = await newInterceptedPage()
  await lobby.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await lobby.page.waitForSelector('.brand')
  await clickText(lobby.page, '开一桌')
  await fillCreateRoom(lobby.page)
  await clickText(lobby.page, '确认')
  await lobby.page.waitForSelector('.nickname-card input')
  await lobby.page.type('.nickname-card input', '桌主')
  await clickText(lobby.page, '进入')
  await lobby.page.waitForSelector('.page.lobby')

  phaseMode = 'slow-fail'
  await clickText(lobby.page, '开桌')
  await hasButton(lobby.page, BUSY)
  await lobby.page.screenshot({
    path: `${ART}/open-table-lobby-loading.png`,
    fullPage: true,
  })
  await toastText(lobby.page, UNREACHABLE)
  const lobbyToast = await lobby.page.$eval('.toast', (el) =>
    el.textContent.trim(),
  )
  assert(lobbyToast === UNREACHABLE, `lobby toast: ${lobbyToast}`)
  assert(
    await lobby.page.$('.page.lobby'),
    'failed 开桌 must stay on lobby (no half-success ChipTable)',
  )
  await lobby.page.screenshot({
    path: `${ART}/open-table-lobby-fail-toast.png`,
    fullPage: true,
  })
  console.log('PASS: lobby 开桌 shows 开桌中… then RELAY_UNREACHABLE toast')

  await lobby.page.evaluate(() => {
    document.querySelectorAll('.toast').forEach((el) => el.remove())
  })
  phaseMode = 'ok'
  await clickText(lobby.page, '开桌')
  await lobby.page.waitForSelector('.seat-self')
  await lobby.page.screenshot({
    path: `${ART}/open-table-lobby-success.png`,
    fullPage: true,
  })
  console.log('PASS: lobby 开桌 succeeds after retry')
  await lobby.ctx.close()
} catch (e) {
  console.error('FAIL', e)
  process.exitCode = 1
  try {
    const pages = (await browser?.pages?.()) ?? []
    const p = pages[pages.length - 1]
    if (p) {
      await p.screenshot({
        path: `${ART}/open-table-ux-fail.png`,
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
