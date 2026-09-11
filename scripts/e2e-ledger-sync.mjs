/**
 * Dual-end 桌内流水: same append-only feed, locked copy, newest first.
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

async function ledgerWhos(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.ledger-who')].map((el) =>
      (el.textContent || '').trim(),
    ),
  )
}

async function waitLedgerHas(page, line) {
  await page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('.ledger-who')].some(
        (el) => (el.textContent || '').trim() === t,
      ),
    { timeout: 12_000 },
    line,
  )
}

async function shot(page, name) {
  const path = `${ART}/${name}.png`
  await page.screenshot({ path, fullPage: true })
  console.log('shot', path)
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
  await host.waitForSelector('.ledger-list')
  await guest.waitForSelector('.ledger-list')

  const emptyHost = await host.$eval('.ledger-empty', (el) => el.textContent?.trim())
  const emptyGuest = await guest.$eval('.ledger-empty', (el) => el.textContent?.trim())
  if (emptyHost !== '暂无流水' || emptyGuest !== '暂无流水') {
    throw new Error(`empty copy host=${emptyHost} guest=${emptyGuest}`)
  }

  await host.click('.denom-100')
  await waitLedgerHas(host, '甲 席位+100')
  await waitLedgerHas(guest, '甲 席位+100')

  await host.evaluate(() => {
    document.querySelector('button[aria-label="菜单"]')?.click()
  })
  await host.waitForSelector('.menu-sheet')
  await clickText(host, '全员买入')
  await host.waitForSelector('.buyin-amount-input')
  await host.click('.buyin-amount-input', { clickCount: 3 })
  await host.type('.buyin-amount-input', '40')
  await clickText(host, '确认买入')
  await waitLedgerHas(host, '全员买入 40')
  await waitLedgerHas(guest, '全员买入 40')

  await clickText(guest, '放进底池')
  await guest.waitForSelector('.transfer-amount-input')
  await guest.click('.transfer-amount-input', { clickCount: 3 })
  await guest.type('.transfer-amount-input', '10')
  await clickText(guest, '确认放进底池')
  await waitLedgerHas(host, '进底池 10')
  await waitLedgerHas(guest, '进底池 10')

  await host.click('.seat-other')
  await clickText(host, '转筹码')
  await host.waitForSelector('.transfer-amount-input')
  await host.type('.transfer-amount-input', '5')
  await clickText(host, '确认转出')
  await waitLedgerHas(host, '甲 → 乙 · 转 5')
  await waitLedgerHas(guest, '甲 → 乙 · 转 5')

  await host.evaluate(() => {
    document.querySelector('button[aria-label="菜单"]')?.click()
  })
  await host.waitForSelector('.menu-sheet')
  await clickText(host, '撤销上一笔')
  await host.waitForSelector('[aria-label="撤销上一笔"]')
  await host.waitForFunction(() =>
    (document.body.textContent || '').includes('将撤销：甲 → 乙 · 转 5'),
  )
  await clickText(host, '确认撤销')
  await waitLedgerHas(host, '撤销：甲 → 乙 · 转 5')
  await waitLedgerHas(guest, '撤销：甲 → 乙 · 转 5')

  await clickText(host, '从底池发给')
  await host.waitForSelector('.pot-target-select')
  await host.evaluate(() => {
    const sel = document.querySelector('.pot-target-select')
    if (sel) {
      const opt = [...sel.options].find((o) => o.textContent.includes('乙'))
      if (opt) {
        sel.value = opt.value
        sel.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
  })
  const amountInputs = await host.$$('.transfer-amount-input')
  await amountInputs[amountInputs.length - 1].click({ clickCount: 3 })
  await amountInputs[amountInputs.length - 1].type('4')
  await clickText(host, '确认从底池发给')
  await waitLedgerHas(host, '出底池 4')
  await waitLedgerHas(guest, '出底池 4')

  await clickText(host, '底池均分')
  await host.waitForSelector('.transfer-amount-input')
  await host.click('.transfer-amount-input', { clickCount: 3 })
  await host.type('.transfer-amount-input', '6')
  await clickText(host, '确认底池均分')
  await waitLedgerHas(host, '均分底池')
  await waitLedgerHas(guest, '均分底池')

  const hostLines = await ledgerWhos(host)
  const guestLines = await ledgerWhos(guest)
  if (hostLines[0] !== '均分底池') {
    throw new Error(`newest-first failed: ${JSON.stringify(hostLines)}`)
  }
  if (JSON.stringify(hostLines) !== JSON.stringify(guestLines)) {
    throw new Error(
      `dual-end mismatch host=${JSON.stringify(hostLines)} guest=${JSON.stringify(guestLines)}`,
    )
  }

  await shot(host, 'ledger-host-feed')
  await shot(guest, 'ledger-guest-feed')

  await guest.reload({ waitUntil: 'domcontentloaded' })
  await guest.waitForSelector('.page.table', { timeout: 15_000 })
  await waitLedgerHas(guest, '均分底池')
  await waitLedgerHas(guest, '甲 席位+100')
  const afterRefresh = await ledgerWhos(guest)
  if (JSON.stringify(afterRefresh) !== JSON.stringify(hostLines)) {
    throw new Error(
      `refresh mismatch ${JSON.stringify(afterRefresh)} vs ${JSON.stringify(hostLines)}`,
    )
  }
  await shot(guest, 'ledger-guest-after-refresh')

  console.log('E2E_LEDGER_OK', hostLines)
  await browser.close()
  process.exit(0)
} catch (e) {
  console.error('E2E_LEDGER_FAIL', e)
  await browser.close().catch(() => {})
  process.exit(1)
}
