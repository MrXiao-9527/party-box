/**
 * Verify startPlaying toasts when setPhase returns null or throws network error.
 * Requires: npm run dev:all with VITE_RELAY_URL=http://127.0.0.1:45322
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import { fillCreateRoom } from './e2e-lib.mjs'

const BASE = 'http://127.0.0.1:45321'
const ART = '/opt/cursor/artifacts'
fs.mkdirSync(ART, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  headless: 'new',
  protocolTimeout: 60_000,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  defaultViewport: { width: 390, height: 844 },
})

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

/** @type {'ok' | 'null404' | 'network'} */
let phaseMode = 'ok'

try {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE)
      if (r.ok) break
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    const url = req.url()
    if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
      await req.abort()
      return
    }
    if (url.includes('/phase') && req.method() === 'POST') {
      if (phaseMode === 'null404') {
        await req.respond({
          status: 404,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ error: '房间不存在或已解散' }),
        })
        return
      }
      if (phaseMode === 'network') {
        await req.abort('failed')
        return
      }
    }
    await req.continue()
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.brand')
  await clickText(page, '开一桌')
  await fillCreateRoom(page)
  await clickText(page, '确认')
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', '桌主')
  await clickText(page, '进入')
  await page.waitForSelector('.page.lobby')

  phaseMode = 'null404'
  await clickText(page, '开桌')
  await page.waitForFunction(
    () => document.body.innerText.includes('开桌失败，请重开一桌或检查网络'),
    { timeout: 8000 },
  )
  const toast = await page.$eval('.toast', (el) => el.textContent.trim())
  console.log('toast:', toast)
  if (toast !== '开桌失败，请重开一桌或检查网络') {
    throw new Error(`unexpected toast: ${toast}`)
  }
  if (!(await page.$('.page.lobby'))) {
    throw new Error('expected to stay on lobby after failed 开桌')
  }
  await page.screenshot({ path: `${ART}/start-playing-toast-null.png` })
  console.log('PASS: null setPhase shows 开桌失败 toast')

  // Dismiss toast so next assertion is clean
  await page.evaluate(() => {
    document.querySelectorAll('.toast').forEach((el) => el.remove())
  })

  phaseMode = 'network'
  await clickText(page, '开桌')
  await page.waitForFunction(
    () => document.body.innerText.includes('连不上房间服务，请重试'),
    { timeout: 8000 },
  )
  const toast2 = await page.$eval('.toast', (el) => el.textContent.trim())
  console.log('toast2:', toast2)
  if (toast2 !== '连不上房间服务，请重试') {
    throw new Error(`unexpected network toast: ${toast2}`)
  }
  await page.screenshot({ path: `${ART}/start-playing-toast-network.png` })
  console.log('PASS: RelayNetworkError shows RELAY_UNREACHABLE toast')
} catch (e) {
  console.error('FAIL', e)
  try {
    const pages = await browser.pages()
    const p = pages[pages.length - 1]
    if (p) await p.screenshot({ path: `${ART}/start-playing-toast-fail.png` })
  } catch {
    /* ignore */
  }
  process.exitCode = 1
} finally {
  await browser.close()
}
