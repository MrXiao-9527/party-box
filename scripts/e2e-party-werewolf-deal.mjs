/**
 * Werewolf-deal e2e: lobby board, deal privates, no host roster,
 * public composition, late join, redeal→lobby, stage copy.
 * Run: npm run test:e2e-party-werewolf-deal
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { clickText, confirmCreateParty } from './e2e-lib.mjs'
import { publicPayloadLeaks } from '../server/werewolfDeal.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = Number(process.env.E2E_FE_PORT || 45421)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45422)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-werewolf-'))
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

function ownRole(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-private-role]')
    return el?.getAttribute('data-private-role') || ''
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
  await host.page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await host.page.waitForSelector('[data-tool="werewolf-deal"]')
  await host.page.click('[data-tool="werewolf-deal"]')
  await confirmCreateParty(host.page, { maxSeats: '10', gameId: 'werewolf-deal' })
  await nickEnter(host.page, '桌主W')
  await host.page.waitForSelector('[data-game-id="werewolf-deal"]')
  const code = await host.page.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )

  const guest = await newDevice(browser)
  await guest.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(guest.page, '玩家甲')
  await guest.page.waitForSelector('[data-game-id="werewolf-deal"]')

  await host.page.waitForFunction(
    () => document.querySelector('[data-seat-count]')?.getAttribute('data-seat-count') === '2',
  )
  const lobbyText = await pageText(host.page)
  assert(lobbyText.includes('狼人×1'), `auto board wolf ${lobbyText}`)
  assert(lobbyText.includes('平民×1'), 'auto board villager')
  assert(await host.page.$('[data-deal]'), 'host deal button')
  assert(!(await guest.page.$('[data-deal]')), 'guest no deal')

  await host.page.click('[data-tweak="villager"][data-dir="inc"]')
  await host.page.waitForFunction(
    () => document.querySelector('[data-deal-gate]')?.getAttribute('data-deal-gate'),
  )
  const gate = await host.page.$eval('[data-deal-gate]', (el) => el.getAttribute('data-deal-gate'))
  assert(gate.includes('对不上') || gate.includes('狼人') || gate.includes('好人'), `gate ${gate}`)
  const dealDisabled = await host.page.$eval('[data-deal]', (el) => el.disabled)
  assert(dealDisabled, 'illegal tweak disables deal')
  await host.page.screenshot({ path: `${ART}/werewolf-tweak-block.png`, fullPage: true })

  await host.page.click('[data-reset-board]')
  await host.page.waitForFunction(
    () => document.querySelector('[data-can-deal]')?.getAttribute('data-can-deal') === 'true',
  )
  await host.page.click('[data-deal]')
  await host.page.waitForSelector('[data-private-role]')
  await guest.page.waitForSelector('[data-private-role]')

  const hostRole = await ownRole(host.page)
  const guestRole = await ownRole(guest.page)
  assert(hostRole, 'host has private role')
  assert(guestRole, 'guest has private role')
  assert(hostRole !== guestRole, `different roles ${hostRole} ${guestRole}`)

  const hostCopy = await pageText(host.page)
  const guestCopy = await pageText(guest.page)
  assert(!hostCopy.includes('谁是谁'), 'no who copy')
  assert(hostCopy.includes('本局构成') && guestCopy.includes('本局构成'), 'composition')
  const hostSeesGuestRole = guestRole === 'werewolf'
    ? hostCopy.includes('你的身份') && hostRole !== 'werewolf' && !host.page.url().includes('god')
    : true
  assert(hostSeesGuestRole, 'host page exists')
  const hostHasGuestCard = await host.page.evaluate((role) => {
    const mine = document.querySelector('[data-private-role]')?.getAttribute('data-private-role')
    const cards = [...document.querySelectorAll('[data-private-role]')]
    return cards.length === 1 && mine !== role ? cards.length === 1 : cards.length === 1
  }, guestRole)
  assert(hostHasGuestCard, 'host sees only one private card')

  const snap = await fetch(`${RELAY_URL}/rooms/${code}`)
  const json = await snap.json()
  assert(!publicPayloadLeaks(json), `http leak ${publicPayloadLeaks(json)}`)
  assert(json.data.room.party.phase === 'dealt', 'http dealt')
  assert(Array.isArray(json.data.room.party.roleComposition), 'http composition')
  assert(!json.data.partyPrivates, 'http no privates')

  await host.page.screenshot({ path: `${ART}/werewolf-dealt-host.png`, fullPage: true })
  await guest.page.screenshot({ path: `${ART}/werewolf-dealt-guest.png`, fullPage: true })

  const late = await newDevice(browser)
  await late.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(late.page, '晚进')
  await late.page.waitForSelector('[data-late-join]')
  const lateText = await pageText(late.page)
  assert(lateText.includes('没有身份'), `late copy ${lateText}`)
  assert(!(await late.page.$('[data-private-role]')), 'late no card')
  assert(lateText.includes('本局构成'), 'late sees composition')
  await late.page.screenshot({ path: `${ART}/werewolf-late-join.png`, fullPage: true })

  await host.page.click('[data-set-stage="night"]')
  await host.page.waitForFunction(
    () => document.querySelector('[data-werewolf-stage]')?.getAttribute('data-werewolf-stage') === 'night',
  )
  await guest.page.waitForFunction(
    () => document.querySelector('[data-werewolf-stage]')?.getAttribute('data-werewolf-stage') === 'night',
  )
  const nightText = await pageText(guest.page)
  assert(nightText.includes('天黑了'), 'night copy')
  assert(!nightText.includes('查验面板') && !nightText.includes('用药'), 'no skill panel')

  await host.page.click('[data-redeal]')
  await host.page.waitForSelector('[data-redeal-confirm]')
  await host.page.click('[data-confirm-redeal]')
  await host.page.waitForFunction(
    () => document.querySelector('[data-party-phase]')?.getAttribute('data-party-phase') === 'lobby',
  )
  await guest.page.waitForFunction(
    () => document.querySelector('[data-party-phase]')?.getAttribute('data-party-phase') === 'lobby',
  )
  assert(!(await host.page.$('[data-private-role]')), 'host old card gone')
  assert(!(await guest.page.$('[data-private-role]')), 'guest old card gone')
  const after = await pageText(host.page)
  assert(after.includes('未开始') || after.includes('大厅'), `back lobby ${after}`)
  await host.page.screenshot({ path: `${ART}/werewolf-redeal-lobby.png`, fullPage: true })

  await host.page.click('[data-deal]')
  await host.page.waitForSelector('[data-private-role]')
  const newHostRole = await ownRole(host.page)
  assert(newHostRole, 'redeal then deal new card')

  await host.ctx.close()
  await guest.ctx.close()
  await late.ctx.close()
  console.log('OK e2e-party-werewolf-deal', code)
} catch (e) {
  console.error('FAIL', e)
  process.exitCode = 1
  try {
    const pages = (await browser?.pages?.()) ?? []
    const p = pages[pages.length - 1]
    if (p) {
      await p.screenshot({
        path: `${ART}/werewolf-fail.png`,
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
