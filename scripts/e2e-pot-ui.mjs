/**
 * Dual-device public pot sync QA — 「公共锅验」UI.
 * Requires: vite :45321 + relay :45322 (dev:all).
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

async function potText(page) {
  return page.evaluate(() => document.querySelector('.pot-top')?.textContent?.trim() || '')
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
  await host.waitForSelector('.nickname-card input')
  await host.type('.nickname-card input', '甲')
  await clickText(host, '进入')
  await host.waitForSelector('.page.lobby')
  const code = await host.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
  console.log('code', code)

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

  const ops = []
  guest.on('response', async (res) => {
    if (res.url().includes('/ops')) {
      try {
        ops.push(await res.json())
      } catch {
        /* ignore */
      }
    }
  })

  // 全员买入 40
  await host.evaluate(() => {
    document.querySelector('button[aria-label="菜单"]')?.click()
  })
  await host.waitForSelector('.menu-sheet')
  await clickText(host, '全员买入')
  await host.waitForSelector('.transfer-amount-input')
  await host.click('.transfer-amount-input', { clickCount: 3 })
  await host.type('.transfer-amount-input', '40')
  await clickText(host, '确认买入')
  await guest.waitForFunction(
    () => (document.querySelector('.hero-balance')?.textContent || '') === '40',
    { timeout: 10000 },
  )

  // 乙进锅 10
  await clickText(guest, '进锅')
  await guest.waitForSelector('.transfer-amount-input')
  await guest.click('.transfer-amount-input', { clickCount: 3 })
  await guest.type('.transfer-amount-input', '10')
  await clickText(guest, '确认进锅')
  await new Promise((r) => setTimeout(r, 2000))

  console.log('ops', JSON.stringify(ops, null, 2))
  const guestPot = await potText(guest)
  const hostPot = await potText(host)
  const toasts = await guest.evaluate(() =>
    [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()),
  )
  console.log('guest pot', guestPot)
  console.log('host pot', hostPot)
  console.log('toasts', toasts)
  console.log(
    'guest bal',
    await guest.evaluate(() => document.querySelector('.hero-balance')?.textContent),
  )

  await host.screenshot({ path: `${ART}/pot-host-after-guest-in.png` })
  await guest.screenshot({ path: `${ART}/pot-guest-after-in.png` })

  // Refresh guest — pot must stick
  await guest.reload({ waitUntil: 'domcontentloaded' })
  await guest.waitForSelector('.page.table', { timeout: 15000 })
  await new Promise((r) => setTimeout(r, 1500))
  const guestPotRefresh = await potText(guest)
  console.log('guest pot after refresh', guestPotRefresh)
  await guest.screenshot({ path: `${ART}/pot-guest-after-refresh.png` })

  // Host potOut 4 → 乙
  await clickText(host, '出锅')
  await host.waitForSelector('.transfer-amount-input')
  // target select + amount
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
  const amountInput = amountInputs[amountInputs.length - 1]
  await amountInput.click({ clickCount: 3 })
  await amountInput.type('4')
  await clickText(host, '确认出锅')
  await new Promise((r) => setTimeout(r, 1500))
  const potAfterOut = await potText(host)
  console.log('pot after out', potAfterOut)
  await host.screenshot({ path: `${ART}/pot-after-out.png` })

  // Host potSplit remaining
  await clickText(host, '均分')
  await host.waitForSelector('.transfer-amount-input')
  await host.click('.transfer-amount-input', { clickCount: 3 })
  await host.type('.transfer-amount-input', '6')
  await clickText(host, '确认均分')
  await new Promise((r) => setTimeout(r, 1500))
  const potAfterSplit = await potText(host)
  const guestPotSplit = await potText(guest)
  console.log('pot after split host/guest', potAfterSplit, guestPotSplit)
  await host.screenshot({ path: `${ART}/pot-after-split.png` })
  await guest.screenshot({ path: `${ART}/pot-guest-after-split.png` })

  const invalidToast = toasts.some((t) => t.includes('操作无效'))
  const ok =
    !invalidToast &&
    guestPot.includes('锅 · 10') &&
    hostPot.includes('锅 · 10') &&
    guestPotRefresh.includes('锅 · 10') &&
    potAfterOut.includes('锅 · 6') &&
    potAfterSplit.includes('锅 · 0') &&
    guestPotSplit.includes('锅 · 0')

  console.log(ok ? 'E2E_POT_OK' : 'E2E_POT_FAIL')
  await browser.close()
  process.exit(ok ? 0 : 1)
} catch (e) {
  console.error('FAIL', e.message)
  await browser.close().catch(() => {})
  process.exit(1)
}
