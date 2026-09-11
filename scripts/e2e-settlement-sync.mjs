/**
 * Dual-device 结算验: host 结束桌 → guest sees same snapshot / 转账建议.
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
  page.setDefaultTimeout(25_000)
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

async function openMenu(page) {
  await page.waitForSelector('button[aria-label="菜单"]')
  await page.evaluate(() => {
    document.querySelector('button[aria-label="菜单"]')?.click()
  })
  await page.waitForSelector('.menu-sheet')
}

try {
  const hostCtx = await browser.createBrowserContext()
  const guestCtx = await browser.createBrowserContext()
  const host = await hostCtx.newPage()
  const guest = await guestCtx.newPage()
  await prep(host)
  await prep(guest)

  await host.goto(BASE, { waitUntil: 'domcontentloaded' })
  await host.waitForSelector('.brand')
  await clickText(host, '开一桌')
  await fillCreateRoom(host)
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

  await clickText(host, '开桌')
  await host.waitForSelector('.seat-self')
  await guest.waitForSelector('.seat-self')

  await openMenu(host)
  await clickText(host, '全员买入')
  await host.waitForSelector('.buyin-amount-input')
  await host.type('.buyin-amount-input', '100')
  await clickText(host, '确认买入')
  await host.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 100
  })
  await guest.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 100
  })

  await host.click('.seat-other')
  await host.waitForSelector('.transfer-bar')
  await clickText(host, '转筹码')
  await host.waitForSelector('.transfer-amount-input')
  await host.type('.transfer-amount-input', '40')
  await clickText(host, '确认转出')
  await host.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 60
  })
  await guest.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 140
  })

  await openMenu(host)
  await clickText(host, '结束桌')
  await host.waitForSelector('.page.settlement')
  await guest.waitForSelector('.page.settlement')

  const hostLine = await host.$eval(
    '.settlement-transfer-list li',
    (el) => el.textContent.trim(),
  )
  const guestLine = await guest.$eval(
    '.settlement-transfer-list li',
    (el) => el.textContent.trim(),
  )
  if (hostLine !== guestLine) {
    throw new Error(`lines differ: host=${hostLine} guest=${guestLine}`)
  }
  if (hostLine !== '甲 → 乙 · 40') {
    throw new Error(`unexpected line: ${hostLine}`)
  }

  const guestBack = await guest.evaluate(() =>
    [...document.querySelectorAll('button')].some(
      (b) => (b.textContent || '').trim() === '返回桌面',
    ),
  )
  if (guestBack) throw new Error('guest must not see 返回桌面')

  await host.screenshot({
    path: `${ART}/settlement-sync-host.png`,
    fullPage: true,
  })
  await guest.screenshot({
    path: `${ART}/settlement-sync-guest.png`,
    fullPage: true,
  })
  console.log('e2e settlement sync: OK')
} catch (err) {
  console.error(err)
  process.exitCode = 1
} finally {
  await browser.close()
}
