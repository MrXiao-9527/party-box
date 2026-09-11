/**
 * Dual-end 选新桌主 (any online member, not host-only):
 * 1) Host + 1 guest paused → guest 选新桌主 disabled + 「暂无在线成员可接桌」
 *    (cannot pick self; left host is offline)
 * 2) Host + 2 guests paused → guest 乙 picks 丙 → all ChipTable
 *    with 丙 桌主 / 乙·甲 玩家
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

async function joinAs(page, code, name) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.brand')
  await clickText(page, '加入')
  await page.waitForSelector('.join-panel input')
  await page.type('.join-panel input', code)
  await clickText(page, '进入')
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', name)
  await clickText(page, '进入')
  await page.waitForSelector('.page.lobby')
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
    const pickerNames = [...document.querySelectorAll('.pick-host-list button')].map(
      (b) => (b.textContent || '').trim(),
    )
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
      pickerNames,
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
  // --- 1) Host + one guest: guest cannot pick self ---
  const soloHostCtx = await browser.createBrowserContext()
  const soloGuestCtx = await browser.createBrowserContext()
  const soloHost = await soloHostCtx.newPage()
  const soloGuest = await soloGuestCtx.newPage()
  await prep(soloHost)
  await prep(soloGuest)
  await soloHost.goto(BASE, { waitUntil: 'domcontentloaded' })
  await soloHost.waitForSelector('.brand')
  await clickText(soloHost, '开一桌')
  await fillCreateRoom(soloHost, { maxSeats: '2' })
  await clickText(soloHost, '确认')
  await soloHost.waitForSelector('.nickname-card input')
  await soloHost.type('.nickname-card input', '独桌')
  await clickText(soloHost, '进入')
  await soloHost.waitForSelector('.page.lobby')
  const soloCode = await soloHost.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
  await joinAs(soloGuest, soloCode, '甲')
  await soloHost.waitForFunction(() => document.body.innerText.includes('甲'))
  await clickText(soloHost, '开桌')
  await soloHost.waitForSelector('.page.table')
  await soloGuest.waitForSelector('.page.table')
  await soloHost.goto(`${BASE}/r/${soloCode}?dev=1`, {
    waitUntil: 'domcontentloaded',
  })
  await soloHost.waitForSelector('.page.table')
  await clickText(soloHost, '模拟桌主离线/暂停')
  await soloHost.waitForSelector('.page.paused')
  await soloGuest.waitForSelector('.page.paused')
  const guestAlone = await pageState(soloGuest)
  check('1a guest paused', guestAlone.hasPaused)
  check('1b guest pick visible', guestAlone.hasPick)
  check('1c guest pick disabled', guestAlone.pickDisabled === true)
  check('1d exact tip', guestAlone.tip === '暂无在线成员可接桌')
  await shot(soloGuest, 'pick-host-guest-no-candidate')
  await soloHostCtx.close()
  await soloGuestCtx.close()

  // --- 2) Dual-end transfer: guest 乙 picks 丙 ---
  const hostCtx = await browser.createBrowserContext()
  const guestBCtx = await browser.createBrowserContext()
  const guestCCtx = await browser.createBrowserContext()
  const host = await hostCtx.newPage()
  const guestB = await guestBCtx.newPage()
  const guestC = await guestCCtx.newPage()
  await prep(host)
  await prep(guestB)
  await prep(guestC)

  await host.goto(BASE, { waitUntil: 'domcontentloaded' })
  await host.waitForSelector('.brand')
  await clickText(host, '开一桌')
  await fillCreateRoom(host, { maxSeats: '3' })
  await clickText(host, '确认')
  await host.waitForSelector('.nickname-card input')
  await host.type('.nickname-card input', '甲')
  await clickText(host, '进入')
  await host.waitForSelector('.page.lobby')
  const code = await host.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )

  await joinAs(guestB, code, '乙')
  await joinAs(guestC, code, '丙')
  await host.waitForFunction(
    () =>
      document.body.innerText.includes('乙') &&
      document.body.innerText.includes('丙'),
  )
  await clickText(host, '开桌')
  await host.waitForSelector('.page.table')
  await guestB.waitForSelector('.page.table')
  await guestC.waitForSelector('.page.table')

  await host.goto(`${BASE}/r/${code}?dev=1`, { waitUntil: 'domcontentloaded' })
  await host.waitForSelector('.page.table')
  await clickText(host, '模拟桌主离线/暂停')
  await host.waitForSelector('.page.paused')
  await guestB.waitForSelector('.page.paused')
  await guestC.waitForSelector('.page.paused')

  const bPaused = await pageState(guestB)
  check('2a guest B pick enabled', bPaused.hasPick && bPaused.pickDisabled === false)
  check('2b guest B no empty tip', bPaused.tip === '')
  const cPaused = await pageState(guestC)
  check('2c guest C pick enabled', cPaused.hasPick && cPaused.pickDisabled === false)
  await shot(guestB, 'pick-host-guest-paused')
  await shot(host, 'pick-host-left-host-paused')

  await clickText(guestB, '选新桌主')
  await guestB.waitForSelector('.pick-host-list')
  const picker = await pageState(guestB)
  check('2d picker is 丙 only', picker.pickerNames.join(',') === '丙')
  check('2e picker excludes self', !picker.pickerNames.includes('乙'))
  await shot(guestB, 'pick-host-picker')

  await clickText(guestB, '丙')
  await guestB.waitForSelector('[aria-label="确认转让桌主"]')
  await shot(guestB, 'pick-host-confirm')
  await clickText(guestB, '确认转让')

  await host.waitForSelector('.page.table')
  await guestB.waitForSelector('.page.table')
  await guestC.waitForSelector('.page.table')

  const afterHost = await pageState(host)
  const afterB = await pageState(guestB)
  const afterC = await pageState(guestC)
  check('2f host left paused', afterHost.hasChip && !afterHost.hasPaused)
  check('2g B left paused', afterB.hasChip && !afterB.hasPaused)
  check('2h C left paused', afterC.hasChip && !afterC.hasPaused)
  check(
    '2i same hostSeatId',
    afterHost.hostSeatId === afterB.hostSeatId &&
      afterB.hostSeatId === afterC.hostSeatId,
  )
  check('2j 丙 is authoritative host', afterC.isHost === true)
  check('2k picker 乙 is player', afterB.isHost === false)
  check('2l old host 甲 is player', afterHost.isHost === false)
  check('2m C top-meta 桌主', afterC.topMeta.includes('桌主'))
  check('2n B top-meta 玩家', afterB.topMeta.includes('玩家'))
  await shot(guestC, 'pick-host-after-new-host')
  await shot(guestB, 'pick-host-after-picker')

  await guestC.reload({ waitUntil: 'domcontentloaded' })
  await guestC.waitForSelector('.page.table', { timeout: 15_000 })
  const refreshed = await pageState(guestC)
  check('2o refresh keeps new host', refreshed.isHost === true && refreshed.hasChip)

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
