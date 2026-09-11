/**
 * UI acceptance: after relay wipe (no durable file), was-in-room reconnect
 * must toast exactly「房间服务已重启，请重新开桌」and leave lobby.
 * FORBIDDEN: zombie「等候开桌」with dead 开桌.
 *
 * Also checks durable path: with PARTY_BOX_DATA_DIR, remount restores playing.
 *
 * Requires: chrome + npm install
 * Run: node scripts/e2e-relay-restart.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45341)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45342)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-persist-'))
fs.mkdirSync(ART, { recursive: true })

const RESTART_TOAST = '房间服务已重启，请重新开桌'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
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

let relay = spawnLogged(process.execPath, ['server/index.mjs'], {
  PORT: String(RELAY),
  PARTY_BOX_DATA_DIR: DATA,
})
await waitUrl(`${RELAY_URL}/health`)

const vite = spawnLogged('npx', ['vite', '--host', '127.0.0.1', '--port', String(FE)], {
  VITE_RELAY_URL: RELAY_URL,
})
await waitUrl(BASE)

const browser = await puppeteer.launch({
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

async function clickText(page, text) {
  await page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('button')].some(
        (b) => (b.textContent || '').trim() === t,
      ),
    {},
    text,
  )
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find(
      (el) => (el.textContent || '').trim() === t,
    )
    b.click()
  }, text)
}

async function typeName(page, name) {
  await page.waitForSelector('input')
  await page.click('input', { clickCount: 3 })
  await page.type('input', name)
}

const page = await browser.newPage()
await prep(page)
console.log('open home', BASE)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await clickText(page, '开一桌')
await typeName(page, '甲')
await clickText(page, '进入')
await page.waitForSelector('.page.lobby')
const code = await page.evaluate(() =>
  location.pathname.replace(/^\/r\//, '').toUpperCase(),
)
console.log('lobby', code)
await clickText(page, '开桌')
await page.waitForFunction(() => !!document.querySelector('.seat-self'))
console.log('playing')

await page.screenshot({
  path: path.join(ART, 'relay-persist-before-remount.png'),
  fullPage: true,
})

// --- Path A: durable remount restores same room ---
console.log('remount relay (durable)')
await stop(relay)
relay = spawnLogged(process.execPath, ['server/index.mjs'], {
  PORT: String(RELAY),
  PARTY_BOX_DATA_DIR: DATA,
})
await waitUrl(`${RELAY_URL}/health`)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!document.querySelector('.seat-self'), {
  timeout: 15_000,
})
const phaseAfter = await page.evaluate((c) => {
  const raw = localStorage.getItem(`party-box:room:${c}`)
  return raw ? JSON.parse(raw).room?.phase : null
}, code)
assert(phaseAfter === 'playing', 'durable remount restores playing (not lobby)')
await page.screenshot({
  path: path.join(ART, 'relay-persist-after-remount.png'),
  fullPage: true,
})
console.log('OK durable remount restores playing', code)

// --- Path B: wipe data dir → restart toast, no zombie lobby ---
console.log('wipe data + remount')
await stop(relay)
fs.rmSync(DATA, { recursive: true, force: true })
fs.mkdirSync(DATA, { recursive: true })
relay = spawnLogged(process.execPath, ['server/index.mjs'], {
  PORT: String(RELAY),
  PARTY_BOX_DATA_DIR: DATA,
})
await waitUrl(`${RELAY_URL}/health`)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  (toast) => {
    const home = location.pathname === '/' || location.pathname === ''
    const body = document.body?.innerText || ''
    const hasToast = body.includes(toast)
    const lobby = !!document.querySelector('.page.lobby')
    return home && hasToast && !lobby
  },
  { timeout: 15_000 },
  RESTART_TOAST,
)

const wipeState = await page.evaluate((toast) => {
  const home = location.pathname === '/' || location.pathname === ''
  const lobby = !!document.querySelector('.page.lobby')
  const body = document.body?.innerText || ''
  return {
    home,
    lobby,
    hasToast: body.includes(toast),
    path: location.pathname,
  }
}, RESTART_TOAST)

assert(wipeState.home, 'navigated home after wipe')
assert(!wipeState.lobby, 'no zombie lobby')
assert(wipeState.hasToast, 'exact restart toast')
await page.screenshot({
  path: path.join(ART, 'relay-wipe-restart-toast.png'),
  fullPage: true,
})

await browser.close()
await stop(relay)
await stop(vite)
try {
  fs.rmSync(DATA, { recursive: true, force: true })
} catch {
  /* ignore */
}
console.log('OK e2e relay restart UX — toast + home, no zombie lobby')
process.exit(0)