/**
 * Create-room form + QR join URL + full/invalid copy.
 * LocalStore (no relay) for form/QR/invalid; join-full uses roomLogic (see test-room-create).
 *
 * Run: vite on :45321  →  node scripts/e2e-qr-create.mjs
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import { clickText, fillCreateRoom } from './e2e-lib.mjs'

const BASE = 'http://127.0.0.1:45321'
const ART = '/opt/cursor/artifacts/screenshots'
const JOIN_ORIGIN = 'https://party-box-43z.pages.dev'
fs.mkdirSync(ART, { recursive: true })

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  headless: 'new',
  protocolTimeout: 60_000,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  defaultViewport: { width: 390, height: 844 },
})

const page = await browser.newPage()
page.setDefaultTimeout(20_000)
await page.setRequestInterception(true)
page.on('request', (req) => {
  const url = req.url()
  if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
    req.abort()
    return
  }
  req.continue()
})

async function shot(name) {
  const path = `${ART}/${name}.png`
  await page.screenshot({ path, fullPage: true })
  console.log('shot', path)
}

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.brand')

  // buy-in ≤0 blocked
  await clickText(page, '开一桌')
  await fillCreateRoom(page, { buyIn: '0' })
  await clickText(page, '确认')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) =>
      (t.textContent || '').includes('请输入正整数'),
    ),
  )
  assert(!(await page.$('.nickname-card')), 'buy-in 0 must not navigate')
  await shot('create-buyin-zero')

  // seats 1 blocked
  await fillCreateRoom(page, { buyIn: '100', maxSeats: '1' })
  await clickText(page, '确认')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) =>
      (t.textContent || '').includes('人数须为2–8'),
    ),
  )
  await shot('create-seats-1')

  // seats 9 blocked
  await fillCreateRoom(page, { buyIn: '100', maxSeats: '9' })
  await clickText(page, '确认')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) =>
      (t.textContent || '').includes('人数须为2–8'),
    ),
  )
  await shot('create-seats-9')

  // happy path → lobby QR
  await fillCreateRoom(page, {
    buyIn: '100',
    maxSeats: '2',
    smallBlind: '1',
    bigBlind: '2',
  })
  await clickText(page, '确认')
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', '桌主')
  await clickText(page, '进入')
  await page.waitForSelector('.page.lobby')
  const code = await page.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
  const joinUrl = await page.$eval('[data-join-url]', (el) =>
    el.getAttribute('data-join-url'),
  )
  const expected = `${JOIN_ORIGIN}/r/${code}`
  assert(joinUrl === expected, `QR url ${joinUrl} !== ${expected}`)
  assert(!joinUrl.includes('trycloudflare'), 'QR must not be trycloudflare')
  assert(
    documentHas(await page.content(), '复制房间码') &&
      documentHas(await page.content(), '复制链接'),
    'copy code + link',
  )
  const settings = await page.$eval('.room-settings', (el) => el.textContent)
  assert(settings.includes('100'), 'settings buy-in')
  assert(settings.includes('2'), 'settings seats')
  await shot('lobby-qr')

  await clickText(page, '开桌')
  await page.waitForSelector('.seat-self')
  await clickText(page, '邀请')
  await page.waitForSelector('.invite-box [data-join-url]')
  const tableUrl = await page.$eval('.invite-box [data-join-url]', (el) =>
    el.getAttribute('data-join-url'),
  )
  assert(tableUrl === expected, 'table QR same pages.dev url')
  const tableSettings = await page.$eval(
    '.invite-box .room-settings',
    (el) => el.textContent,
  )
  assert(tableSettings.includes('100') && tableSettings.includes('2'), 'read-only settings')
  await shot('table-invite-settings')

  // invalid room code
  await page.goto(`${BASE}/r/@@@`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) =>
      (t.textContent || '').includes('房码无效'),
    ),
  )
  await shot('invalid-code')

  console.log('OK e2e-qr-create', code)
} catch (err) {
  console.error(err)
  await shot('qr-create-fail')
  process.exitCode = 1
} finally {
  await browser.close()
}

function documentHas(html, text) {
  return html.includes(text)
}
