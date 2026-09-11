/**
 * UI smoke: host 结束桌 → 结算摘要 — mismatch / 底池 / min-transfer + copy.
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

async function openMenu() {
  await page.waitForSelector('button[aria-label="菜单"]')
  await page.evaluate(() => {
    document.querySelector('button[aria-label="菜单"]')?.click()
  })
  await page.waitForSelector('.menu-sheet')
}

async function toastHas(text) {
  return page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('.toast')].some((el) =>
        (el.textContent || '').includes(t),
      ),
    {},
    text,
  )
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

  await openMenu()
  await clickText('全员买入')
  await page.waitForSelector('.buyin-amount-input')
  await page.type('.buyin-amount-input', '100')
  await clickText('确认买入')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 100
  })

  // 1) 底池 > 0 blocks transfer list (8 divides evenly later)
  await clickText('进锅')
  await page.waitForSelector('.transfer-amount-input')
  await page.type('.transfer-amount-input', '8')
  await clickText('确认进锅')
  await page.waitForFunction(() =>
    (document.querySelector('.pot-top')?.textContent || '').includes('8'),
  )

  await openMenu()
  await clickText('结束桌')
  await page.waitForSelector('.page.settlement')
  await toastHas('底池还有筹码，请先分完再结算')
  const hasListPot = await page.$('.settlement-transfer-list')
  if (hasListPot) throw new Error('transfer list must hide when pot > 0')
  await shot('settlement-pot-block')

  await clickText('返回桌面')
  await page.waitForSelector('.seat-self')

  await clickText('均分')
  await page.waitForSelector('.transfer-amount-input')
  await page.type('.transfer-amount-input', '8')
  await clickText('确认均分')
  await page.waitForFunction(() =>
    (document.querySelector('.pot-top')?.textContent || '').includes('0'),
  )

  // 2) 买入 ≠ 结算 (seat − does not reduce 累计买入)
  await page.waitForSelector('.denom-5')
  await page.evaluate(() => {
    return new Promise((resolve) => {
      const el = document.querySelector('.denom-5')
      el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      window.setTimeout(() => {
        el?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        resolve()
      }, 520)
    })
  })
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) < 100
  })

  await openMenu()
  await clickText('结束桌')
  await page.waitForSelector('.page.settlement')
  await toastHas('买入与结算对不上，多半漏了补码，请先核对')
  const hasListMis = await page.$('.settlement-transfer-list')
  if (hasListMis) throw new Error('transfer list must hide on mismatch')
  await shot('settlement-mismatch-block')

  await clickText('返回桌面')
  await page.waitForSelector('.seat-self')

  // Restore buy-in / balances via 全员买入 then transfer for happy path
  await openMenu()
  await clickText('全员买入')
  await page.waitForSelector('.buyin-amount-input')
  await page.type('.buyin-amount-input', '100')
  await clickText('确认买入')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 100
  })

  await page.click('.seat-other')
  await page.waitForSelector('.transfer-bar')
  await clickText('转筹码')
  await page.waitForSelector('.transfer-amount-input')
  await page.type('.transfer-amount-input', '25')
  await clickText('确认转出')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 75
  })

  await openMenu()
  await clickText('结束桌')
  await page.waitForSelector('.page.settlement')
  await page.waitForSelector('.settlement-transfer-list')
  const line = await page.$eval(
    '.settlement-transfer-list li',
    (el) => el.textContent.trim(),
  )
  if (!line.includes('→') || !line.includes('· 25')) {
    throw new Error(`bad transfer line: ${line}`)
  }
  const totals = await page.$eval('.settlement-foot', (el) => el.textContent)
  if (!totals.includes('800') || !totals.includes('0')) {
    throw new Error(`bad footer: ${totals}`)
  }
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => (b.textContent || '').trim() === '复制转账列表',
    ),
  )
  await shot('settlement-ok')

  console.log('e2e settlement UI: OK')
} catch (err) {
  console.error(err)
  await shot('settlement-e2e-fail')
  process.exitCode = 1
} finally {
  await browser.close()
}
