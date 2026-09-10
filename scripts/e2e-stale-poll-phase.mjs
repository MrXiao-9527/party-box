/**
 * Verify stale lobby relay payload cannot revert ChipTable after 开桌.
 * Covers poll/WS race: setRoom was previously applied even when snapshot rejected.
 * Requires: npm run dev:all (vite :45321 + relay :45322)
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
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
      req.abort()
      return
    }
    req.continue()
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.brand')
  await clickText(page, '开一桌')
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', '甲')
  await clickText(page, '进入')
  await page.waitForSelector('.page.lobby')

  // Rapid 开桌 clicks (bug report: host clicks repeatedly)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(
      (el) => (el.textContent || '').trim() === '开桌',
    )
    b.click()
    b.click()
    b.click()
  })
  await page.waitForSelector('.page.table', { timeout: 10_000 })

  const before = await page.evaluate(() => ({
    hasTable: !!document.querySelector('.page.table'),
    hasLobby: !!document.querySelector('.page.lobby'),
  }))
  console.log('after 开桌', before)

  // Inject stale lobby payload the same way late poll/WS would
  // (onRelayRoomUpdate → applySyncedRoom). Snapshot older than current.
  const injected = await page.evaluate(() => {
    const code = location.pathname.replace(/^\/r\//, '').toUpperCase()
    const key = `party-box:room:${code}`
    const raw = localStorage.getItem(key)
    if (!raw) return { ok: false, reason: 'no local room' }
    const data = JSON.parse(raw)
    const stale = {
      room: { ...data.room, phase: 'lobby' },
      table: {
        ...data.table,
        snapshotAt: Math.max(0, (data.table.snapshotAt ?? 1) - 10_000),
      },
    }
    window.dispatchEvent(
      new CustomEvent('party-box:relay-room', {
        detail: { roomCode: code, data: stale },
      }),
    )
    return {
      ok: true,
      currentAt: data.table.snapshotAt,
      staleAt: stale.table.snapshotAt,
      currentPhase: data.room.phase,
    }
  })
  console.log('injected stale', injected)

  await new Promise((r) => setTimeout(r, 800))

  const after = await page.evaluate(() => ({
    hasTable: !!document.querySelector('.page.table'),
    hasLobby: !!document.querySelector('.page.lobby'),
    bodyHasWait: document.body.innerText.includes('等候开桌'),
  }))
  console.log('after stale inject', after)

  await page.screenshot({
    path: `${ART}/stale_poll_phase_still_table.png`,
    fullPage: true,
  })

  if (!after.hasTable || after.hasLobby || after.bodyHasWait) {
    throw new Error('stale lobby payload reverted UI to lobby')
  }
  console.log('ok: stale lobby inject did not revert playing → lobby')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
}
