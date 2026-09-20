/**
 * Slice C e2e: reveal public words + dual-end phase + next-round re-deal.
 * Acceptance ③ — half-success (one end revealed, other playing) is a fail.
 * Run: npm run test:e2e-party-reveal
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
const FE = Number(process.env.E2E_FE_PORT || 45387)
const RELAY = Number(process.env.E2E_RELAY_PORT || 45388)
const BASE = `http://127.0.0.1:${FE}`
const RELAY_URL = `http://127.0.0.1:${RELAY}`
const ART = '/opt/cursor/artifacts/screenshots'
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'party-box-e2e-reveal-'))
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

function pagePhase(page) {
  return page.evaluate(
    () => document.querySelector('[data-party-phase]')?.getAttribute('data-party-phase') || '',
  )
}

function revealRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-reveal-seat]')].map((el) => ({
      seat: el.getAttribute('data-reveal-seat') || '',
      word: el.getAttribute('data-reveal-word') || '',
      role: el.getAttribute('data-reveal-role') || '',
      text: el.textContent || '',
    })),
  )
}

function rowsKey(rows) {
  return JSON.stringify(
    [...rows]
      .map((r) => ({ seat: r.seat, word: r.word, role: r.role }))
      .sort((a, b) => a.seat.localeCompare(b.seat)),
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

  const playingSnap = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  const playingLeak = publicPayloadLeaks(playingSnap, [wHost, wG1, wG2])
  assert(!playingLeak, `playing public leak ${playingLeak}`)
  assert(playingSnap.data.room.party.phase === 'playing', 'GET playing')
  assert(
    playingSnap.data.room.party.seats.every(
      (s) => !('word' in s) && !('role' in s),
    ),
    'playing public has no word/role',
  )

  const late = await newDevice(browser)
  await late.page.goto(`${BASE}/r/${code}`, { waitUntil: 'domcontentloaded' })
  await nickEnter(late.page, '玩家D')
  await late.page.waitForSelector('[data-midjoin]')

  await clickText(host.page, '揭晓')
  await host.page.waitForSelector('[data-party-phase="revealed"]')
  await guest1.page.waitForSelector('[data-party-phase="revealed"]')
  await guest2.page.waitForSelector('[data-party-phase="revealed"]')
  await late.page.waitForSelector('[data-party-phase="revealed"]')

  const phases = await Promise.all([
    pagePhase(host.page),
    pagePhase(guest1.page),
    pagePhase(guest2.page),
    pagePhase(late.page),
  ])
  assert(
    phases.every((p) => p === 'revealed'),
    `dual-end reveal phases ${phases.join(',')}`,
  )

  const hostRows = await revealRows(host.page)
  const g1Rows = await revealRows(guest1.page)
  const g2Rows = await revealRows(guest2.page)
  const lateRows = await revealRows(late.page)
  assert(hostRows.length === 4, `reveal 4 seats got ${hostRows.length}`)
  assert(rowsKey(hostRows) === rowsKey(g1Rows), 'host/guest1 reveal match')
  assert(rowsKey(hostRows) === rowsKey(g2Rows), 'host/guest2 reveal match')
  assert(rowsKey(hostRows) === rowsKey(lateRows), 'host/late reveal match')

  const withWord = hostRows.filter((r) => r.word)
  const without = hostRows.filter((r) => !r.word)
  assert(withWord.length === 3, '3 seats revealed with word')
  assert(without.length === 1, 'mid-join has no identity')
  assert(
    withWord.every((r) => r.role === 'civilian' || r.role === 'undercover'),
    'roles civilian/undercover',
  )
  assert(withWord.filter((r) => r.role === 'undercover').length === 1, 'one 卧底')
  const hostText = await host.page.evaluate(() => document.body.innerText || '')
  const g1Text = await guest1.page.evaluate(() => document.body.innerText || '')
  assert(hostText.includes('平民') && hostText.includes('卧底'), 'host shows identities')
  assert(g1Text.includes('平民') && g1Text.includes('卧底'), 'guest shows identities')
  for (const w of [wHost, wG1, wG2]) {
    assert(hostText.includes(w), `host public list has ${w}`)
    assert(g1Text.includes(w), `guest public list has ${w}`)
  }
  const lateText = await late.page.evaluate(() => document.body.innerText || '')
  assert(lateText.includes('本局已开始，本席未发词，请等下一局'), 'late still waiting')
  assert(!(await ownWord(late.page)), 'late no private card')

  const revSnap = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  assert(revSnap.data.room.party.phase === 'revealed', 'GET revealed')
  const revSeats = revSnap.data.room.party.seats
  assert(
    revSeats.filter((s) => s.hasWord).every((s) => s.word && s.role),
    'GET every dealt seat has word+role',
  )
  await host.page.screenshot({ path: `${ART}/undercover-reveal-host.png`, fullPage: true })
  await guest1.page.screenshot({ path: `${ART}/undercover-reveal-guest.png`, fullPage: true })
  console.log('PASS: dual-end revealed; public words+roles')

  await clickText(host.page, '下一局')
  await host.page.waitForSelector('[data-party-phase="playing"]')
  await guest1.page.waitForSelector('[data-party-phase="playing"]')
  await guest2.page.waitForSelector('[data-party-phase="playing"]')
  await late.page.waitForSelector('[data-party-phase="playing"]')

  const nextPhases = await Promise.all([
    pagePhase(host.page),
    pagePhase(guest1.page),
    pagePhase(guest2.page),
    pagePhase(late.page),
  ])
  assert(
    nextPhases.every((p) => p === 'playing'),
    `dual-end next-round phases ${nextPhases.join(',')}`,
  )

  await host.page.waitForSelector('[data-private-word]')
  await guest1.page.waitForSelector('[data-private-word]')
  await guest2.page.waitForSelector('[data-private-word]')
  await late.page.waitForSelector('[data-private-word]')

  const nHost = await ownWord(host.page)
  const nG1 = await ownWord(guest1.page)
  const nG2 = await ownWord(guest2.page)
  const nLate = await ownWord(late.page)
  assert(nHost && nG1 && nG2 && nLate, 'all four seats have new private words')
  assert(new Set([nHost, nG1, nG2, nLate]).size === 2, 'two words after re-deal')

  const nextSnap = await fetch(`${RELAY_URL}/rooms/${code}`).then((r) => r.json())
  assert(nextSnap.data.room.party.phase === 'playing', 'GET playing after next-round')
  assert(nextSnap.data.room.party.round === 2, 'GET round 2')
  const nextLeak = publicPayloadLeaks(nextSnap, [nHost, nG1, nG2, nLate])
  assert(!nextLeak, `next-round public leak ${nextLeak}`)
  assert(
    nextSnap.data.room.party.seats.every((s) => !('word' in s) && !('role' in s)),
    'next-round public has no word/role',
  )

  await host.page.screenshot({ path: `${ART}/undercover-next-round-host.png`, fullPage: true })
  await late.page.screenshot({ path: `${ART}/undercover-next-round-late.png`, fullPage: true })
  console.log('PASS: dual-end next-round playing with new private words')

  await late.ctx.close()
  await guest2.ctx.close()
  await guest1.ctx.close()
  await host.ctx.close()
  console.log('OK e2e-party-reveal')
} catch (e) {
  console.error('FAIL', e)
  process.exitCode = 1
  try {
    const pages = (await browser?.pages?.()) ?? []
    const p = pages[pages.length - 1]
    if (p) {
      await p.screenshot({
        path: `${ART}/undercover-reveal-fail.png`,
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
