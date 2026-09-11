/**
 * QA line 3: create-room snapshot survives 开桌 on both ends.
 * Host creates buy-in 100 / seats 4 / blinds 1/2, guest joins, 开桌,
 * both 邀请 read-only 桌面设置 show 100 / 4 / 1 / 2 (not — / 8).
 *
 * Spawns vite + node relay. QR origin stays pages.dev.
 *
 * Run: node scripts/e2e-create-snapshot.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { clickText, fillCreateRoom } from './e2e-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45351)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45352)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const JOIN_ORIGIN = 'https://party-box-43z.pages.dev'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-snapshot-'))
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
  if (!child || child.killed) return
  await new Promise((resolve) => {
    child.once('exit', () => resolve())
    child.kill('SIGTERM')
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, 2500).unref()
  })
}

async function readSettings(page) {
  await page.waitForSelector('.room-settings [data-setting="buyInN"]')
  return page.$eval('.room-settings', (el) => ({
    buyIn: el.querySelector('[data-setting="buyInN"]')?.textContent?.trim(),
    seats: el.querySelector('[data-setting="maxSeats"]')?.textContent?.trim(),
    blinds: el.querySelector('[data-setting="blinds"]')?.textContent?.trim() ?? null,
  }))
}

function assertSnapshot(settings, where) {
  assert(settings.buyIn === '100', `${where} buy-in ${settings.buyIn}`)
  assert(settings.seats === '4', `${where} seats ${settings.seats}`)
  assert(settings.blinds === '1 / 2', `${where} blinds ${settings.blinds}`)
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
  const health = await (await fetch(`${RELAY_URL}/health`)).json()
  assert(health.roomSettings === true, 'relay health.roomSettings')

  vite = spawnLogged('npx', ['vite', '--host', '127.0.0.1', '--port', String(FE)], {
    VITE_RELAY_URL: RELAY_URL,
  })
  await waitUrl(BASE)

  browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: 'new',
    protocolTimeout: 60_000,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    defaultViewport: { width: 390, height: 844 },
  })

  async function prep(page) {
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
        req.abort()
        return
      }
      req.continue()
    })
    page.setDefaultTimeout(20_000)
  }

  const hostCtx = await browser.createBrowserContext()
  const guestCtx = await browser.createBrowserContext()
  const host = await hostCtx.newPage()
  const guest = await guestCtx.newPage()
  await prep(host)
  await prep(guest)

  await host.goto(BASE, { waitUntil: 'domcontentloaded' })
  await host.waitForSelector('.brand')
  await clickText(host, '开一桌')
  await fillCreateRoom(host, {
    buyIn: '100',
    maxSeats: '4',
    smallBlind: '1',
    bigBlind: '2',
  })
  await clickText(host, '确认')
  await host.waitForSelector('.nickname-card input')
  await host.type('.nickname-card input', '桌主')
  await clickText(host, '进入')
  await host.waitForSelector('.page.lobby')
  const code = await host.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
  const joinUrl = await host.$eval('[data-join-url]', (el) =>
    el.getAttribute('data-join-url'),
  )
  assert(joinUrl === `${JOIN_ORIGIN}/r/${code}`, `QR ${joinUrl}`)

  assertSnapshot(await readSettings(host), 'host lobby')
  await host.screenshot({
    path: `${ART}/create-snapshot-host-lobby.png`,
    fullPage: true,
  })

  await guest.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await guest.waitForSelector('.nickname-card input')
  await guest.type('.nickname-card input', '甲')
  await clickText(guest, '进入')
  await guest.waitForSelector('.page.lobby')
  await host.waitForFunction(() => document.body.innerText.includes('甲'))
  assertSnapshot(await readSettings(guest), 'guest lobby')
  await guest.screenshot({
    path: `${ART}/create-snapshot-guest-lobby.png`,
    fullPage: true,
  })

  await clickText(host, '开桌')
  await host.waitForSelector('.seat-self')
  await guest.waitForSelector('.seat-self')

  await clickText(host, '邀请')
  await host.waitForSelector('.invite-box .room-settings')
  assertSnapshot(await readSettings(host), 'host table 邀请')
  const tableUrl = await host.$eval('.invite-box [data-join-url]', (el) =>
    el.getAttribute('data-join-url'),
  )
  assert(tableUrl === `${JOIN_ORIGIN}/r/${code}`, 'table QR pages.dev')
  await host.screenshot({
    path: `${ART}/create-snapshot-host-table.png`,
    fullPage: true,
  })

  await clickText(guest, '邀请')
  await guest.waitForSelector('.invite-box .room-settings')
  assertSnapshot(await readSettings(guest), 'guest table 邀请')
  await guest.screenshot({
    path: `${ART}/create-snapshot-guest-table.png`,
    fullPage: true,
  })

  console.log('OK e2e-create-snapshot', code)
} catch (err) {
  console.error(err)
  process.exitCode = 1
  try {
    const pages = (await browser?.pages()) ?? []
    const page = pages[0]
    if (page) {
      await page.screenshot({
        path: `${ART}/create-snapshot-fail.png`,
        fullPage: true,
      })
    }
  } catch {
    /* ignore */
  }
} finally {
  await browser?.close().catch(() => {})
  await stop(vite)
  await stop(relay)
  fs.rmSync(DATA, { recursive: true, force: true })
}
