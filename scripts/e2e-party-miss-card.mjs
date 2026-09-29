/**
 * Miss-card (十三钗) e2e: home entry, create/join, 13-command UI,
 * draw/complete, A pick, skip, deck snapshot. Spawns vite + node relay.
 *
 * Run: npm run test:e2e-party-miss-card
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { clickText, confirmCreateParty } from './e2e-lib.mjs'
import { COMMANDS, RANKS } from '../server/missCard.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45411)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45412)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-mc-'))
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

async function nickEnter(page, nick) {
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', nick)
  await clickText(page, '进入')
}

async function hostCreate(page, { name = '桌主', maxSeats = '8' } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.brand')
  await confirmCreateParty(page, { maxSeats, gameId: 'miss-card' })
  await nickEnter(page, name)
  await page.waitForSelector('[data-mode="partyGame"][data-game-id="miss-card"]')
  return page.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
}

function metaOf(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-game-id="miss-card"]')
    return {
      phase: root?.getAttribute('data-party-phase') || '',
      rank: root?.getAttribute('data-current-rank') || '',
      remaining: root?.getAttribute('data-deck-remaining') || '',
      command: document.querySelector('[data-command-title]')?.textContent?.trim() || '',
      copy: document.querySelector('[data-command-copy]')?.getAttribute('data-command-copy') || '',
    }
  })
}

async function finishCurrent(page, { isDrawer }) {
  const meta = await metaOf(page)
  if (meta.phase !== 'awaitComplete') return meta
  if (!isDrawer) return meta
  if (meta.rank === 'A') {
    const self = await page.$('[data-pick-target]')
    if (self) {
      await page.click('[data-pick-target]')
    }
  }
  if (meta.rank === 'K') {
    const setK = await page.$('[data-set-k]')
    if (setK) {
      const input = await page.$('[data-k-cups]')
      if (input) {
        await input.click({ clickCount: 3 })
        await input.type('3')
      }
      await page.click('[data-set-k]')
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-game-id="miss-card"]')
            ?.getAttribute('data-need-set-k') !== 'true',
      )
    }
  }
  await page.waitForSelector('[data-complete-turn]:not([disabled])')
  await page.click('[data-complete-turn]')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-game-id="miss-card"]')?.getAttribute('data-party-phase') !==
      'awaitComplete',
  )
  return metaOf(page)
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
  await home.page.waitForSelector('[data-tool="miss-card"]')
  const homeText = await home.page.evaluate(() => document.body.innerText)
  assert(homeText.includes('小姐牌'), 'home 小姐牌')
  assert(homeText.includes('十三钗'), 'home 十三钗')
  await home.page.click('[data-tool="miss-card"]')
  await home.page.waitForSelector('[data-tool-page="miss-card"]')
  assert(new URL(home.page.url()).pathname === '/tools/miss-card', 'miss-card path')
  await home.ctx.close()
  console.log('PASS: home tool 小姐牌')

  const host = await newDevice(browser)
  const code = await hostCreate(host.page, { name: '桌主' })
  const guest = await newDevice(browser)
  await guest.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(guest.page, '甲')
  await guest.page.waitForSelector('[data-mode="partyGame"][data-game-id="miss-card"]')

  await host.page.waitForSelector('[data-start-miss-card]')
  await host.page.screenshot({ path: `${ART}/miss-card-lobby.png`, fullPage: true })
  const preview = await host.page.$$eval('[data-rules-preview] [data-rule-rank]', (els) =>
    els.map((el) => el.getAttribute('data-rule-rank')),
  )
  assert(preview.join(',') === RANKS.join(','), `lobby 13 ranks ${preview}`)

  await host.page.click('[data-start-miss-card]')
  await host.page.waitForFunction(
    () =>
      document.querySelector('[data-game-id="miss-card"]')?.getAttribute('data-party-phase') ===
      'playing',
  )
  await guest.page.waitForFunction(
    () =>
      document.querySelector('[data-game-id="miss-card"]')?.getAttribute('data-party-phase') ===
      'playing',
  )
  const remain0 = await host.page.$eval('[data-deck-remaining]', (el) => el.getAttribute('data-deck-remaining'))
  assert(remain0 === '52', `remaining ${remain0}`)

  const snap0 = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  const deck0 = snap0.data.room.party.deck.map((c) => `${c.rank}${c.suit}`).join('|')
  const idx0 = snap0.data.room.party.deckIndex

  await host.page.click('[data-draw-card]')
  await host.page.waitForFunction(
    () =>
      document.querySelector('[data-game-id="miss-card"]')?.getAttribute('data-party-phase') ===
      'awaitComplete',
  )
  await guest.page.waitForFunction(
    () =>
      document.querySelector('[data-game-id="miss-card"]')?.getAttribute('data-party-phase') ===
      'awaitComplete',
  )
  const hostMeta = await metaOf(host.page)
  const guestMeta = await metaOf(guest.page)
  assert(hostMeta.rank && hostMeta.rank === guestMeta.rank, 'dual-end rank')
  assert(hostMeta.command === COMMANDS[hostMeta.rank].name, 'command name')
  assert(hostMeta.copy === hostMeta.rank, 'command copy on screen')
  await host.page.screenshot({ path: `${ART}/miss-card-command.png`, fullPage: true })

  const guestDraw = await guest.page.$('[data-draw-card]')
  if (guestDraw) {
    await guest.page.click('[data-draw-card]')
  }
  const stillAwait = await guest.page.$eval(
    '[data-game-id="miss-card"]',
    (el) => el.getAttribute('data-party-phase'),
  )
  assert(stillAwait === 'awaitComplete', 'guest cannot steal draw')

  await finishCurrent(host.page, { isDrawer: true })
  await guest.page.waitForFunction(
    () =>
      document.querySelector('[data-game-id="miss-card"]')?.getAttribute('data-party-phase') ===
      'playing',
  )
  const after = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  const deck1 = after.data.room.party.deck.map((c) => `${c.rank}${c.suit}`).join('|')
  assert(deck1 === deck0, 'no reshuffle after draw')
  assert(after.data.room.party.deckIndex === idx0 + 1, 'index +1')

  await guest.page.waitForSelector('[data-draw-card][data-draw-self="true"]')
  await guest.page.click('[data-draw-card]')
  await guest.page.waitForFunction(
    () =>
      document.querySelector('[data-game-id="miss-card"]')?.getAttribute('data-party-phase') ===
      'awaitComplete',
  )
  await finishCurrent(guest.page, { isDrawer: true })

  await host.page.waitForSelector('[data-skip-drawer]')
  await host.page.click('[data-skip-drawer]')
  await host.page.waitForFunction(
    () => (document.body.innerText || '').includes('跳过'),
    { timeout: 8000 },
  )

  const late = await newDevice(browser)
  await late.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(late.page, '晚进')
  await late.page.waitForSelector('[data-mode="partyGame"][data-game-id="miss-card"]')
  const lateSnap = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  const lateDeck = lateSnap.data.room.party.deck.map((c) => `${c.rank}${c.suit}`).join('|')
  assert(lateDeck === deck0, 'late join same deck')
  const lateRemain = await late.page.$eval(
    '[data-deck-remaining]',
    (el) => el.getAttribute('data-deck-remaining'),
  )
  const hostRemain = await host.page.$eval(
    '[data-deck-remaining]',
    (el) => el.getAttribute('data-deck-remaining'),
  )
  assert(lateRemain === hostRemain, 'late remaining matches')

  await host.page.click('[data-rules]')
  await host.page.waitForSelector('[data-rules-panel]')
  const panelRanks = await host.page.$$eval('[data-rules-panel] [data-rule-rank]', (els) =>
    els.map((el) => el.getAttribute('data-rule-rank')),
  )
  assert(panelRanks.join(',') === RANKS.join(','), 'rules panel 13')
  await clickText(host.page, '关闭')

  await host.page.screenshot({ path: `${ART}/miss-card-playing.png`, fullPage: true })
  await late.ctx.close()
  await guest.ctx.close()
  await host.ctx.close()
  console.log('PASS: miss-card flow', code)
  console.log('OK e2e-party-miss-card')
} catch (e) {
  console.error('FAIL', e)
  process.exitCode = 1
  try {
    const pages = (await browser?.pages?.()) ?? []
    const p = pages[pages.length - 1]
    if (p) {
      await p.screenshot({
        path: `${ART}/miss-card-fail.png`,
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
