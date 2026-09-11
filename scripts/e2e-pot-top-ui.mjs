/**
 * Chip-table top-bar pot always visible (0 included), size ≥ seat balance, sticky.
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

async function potMetrics() {
  return page.evaluate(() => {
    const pot = document.querySelector('.pot-top')
    const seatBal = document.querySelector('.seat-other .seat-balance')
    const header =
      document.querySelector('.table-top--pin') ||
      document.querySelector('.table-top')
    if (!pot) {
      return { text: '', potPx: 0, seatPx: 0, pos: '', visible: false, top: -1 }
    }
    const cs = getComputedStyle(pot)
    const hs = header ? getComputedStyle(header) : null
    const rect = pot.getBoundingClientRect()
    return {
      text: (pot.textContent || '').trim(),
      potPx: parseFloat(cs.fontSize),
      seatPx: seatBal ? parseFloat(getComputedStyle(seatBal).fontSize) : 0,
      pos: hs ? hs.position : '',
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        cs.display !== 'none' &&
        cs.visibility !== 'hidden',
      top: rect.top,
      bottom: rect.bottom,
    }
  })
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
  await page.waitForSelector('.page.table')
  await clickText('填满座位 (1/8)')
  await page.waitForSelector('.seat-other')
  await page.evaluate(() => {
    document.querySelectorAll('.toast').forEach((t) => t.click())
  })
  await new Promise((r) => setTimeout(r, 200))

  const atZero = await potMetrics()
  console.log('at zero', atZero)
  await page.screenshot({ path: `${ART}/pot-top-zero.png` })

  await page.evaluate(() => {
    document.querySelectorAll('.toast').forEach((t) => t.click())
    document.querySelector('.ledger-toggle')?.click()
    const pageEl = document.querySelector('.page.table')
    if (pageEl) pageEl.style.minHeight = '2200px'
    const rail = document.querySelector('.seats-rail')
    if (rail) rail.scrollLeft = rail.scrollWidth
    window.scrollTo(0, 420)
  })
  const afterScroll = await potMetrics()
  const scrollY = await page.evaluate(() => window.scrollY)
  afterScroll.scrollY = scrollY
  console.log('after scroll', afterScroll)
  await page.screenshot({ path: `${ART}/pot-top-scrolled.png` })
  await page.evaluate(() => {
    const rail = document.querySelector('.seats-rail')
    if (rail) rail.scrollLeft = 0
    const pageEl = document.querySelector('.page.table')
    if (pageEl) pageEl.style.minHeight = ''
    window.scrollTo(0, 0)
  })
  await page.evaluate(() => {
    document.querySelectorAll('.toast').forEach((t) => t.click())
  })

  await page.click('.denom-100')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) >= 100
  })
  await clickText('放进底池')
  await page.waitForSelector('.transfer-amount-input')
  await page.type('.transfer-amount-input', '7')
  await clickText('确认放进底池')
  await page.waitForFunction(
    () =>
      (document.querySelector('.pot-top')?.textContent || '').trim() ===
      '底池 · 7',
  )
  const afterIn = await potMetrics()
  console.log('after potIn', afterIn)
  await page.screenshot({ path: `${ART}/pot-top-after-in.png` })

  const pinned = atZero.pos === 'sticky' || atZero.pos === 'fixed'
  const sizeOk = atZero.potPx + 0.05 >= atZero.seatPx && atZero.seatPx > 0
  const stillPinned =
    afterScroll.visible &&
    afterScroll.scrollY > 200 &&
    afterScroll.top >= 0 &&
    afterScroll.bottom > 0 &&
    afterScroll.top < 160
  const ok =
    atZero.text === '底池 · 0' &&
    atZero.visible &&
    pinned &&
    sizeOk &&
    stillPinned &&
    afterIn.text === '底池 · 7'

  console.log(ok ? 'E2E_POT_TOP_OK' : 'E2E_POT_TOP_FAIL')
  await browser.close()
  process.exit(ok ? 0 : 1)
} catch (e) {
  console.error('FAIL', e.message)
  await browser.close().catch(() => {})
  process.exit(1)
}
