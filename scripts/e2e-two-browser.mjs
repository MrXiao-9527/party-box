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
  page.setDefaultTimeout(15_000)
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

try {
  // Separate contexts = separate localStorage (two devices)
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
  await host.type('.nickname-card input', '桌主A')
  await clickText(host, '进入')
  await host.waitForSelector('.page.lobby')
  const code = await host.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
  console.log('code', code)
  await host.screenshot({ path: `${ART}/01-host-lobby.png` })

  await guest.goto(BASE, { waitUntil: 'domcontentloaded' })
  await guest.waitForSelector('.brand')
  await clickText(guest, '加入')
  await guest.waitForSelector('.join-panel input')
  await guest.type('.join-panel input', code)
  await clickText(guest, '进入')
  await guest.waitForSelector('.nickname-card input')
  await guest.type('.nickname-card input', '玩家B')
  await clickText(guest, '进入')
  await guest.waitForSelector('.page.lobby')

  await host.waitForFunction(() => document.body.innerText.includes('玩家B'), {
    timeout: 10000,
  })
  await guest.waitForFunction(() => document.body.innerText.includes('桌主A'), {
    timeout: 10000,
  })

  await host.screenshot({ path: `${ART}/02-host-sees-guest.png` })
  await guest.screenshot({ path: `${ART}/03-guest-lobby.png` })

  const ht = await host.evaluate(() => document.body.innerText)
  const gt = await guest.evaluate(() => document.body.innerText)
  console.log('---HOST---\n' + ht)
  console.log('---GUEST---\n' + gt)
  const ok =
    ht.includes('玩家B') &&
    gt.includes('桌主A') &&
    !gt.includes('不存在') &&
    !gt.includes('已解散')
  console.log(ok ? 'E2E_OK' : 'E2E_FAIL')
  await browser.close()
  process.exit(ok ? 0 : 1)
} catch (e) {
  console.error('FAIL', e.message)
  await browser.close().catch(() => {})
  process.exit(1)
}
