/**
 * UI smoke: host 结束桌 → 结算摘要 — mismatch / 底池 / min-transfer + copy.
 * Assumes LocalStore preview/dev on :45321.
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

async function bannerHas(text) {
  return page.waitForFunction(
    (t) =>
      [...document.querySelectorAll('.settlement-banner')].some(
        (el) => (el.textContent || '').trim() === t,
      ),
    {},
    text,
  )
}

async function assertBlocked(copy) {
  await bannerHas(copy)
  await toastHas(copy)
  const section = await page.$('.settlement-transfers')
  if (section) throw new Error('transfer section must not render when blocked')
  const list = await page.$('.settlement-transfer-list')
  if (list) throw new Error('transfer list must hide when blocked')
  const hasCopy = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => {
      const t = (b.textContent || '').trim()
      return t === '复制清单' || t === '复制转账列表'
    }),
  )
  if (hasCopy) throw new Error('copy button must hide when blocked')
  await new Promise((r) => setTimeout(r, 3000))
  const banner = await page.$eval('.settlement-banner', (el) =>
    (el.textContent || '').trim(),
  )
  if (banner !== copy) throw new Error(`banner must persist: ${banner}`)
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

  await openMenu()
  await clickText('全员买入')
  await page.waitForSelector('.buyin-amount-input')
  await page.click('.buyin-amount-input', { clickCount: 3 })
  await page.keyboard.press('Backspace')
  await page.type('.buyin-amount-input', '100')
  await clickText('确认买入')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 100
  })

  // 1) 底池 > 0 blocks transfer list (8 divides evenly later)
  await clickText('放进底池')
  await page.waitForSelector('.transfer-amount-input')
  await page.type('.transfer-amount-input', '8')
  await clickText('确认放进底池')
  await page.waitForFunction(() =>
    (document.querySelector('.pot-top')?.textContent || '').includes('8'),
  )

  await openMenu()
  await clickText('结束桌')
  await page.waitForSelector('.page.settlement')
  await assertBlocked('底池还有筹码，请先分完再结算')
  await shot('settlement-pot-block')

  await clickText('返回桌面')
  await page.waitForSelector('.seat-self')

  await clickText('底池均分')
  await page.waitForSelector('.transfer-amount-input')
  await page.type('.transfer-amount-input', '8')
  await clickText('确认底池均分')
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
  await assertBlocked('买入与结算对不上，多半漏了补码，请先核对')
  await shot('settlement-mismatch-block')

  await clickText('返回桌面')
  await page.waitForSelector('.seat-self')

  // Restore buy-in / balances via 全员买入 then transfer for happy path
  await openMenu()
  await clickText('全员买入')
  await page.waitForSelector('.buyin-amount-input')
  await page.click('.buyin-amount-input', { clickCount: 3 })
  await page.keyboard.press('Backspace')
  await page.type('.buyin-amount-input', '100')
  await clickText('确认买入')
  await page.waitForFunction(() => {
    const el = document.querySelector('.hero-balance')
    return el && Number(el.textContent) === 100
  })
  await page.waitForFunction(() => !document.querySelector('.confirm-overlay'))

  await openMenu()
  await clickText('结束桌')
  await page.waitForSelector('.page.settlement')
  const flatText = await page.$eval(
    '.settlement-transfers',
    (el) => el.textContent || '',
  )
  if (!flatText.includes('本局打平，无需转账')) {
    throw new Error(`flat copy missing: ${flatText}`)
  }
  if (!flatText.includes('建议转账（最少笔数）')) {
    throw new Error(`flat title missing: ${flatText}`)
  }
  if (await page.$('.settlement-transfer-list')) {
    throw new Error('flat must not render transfer list')
  }
  const flatCopy = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => {
      const t = (b.textContent || '').trim()
      return t === '复制清单' || t === '复制转账列表'
    }),
  )
  if (flatCopy) throw new Error('flat must not show copy button')
  if (await page.$('.settlement-banner')) {
    throw new Error('flat must not show block banner')
  }
  await shot('settlement-flat')

  await clickText('返回桌面')
  await page.waitForSelector('.seat-self')

  await page.evaluate(() => {
    document.querySelector('.seats-rail .seat-other')?.click()
  })
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
  if (!totals.includes('买入合计') || !totals.includes('800')) {
    throw new Error(`bad footer: ${totals}`)
  }
  if (!totals.includes('净额合计') || !totals.includes('0')) {
    throw new Error(`bad footer net: ${totals}`)
  }
  const title = await page.$eval(
    '.settlement-transfers-title',
    (el) => (el.textContent || '').trim(),
  )
  if (title !== '建议转账（最少笔数）') {
    throw new Error(`bad transfers title: ${title}`)
  }
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => (b.textContent || '').trim() === '复制清单',
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
