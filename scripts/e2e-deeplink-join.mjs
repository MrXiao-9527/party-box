/**
 * Knife ②: true dual-end join via cold open `/r/{CODE}`.
 * Spawns vite + node relay. Timeouts everywhere — must not hang.
 *
 * QA:
 * 1) `/r/{CODE}` same rights as typing code (nick / restore / full / invalid / playing→table)
 * 2) Cold open: both ends member list consistent
 * 3) Host sees guest seated after deep-link join
 *
 * Run: node scripts/e2e-deeplink-join.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { clickText, fillCreateRoom } from './e2e-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45371)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45372)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-deeplink-'))
fs.mkdirSync(ART, { recursive: true })

const INVALID = '房码无效'
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
  if (child.exitCode == null && !child.signalCode) {
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

async function hostCreateLobby(page, { name = '桌主', maxSeats = '8' } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.brand')
  await clickText(page, '开一桌')
  await fillCreateRoom(page, { buyIn: '100', maxSeats })
  await clickText(page, '确认')
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', name)
  await clickText(page, '进入')
  await page.waitForSelector('.page.lobby')
  return page.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
}

async function coldJoin(page, code, nick) {
  await page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', nick)
  await clickText(page, '进入')
}

function bodyHas(page, text, timeout = 12000) {
  return page.waitForFunction(
    (t) => (document.body?.innerText || '').includes(t),
    { timeout },
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

  // —— 1+2+3: cold /r/CODE join, member lists match, host sees guest ——
  const hostA = await newDevice(browser)
  const code2 = await hostCreateLobby(hostA.page, { name: '桌主A', maxSeats: '2' })
  console.log('code2', code2)

  const guestA = await newDevice(browser)
  await coldJoin(guestA.page, code2, '玩家B')
  await guestA.page.waitForSelector('.page.lobby')

  await bodyHas(hostA.page, '玩家B')
  await bodyHas(guestA.page, '桌主A')
  const hostText = await hostA.page.evaluate(() => document.body.innerText)
  const guestText = await guestA.page.evaluate(() => document.body.innerText)
  assert(hostText.includes('玩家B'), 'host member list has guest')
  assert(guestText.includes('桌主A'), 'guest member list has host')
  assert(!guestText.includes('不存在') && !guestText.includes('已解散'), 'guest not missing-room')
  await hostA.page.screenshot({
    path: `${ART}/deeplink-host-sees-guest.png`,
    fullPage: true,
  })
  await guestA.page.screenshot({
    path: `${ART}/deeplink-guest-lobby.png`,
    fullPage: true,
  })
  console.log('PASS: cold /r/CODE — both ends consistent, host sees guest')

  // full reject via deep link
  const guestFull = await newDevice(browser)
  await coldJoin(guestFull.page, code2, '乙')
  await guestFull.page.waitForFunction(
    (copy) =>
      [...document.querySelectorAll('.toast, .error, h1')].some((el) =>
        (el.textContent || '').includes(copy),
      ),
    { timeout: 12000 },
    FULL_2,
  )
  await guestFull.page.screenshot({
    path: `${ART}/deeplink-table-full.png`,
    fullPage: true,
  })
  console.log('PASS: /r/CODE full →', FULL_2)
  await guestFull.ctx.close()
  await guestA.ctx.close()
  await hostA.ctx.close()

  // playing enters table + silent restore
  const hostB = await newDevice(browser)
  const code8 = await hostCreateLobby(hostB.page, { name: '桌主C', maxSeats: '8' })
  await clickText(hostB.page, '开桌')
  await hostB.page.waitForSelector('.seat-self')

  const guestB = await newDevice(browser)
  await coldJoin(guestB.page, code8, '玩家D')
  await guestB.page.waitForSelector('.seat-self')
  await bodyHas(guestB.page, '桌主C')
  await bodyHas(hostB.page, '玩家D')
  await guestB.page.screenshot({
    path: `${ART}/deeplink-playing-table.png`,
    fullPage: true,
  })
  console.log('PASS: playing /r/CODE enters ChipTable')

  await guestB.page.reload({ waitUntil: 'domcontentloaded' })
  await guestB.page.waitForFunction(() => {
    const nick = !!document.querySelector('.nickname-card')
    const chip = !!document.querySelector('.seat-self')
    return !nick && chip
  })
  console.log('PASS: /r/CODE refresh silent restore (no nick)')
  await guestB.ctx.close()
  await hostB.ctx.close()

  // invalid code
  const inv = await newDevice(browser)
  await inv.page.goto(`${BASE}/r/@@@`, { waitUntil: 'domcontentloaded' })
  await inv.page.waitForFunction(
    (copy) => {
      const home = location.pathname === '/' || location.pathname === ''
      const toast = [...document.querySelectorAll('.toast')].some((t) =>
        (t.textContent || '').includes(copy),
      )
      const inline = (document.body?.innerText || '').includes(copy)
      return home && (toast || inline)
    },
    { timeout: 12000 },
    INVALID,
  )
  await inv.page.screenshot({
    path: `${ART}/deeplink-invalid-code.png`,
    fullPage: true,
  })
  console.log('PASS: /r/@@@ →', INVALID)
  await inv.ctx.close()

  // typed join still works (same rights)
  const hostC = await newDevice(browser)
  const codeType = await hostCreateLobby(hostC.page, { name: '桌主E' })
  const typed = await newDevice(browser)
  await typed.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await clickText(typed.page, '加入')
  await typed.page.waitForSelector('.join-panel input')
  await typed.page.type('.join-panel input', codeType)
  await clickText(typed.page, '进入')
  await typed.page.waitForSelector('.nickname-card input')
  await typed.page.type('.nickname-card input', '玩家F')
  await clickText(typed.page, '进入')
  await typed.page.waitForSelector('.page.lobby')
  await bodyHas(hostC.page, '玩家F')
  await bodyHas(typed.page, '桌主E')
  console.log('PASS: typed 加入 same member-list rights')
  await typed.ctx.close()
  await hostC.ctx.close()

  console.log('OK e2e-deeplink-join')
} catch (e) {
  console.error('FAIL', e)
  process.exitCode = 1
  try {
    const pages = (await browser?.pages?.()) ?? []
    const p = pages[pages.length - 1]
    if (p) {
      await p.screenshot({
        path: `${ART}/deeplink-join-fail.png`,
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
