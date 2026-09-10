/**
 * UI smoke: host 全员买入 — entry, preview, settle, ledger, N≤0 toast.
 * Assumes LocalStore preview/dev on :45321.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

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

async function shot(name) {
  const path = `${ART}/${name}.png`
  await page.screenshot({ path, fullPage: true })
  console.log('shot', path)
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await clickText('开一桌')
  await page.waitForSelector('input')
  await page.type('input', '地主')
  await clickText('进入')
  await page.waitForFunction(() => location.pathname.startsWith('/r/'))
  const roomPath = await page.evaluate(() => location.pathname)
  await page.goto(`${BASE}${roomPath}?dev=1`, { waitUntil: 'networkidle0' })
  await clickText('开桌')
  await page.waitForSelector('.seat-self')
  await clickText('填满座位 (1/8)')
  await page.waitForSelector('.seat-other')

  // Uneven balances via denom clicks
  await page.click('.denom-100')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) >= 100
  })
  await new Promise((r) => setTimeout(r, 300))

  // Open overflow → 全员买入
  await page.waitForSelector('button[aria-label="菜单"]')
  await page.evaluate(() => {
    document.querySelector('button[aria-label="菜单"]')?.click()
  })
  await page.waitForSelector('.menu-sheet')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.menu-sheet button')].some(
      (b) => (b.textContent || '').trim() === '全员买入',
    ),
  )
  await shot('buyin-menu-entry')
  await clickText('全员买入')
  await page.waitForSelector('.buyin-amount-input')

  // N≤0 → toast, no-op
  await page.type('.buyin-amount-input', '0')
  await clickText('确认买入')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) =>
      (t.textContent || '').includes('请输入正整数'),
    ),
  )
  await shot('buyin-invalid-toast')
  // Dialog still open; clear and enter 50
  await page.click('.buyin-amount-input', { clickCount: 3 })
  await page.keyboard.press('Backspace')
  await page.type('.buyin-amount-input', '50')
  await page.waitForFunction(() =>
    (document.querySelector('.transfer-preview')?.textContent || '').includes(
      '全员余额将设为 50',
    ),
  )
  await shot('buyin-preview')
  await clickText('确认买入')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 50
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.seat-balance')].every(
      (el) => Number(el.textContent) === 50,
    ),
  )

  await page.click('.ledger-toggle')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.ledger-row')].some((r) =>
      (r.textContent || '').includes('全员买入 50'),
    ),
  )
  const ledgerCount = await page.$$eval('.ledger-row', (rows) => rows.length)
  if (ledgerCount !== 1) throw new Error(`expected 1 ledger row, got ${ledgerCount}`)
  await shot('buyin-ledger')

  console.log('e2e buyin UI: OK')
} catch (err) {
  console.error(err)
  await shot('buyin-e2e-fail')
  process.exitCode = 1
} finally {
  await browser.close()
}
