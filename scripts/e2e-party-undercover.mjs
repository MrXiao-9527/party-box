/**
 * Slice B e2e: deal + dual-end private screens + mid-join + public JSON.
 * Run: npm run test:e2e-party-undercover
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { clickText, confirmCreateParty } from './e2e-lib.mjs'
import { publicPayloadLeaks } from '../server/undercover.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45385)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45386)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-undercover-'))
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

function ownWord(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-private-word]')
    return el?.getAttribute('data-private-word') || ''
  })
}

function pageText(page) {
  return page.evaluate(() => document.body.innerText || '')
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
  const code = await hostCreateParty(host.page, { name: '桌主A', maxSeats: '8' })
  assert(/^[A-Z0-9]{4}$/.test(code), `code ${code}`)

  const guest1 = await newDevice(browser)
  await guest1.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(guest1.page, '玩家B')
  await guest1.page.waitForSelector('[data-mode="partyGame"]')

  const guest2 = await newDevice(browser)
  await guest2.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(guest2.page, '玩家C')
  await guest2.page.waitForSelector('[data-mode="partyGame"]')

  await host.page.waitForFunction(
    () =>
      (document.body?.innerText || '').includes('玩家B') &&
      (document.body?.innerText || '').includes('玩家C'),
  )

  const startDisabled = await host.page.$eval(
    '[data-start-undercover]',
    (el) => el.disabled,
  )
  assert(!startDisabled, 'start enabled at 3 online')
  await clickText(host.page, '开始游戏')
  await host.page.waitForSelector('[data-party-phase="playing"]')
  await guest1.page.waitForSelector('[data-party-phase="playing"]')
  await guest2.page.waitForSelector('[data-party-phase="playing"]')
  await host.page.waitForSelector('[data-private-word]')
  await guest1.page.waitForSelector('[data-private-word]')
  await guest2.page.waitForSelector('[data-private-word]')

  const wHost = await ownWord(host.page)
  const wG1 = await ownWord(guest1.page)
  const wG2 = await ownWord(guest2.page)
  assert(wHost && wG1 && wG2, 'each seat has a word')
  assert(new Set([wHost, wG1, wG2]).size === 2, 'exactly two words in play')

  const hostText = await pageText(host.page)
  const g1Text = await pageText(guest1.page)
  const g2Text = await pageText(guest2.page)
  assert(hostText.includes('你的词') && hostText.includes(wHost), 'host private screen')
  if (wG1 !== wHost) {
    assert(!g1Text.includes(wHost), 'guest1 cannot see host word')
    assert(!hostText.includes(wG1), 'host cannot see guest1 word')
  }
  if (wG2 !== wHost) {
    assert(!g2Text.includes(wHost), 'guest2 cannot see host word')
    assert(!hostText.includes(wG2), 'host cannot see guest2 word')
  }
  if (wG1 !== wG2) {
    assert(!g1Text.includes(wG2), 'guest1 cannot see guest2 word')
    assert(!g2Text.includes(wG1), 'guest2 cannot see guest1 word')
  }

  const snap = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  const leak = publicPayloadLeaks(snap, [wHost, wG1, wG2])
  assert(!leak, `public GET leak ${leak}`)
  assert(snap.data.room.party.phase === 'playing', 'public phase playing')
  assert(snap.data.room.party.pairId, 'public pairId')
  assert(
    snap.data.room.party.seats.every((s) => typeof s.hasWord === 'boolean'),
    'public hasWord only',
  )

  await host.page.screenshot({ path: `${ART}/undercover-host-private.png`, fullPage: true })
  await guest1.page.screenshot({ path: `${ART}/undercover-guest-private.png`, fullPage: true })
  console.log('PASS: dual-end private words; public JSON clean')

  const late = await newDevice(browser)
  await late.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(late.page, '玩家D')
  await late.page.waitForSelector('[data-midjoin]')
  const lateText = await pageText(late.page)
  assert(lateText.includes('本局已开始，本席未发词，请等下一局'), 'mid-join copy')
  assert(!lateText.includes('你的词'), 'mid-join no 你的词')
  for (const w of [wHost, wG1, wG2]) {
    assert(!lateText.includes(w), `mid-join must not show ${w}`)
  }
  const lateWord = await ownWord(late.page)
  assert(!lateWord, 'mid-join no private attr')
  await late.page.screenshot({ path: `${ART}/undercover-midjoin.png`, fullPage: true })
  console.log('PASS: mid-join this round has no word')

  await late.ctx.close()
  await guest2.ctx.close()
  await guest1.ctx.close()
  await host.ctx.close()
  console.log('OK e2e-party-undercover')
} catch (e) {
  console.error('FAIL', e)
  process.exitCode = 1
  try {
    const pages = (await browser?.pages?.()) ?? []
    const p = pages[pages.length - 1]
    if (p) {
      await p.screenshot({
        path: `${ART}/undercover-fail.png`,
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
