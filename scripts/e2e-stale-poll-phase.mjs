/**
 * Product lock acceptance:
 * 1) Only newer snapshotAt applies (room+table gated together)
 * 2) After 开桌, dual-end MUST stay on ChipTable — kickback to 「等候开桌」 = FAIL
 * Requires: npm run dev:all
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

async function uiPhase(page) {
  return page.evaluate(() => ({
    hasTable: !!document.querySelector('.page.table'),
    hasLobby: !!document.querySelector('.page.lobby'),
    waitLobby: document.body.innerText.includes('等候开桌'),
  }))
}

/** Inject older/equal/newer lobby payload via same path as poll/WS. */
async function injectStaleLobby(page, { equalAge = false, newer = false } = {}) {
  return page.evaluate(
    ({ equal, newerAt }) => {
      const code = location.pathname.replace(/^\/r\//, '').toUpperCase()
      const raw = localStorage.getItem(`party-box:room:${code}`)
      if (!raw) return { ok: false, reason: 'no local room' }
      const data = JSON.parse(raw)
      const at = data.table.snapshotAt ?? 1
      const staleAt = newerAt ? at + 10_000 : equal ? at : Math.max(0, at - 10_000)
      const stale = {
        room: { ...data.room, phase: 'lobby' },
        table: {
          ...data.table,
          snapshotAt: staleAt,
        },
      }
      window.dispatchEvent(
        new CustomEvent('party-box:relay-room', {
          detail: { roomCode: code, data: stale },
        }),
      )
      return { ok: true, currentAt: at, staleAt: stale.table.snapshotAt }
    },
    { equal: equalAge, newerAt: newer },
  )
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

  // Rapid 开桌
  await host.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(
      (el) => (el.textContent || '').trim() === '开桌',
    )
    b.click()
    b.click()
    b.click()
  })

  await host.waitForSelector('.page.table', { timeout: 10_000 })
  await guest.waitForSelector('.page.table', { timeout: 12_000 })

  let h = await uiPhase(host)
  let g = await uiPhase(guest)
  console.log('dual after 开桌', { host: h, guest: g })
  if (!h.hasTable || h.hasLobby || h.waitLobby) {
    throw new Error('FAIL: host not on ChipTable after 开桌')
  }
  if (!g.hasTable || g.hasLobby || g.waitLobby) {
    throw new Error('FAIL: guest not on ChipTable after 开桌')
  }

  // Stale older + equal-age + newer lobby inject on both ends
  console.log('host stale', await injectStaleLobby(host))
  console.log('guest stale', await injectStaleLobby(guest))
  console.log('host equal', await injectStaleLobby(host, { equalAge: true }))
  console.log('guest equal', await injectStaleLobby(guest, { equalAge: true }))
  console.log('host newer lobby', await injectStaleLobby(host, { newer: true }))
  console.log('guest newer lobby', await injectStaleLobby(guest, { newer: true }))
  await new Promise((r) => setTimeout(r, 1000))

  h = await uiPhase(host)
  g = await uiPhase(guest)
  console.log('dual after stale inject', { host: h, guest: g })

  await host.screenshot({
    path: `${ART}/dual_host_still_table.png`,
    fullPage: true,
  })
  await guest.screenshot({
    path: `${ART}/dual_guest_still_table.png`,
    fullPage: true,
  })

  if (!h.hasTable || h.hasLobby || h.waitLobby) {
    throw new Error('FAIL: host kicked back to 等候开桌')
  }
  if (!g.hasTable || g.hasLobby || g.waitLobby) {
    throw new Error('FAIL: guest kicked back to 等候开桌')
  }

  console.log('ok: dual-end ChipTable; stale/equal lobby cannot revert')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
}
