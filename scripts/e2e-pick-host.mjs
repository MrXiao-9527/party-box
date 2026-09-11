/**
 * Dual-end 选新桌主:
 * 1) Solo paused host → 选新桌主 disabled + 「暂无在线成员可接桌」
 * 2) Host + online guest → host picker (no self) → confirm → both ChipTable
 *    with swapped authority (guest 桌主 / old host 玩家)
 *
 * Requires: vite :45321 + relay :45322 (dev:all).
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import { fillCreateRoom } from './e2e-lib.mjs'

const BASE = 'http://127.0.0.1:45321'
const ART = '/opt/cursor/artifacts/screenshots'
fs.mkdirSync(ART, { recursive: true })

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

function pageState(page) {
  return page.evaluate(() => {
    const code = location.pathname.replace(/^\/r\//, '').toUpperCase()
    let hostSeatId = null
    let phase = null
    let mySeat = null
    let members = []
    try {
      const raw = localStorage.getItem(`party-box:room:${code}`)
      const session = JSON.parse(localStorage.getItem('party-box:session') || 'null')
      if (raw) {
        const data = JSON.parse(raw)
        hostSeatId = data.room?.hostSeatId ?? null
        phase = data.room?.phase ?? null
        members = (data.room?.members ?? []).map((m) => ({
          seatId: m.seatId,
          name: m.name,
          isHost: !!m.isHost,
          connected: !!m.connected,
        }))
        mySeat = session?.seatId ?? null
      }
    } catch {
      /* ignore */
    }
    const pick = document.querySelector('[data-pick-host]')
    const tip = document.querySelector('[data-no-host-candidate]')
    return {
      phase,
      hostSeatId,
      mySeat,
      members,
      isHost: !!(mySeat && hostSeatId && mySeat === hostSeatId),
      hasPaused: !!document.querySelector('.page.paused'),
      hasChip: !!document.querySelector('.page.table'),
      topMeta: document.querySelector('.top-meta')?.textContent?.trim() ?? '',
      hasPick: !!pick,
      pickDisabled: pick ? pick.disabled : null,
      tip: tip?.textContent?.trim() ?? '',
      hasSelfInPicker: [...document.querySelectorAll('.pick-host-list button')].some(
        (b) => (b.textContent || '').includes('（我）'),
      ),
      text: document.body.innerText.slice(0, 400),
    }
  })
}

async function shot(page, name) {
  const path = `${ART}/${name}.png`
  await page.screenshot({ path, fullPage: true })
  console.log('shot', path)
}

let failed = 0
const check = (label, ok) => {
  console.log(ok ? `ok ${label}` : `FAIL ${label}`)
  if (!ok) failed++
}

try {
  // --- 1) Solo host: disabled + exact tip ---
  const soloCtx = await browser.createBrowserContext()
  const solo = await soloCtx.newPage()
  await prep(solo)
  await solo.goto(BASE, { waitUntil: 'domcontentloaded' })
  await solo.waitForSelector('.brand')
  await clickText(solo, '开一桌')
  await fillCreateRoom(solo, { maxSeats: '2' })
  await clickText(solo, '确认')
  await solo.waitForSelector('.nickname-card input')
  await solo.type('.nickname-card input', '独桌')
  await clickText(solo, '进入')
  await solo.waitForSelector('.page.lobby')
  const soloCode = await solo.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
  await clickText(solo, '开桌')
  await solo.waitForSelector('.page.table')
  await solo.goto(`${BASE}/r/${soloCode}?dev=1`, { waitUntil: 'domcontentloaded' })
  await solo.waitForSelector('.page.table')
  await clickText(solo, '模拟桌主离线/暂停')
  await solo.waitForSelector('.page.paused')
  const soloState = await pageState(solo)
  check('1a solo paused', soloState.hasPaused)
  check('1b pick visible for host', soloState.hasPick)
  check('1c pick disabled', soloState.pickDisabled === true)
  check('1d exact tip', soloState.tip === '暂无在线成员可接桌')
  await shot(solo, 'pick-host-solo-disabled')
  await soloCtx.close()

  // --- 2) Dual-end transfer ---
  const hostCtx = await browser.createBrowserContext()
  const guestCtx = await browser.createBrowserContext()
  const host = await hostCtx.newPage()
  const guest = await guestCtx.newPage()
  await prep(host)
  await prep(guest)

  await host.goto(BASE, { waitUntil: 'domcontentloaded' })
  await host.waitForSelector('.brand')
  await clickText(host, '开一桌')
  await fillCreateRoom(host, { maxSeats: '2' })
  await clickText(host, '确认')
  await host.waitForSelector('.nickname-card input')
  await host.type('.nickname-card input', '甲')
  await clickText(host, '进入')
  await host.waitForSelector('.page.lobby')
  const code = await host.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )

  await guest.goto(BASE, { waitUntil: 'domcontentloaded' })
  await guest.waitForSelector('.brand')
  await clickText(guest, '加入')
  await guest.waitForSelector('.join-panel input')
  await guest.type('.join-panel input', code)
  await clickText(guest, '进入')
  await guest.waitForSelector('.nickname-card input')
  await guest.type('.nickname-card input', '乙')
  await clickText(guest, '进入')
  await guest.waitForSelector('.page.lobby')

  await host.waitForFunction(() => document.body.innerText.includes('乙'))
  await clickText(host, '开桌')
  await host.waitForSelector('.page.table')
  await guest.waitForSelector('.page.table')

  await host.goto(`${BASE}/r/${code}?dev=1`, { waitUntil: 'domcontentloaded' })
  await host.waitForSelector('.page.table')
  await clickText(host, '模拟桌主离线/暂停')
  await host.waitForSelector('.page.paused')
  await guest.waitForSelector('.page.paused')

  const guestPaused = await pageState(guest)
  check('2a guest paused no pick control', guestPaused.hasPaused && !guestPaused.hasPick)

  const hostPaused = await pageState(host)
  check('2b host pick enabled', hostPaused.hasPick && hostPaused.pickDisabled === false)
  check('2c host no empty tip', hostPaused.tip === '')
  await shot(host, 'pick-host-host-paused')
  await shot(guest, 'pick-host-guest-paused')

  await clickText(host, '选新桌主')
  await host.waitForSelector('.pick-host-list')
  const picker = await pageState(host)
  check('2d picker excludes self', !picker.hasSelfInPicker)
  await shot(host, 'pick-host-picker')

  await clickText(host, '乙')
  await host.waitForSelector('[aria-label="确认转让桌主"]')
  await shot(host, 'pick-host-confirm')
  await clickText(host, '确认转让')

  await host.waitForSelector('.page.table')
  await guest.waitForSelector('.page.table')

  const afterHost = await pageState(host)
  const afterGuest = await pageState(guest)
  check('2e host left paused', afterHost.hasChip && !afterHost.hasPaused)
  check('2f guest left paused', afterGuest.hasChip && !afterGuest.hasPaused)
  check('2g same hostSeatId', afterHost.hostSeatId === afterGuest.hostSeatId)
  check('2h guest is authoritative host', afterGuest.isHost === true)
  check('2i old host is player', afterHost.isHost === false)
  check('2j host top-meta 玩家', afterHost.topMeta.includes('玩家'))
  check('2k guest top-meta 桌主', afterGuest.topMeta.includes('桌主'))
  await shot(host, 'pick-host-after-host')
  await shot(guest, 'pick-host-after-guest')

  await guest.reload({ waitUntil: 'domcontentloaded' })
  await guest.waitForSelector('.page.table', { timeout: 15_000 })
  const refreshed = await pageState(guest)
  check('2l refresh keeps new host', refreshed.isHost === true && refreshed.hasChip)

  if (failed) throw new Error(`${failed} checks failed`)
  console.log('E2E_PICK_HOST_OK')
  await browser.close()
  process.exit(0)
} catch (e) {
  console.error('E2E_PICK_HOST_FAIL', e)
  try {
    const pages = await browser.pages()
    let i = 0
    for (const p of pages) {
      await p
        .screenshot({ path: `${ART}/pick-host-fail-${i}.png`, fullPage: true })
        .catch(() => {})
      i += 1
    }
  } catch {
    /* ignore */
  }
  await browser.close().catch(() => {})
  process.exit(1)
}
