/**
 * UI smoke: host 撤销上一笔 — seatAdjust + buy-in, preview, ledger, empty toast.
 * Needs Vite :45321 + relay :45322.
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

const page = await browser.newPage()
page.setDefaultTimeout(20_000)

async function clickText(text) {
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
    b?.click()
  }, text)
}

async function openMenu() {
  await page.waitForSelector('button[aria-label="菜单"]')
  await page.evaluate(() => {
    document.querySelector('button[aria-label="菜单"]')?.click()
  })
  await page.waitForSelector('.menu-sheet')
}

async function shot(name) {
  const path = `${ART}/${name}.png`
  await page.screenshot({ path, fullPage: true })
  console.log('shot', path)
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await clickText('开一桌')
  await fillCreateRoom(page)
  await clickText('确认')
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', '地主')
  await clickText('进入')
  await page.waitForFunction(() => location.pathname.startsWith('/r/'))
  const roomPath = await page.evaluate(() => location.pathname)
  await page.goto(`${BASE}${roomPath}?dev=1`, { waitUntil: 'networkidle0' })
  await clickText('开桌')
  await page.waitForSelector('.seat-self')
  await clickText('填满座位 (1/8)')
  await page.waitForSelector('.seat-other')

  // Empty undo → toast
  await openMenu()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.menu-sheet button')].some(
      (b) => (b.textContent || '').trim() === '撤销上一笔',
    ),
  )
  await shot('undo-menu-entry')
  await clickText('撤销上一笔')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((el) =>
      (el.textContent || '').includes('没有可撤销的记录'),
    ),
  )

  // 本席加减: denom 100 → ledger seatAdjust → undo
  await page.click('.denom-100')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) >= 100
  })
  await new Promise((r) => setTimeout(r, 400))

  await openMenu()
  await clickText('撤销上一笔')
  await page.waitForSelector('[aria-label="撤销上一笔"]')
  await page.waitForFunction(() =>
    (document.body.textContent || '').includes('将撤销：地主 +100'),
  )
  await shot('undo-seat-adjust-preview')
  await clickText('确认撤销')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 0
  })

  // Buy-in then undo
  await openMenu()
  await clickText('全员买入')
  await page.waitForSelector('.buyin-amount-input')
  await page.click('.buyin-amount-input', { clickCount: 3 })
  await page.type('.buyin-amount-input', '50')
  await clickText('确认买入')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 50
  })

  await openMenu()
  await clickText('撤销上一笔')
  await page.waitForSelector('[aria-label="撤销上一笔"]')
  await page.waitForFunction(() =>
    (document.body.textContent || '').includes('将撤销：全员买入 50'),
  )
  await shot('undo-confirm-preview')
  await clickText('确认撤销')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 0
  })

  // Ledger shows both 撤销 rows
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('流水'),
    )
    t?.click()
  })
  await page.waitForFunction(() => {
    const text = [...document.querySelectorAll('.ledger-row')]
      .map((r) => r.textContent || '')
      .join('\n')
    return (
      text.includes('撤销 · 全员买入 50') &&
      text.includes('撤销 · 地主 +100') &&
      // success row copy: nickname + signed amount in who
      [...document.querySelectorAll('.ledger-who')].some(
        (el) => (el.textContent || '').trim() === '地主 +100',
      )
    )
  })
  await shot('undo-ledger-row')

  console.log('e2e-undo-ui: OK')
} catch (e) {
  await shot('undo-e2e-fail')
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
}
