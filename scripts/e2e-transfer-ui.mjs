/**
 * UI smoke: transfer A→B + one-to-many + insufficient toast + ledger.
 * Assumes LocalStore preview on :45321 (no VITE_RELAY_URL in build).
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

  // buy-in via denom 100 × clicks ≈ need enough for transfers
  for (let i = 0; i < 3; i++) {
    await page.click('.denom-100')
    await new Promise((r) => setTimeout(r, 120))
  }
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.hero-balance')
      return el && Number(el.textContent) >= 300
    },
  )

  // Select first other seat → transfer 3
  await page.click('.seat-other')
  await clickText('转筹码')
  await page.waitForSelector('.transfer-amount-input')
  await page.type('.transfer-amount-input', '3')
  await page.waitForFunction(() =>
    (document.querySelector('.transfer-preview')?.textContent || '').includes('我 -3'),
  )
  await shot('transfer-preview-single')
  await clickText('确认转出')
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.hero-balance')
      return el && Number(el.textContent) === 297
    },
  )

  // One-to-many: two seats × 3
  const others = await page.$$('.seat-other')
  await others[0].click()
  await others[1].click()
  await clickText('转筹码')
  await page.waitForSelector('.transfer-amount-input')
  await page.click('.transfer-amount-input', { clickCount: 3 })
  await page.type('.transfer-amount-input', '3')
  await page.waitForFunction(() =>
    (document.querySelector('.transfer-preview')?.textContent || '').includes('我 -6'),
  )
  await shot('transfer-preview-multi')
  await clickText('确认转出')
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.hero-balance')
      return el && Number(el.textContent) === 291
    },
  )

  // Insufficient batch
  await others[0].click()
  await others[1].click()
  await clickText('转筹码')
  await page.type('.transfer-amount-input', '9999')
  await clickText('确认转出')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) =>
      (t.textContent || '').includes('余额不足'),
    ),
  )
  await shot('transfer-insufficient-toast')
  await page.evaluate(() => {
    const box = document.querySelector('.transfer-box')
    const b = box && [...box.querySelectorAll('button')].find(
      (el) => (el.textContent || '').trim() === '取消',
    )
    b?.click()
  })
  await page.waitForFunction(() => !document.querySelector('.transfer-box'))
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.transfer-bar button')].find(
      (el) => (el.textContent || '').trim() === '取消',
    )
    b?.click()
  })

  // Ledger
  await page.click('.ledger-toggle')
  await page.waitForSelector('.ledger-row')
  await shot('transfer-ledger')

  // Locked self blocks transfer
  await clickText('☰')
  await clickText('锁定座位')
  await page.click('.seat-other')
  await clickText('转筹码')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) =>
      (t.textContent || '').includes('席位已锁定'),
    ),
  )
  await shot('transfer-locked-toast')

  console.log('UI smoke OK')
} catch (e) {
  await shot('transfer-ui-fail')
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
}
