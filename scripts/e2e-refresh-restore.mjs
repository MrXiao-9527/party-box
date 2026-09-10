/**
 * QA gate: refresh same room code must silently restore seat (no nickname page).
 * Also: /restore failure must not drop to nick when sync still shows our seat.
 *
 * Run with: npm run dev:all  →  node scripts/e2e-refresh-restore.mjs
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

async function waitSeat(page) {
  await page.waitForFunction(() => {
    const nick = !!document.querySelector('.nickname-card')
    const lobby = !!document.querySelector('.page.lobby')
    const chip = !!document.querySelector('.seat-self')
    return !nick && (lobby || chip)
  })
}

function state(page) {
  return page.evaluate(() => ({
    path: location.pathname,
    hasNick: !!document.querySelector('.nickname-card'),
    hasLobby: !!document.querySelector('.page.lobby'),
    hasChip: !!document.querySelector('.seat-self'),
    text: document.body.innerText.slice(0, 280),
    identity: localStorage.getItem('party-box:identity'),
    session: localStorage.getItem('party-box:session'),
  }))
}

let failed = 0
const check = (label, ok) => {
  console.log(ok ? `ok ${label}` : `FAIL ${label}`)
  if (!ok) failed++
}

try {
  const hostCtx = await browser.createBrowserContext()
  const guestCtx = await browser.createBrowserContext()
  const host = await hostCtx.newPage()
  const guest = await guestCtx.newPage()
  await prep(host)
  await prep(guest)

  await host.goto(BASE, { waitUntil: 'domcontentloaded' })
  await clickText(host, '开一桌')
  await host.waitForSelector('.nickname-card input')
  await host.type('.nickname-card input', '桌主A')
  await clickText(host, '进入')
  await waitSeat(host)
  const code = await host.evaluate(() =>
    location.pathname.replace(/^\/r\//, '').toUpperCase(),
  )
  console.log('code', code)

  await guest.goto(BASE, { waitUntil: 'domcontentloaded' })
  await clickText(guest, '加入')
  await guest.waitForSelector('.join-panel input')
  await guest.type('.join-panel input', code)
  await clickText(guest, '进入')
  await guest.waitForSelector('.nickname-card input')
  await guest.type('.nickname-card input', '玩家B')
  await clickText(guest, '进入')
  await waitSeat(guest)

  // Lobby refresh (before 开桌)
  await host.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(host)
  const hLobby = await state(host)
  check('host refresh lobby silent', !hLobby.hasNick && hLobby.hasLobby)
  await host.screenshot({ path: `${ART}/refresh-host-lobby.png` })

  await guest.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(guest)
  const gLobby = await state(guest)
  check('guest refresh lobby silent', !gLobby.hasNick && gLobby.hasLobby)
  await guest.screenshot({ path: `${ART}/refresh-guest-lobby.png` })

  // Ensure host still sees 开桌 after own refresh, then start
  await clickText(host, '开桌')
  await host.waitForFunction(() => !!document.querySelector('.seat-self'))
  await guest.waitForFunction(() => !!document.querySelector('.seat-self'))

  await host.reload({ waitUntil: 'domcontentloaded' })
  await guest.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(host)
  await waitSeat(guest)
  const hPlay = await state(host)
  const gPlay = await state(guest)
  check('host refresh playing silent', !hPlay.hasNick && hPlay.hasChip)
  check('guest refresh playing silent', !gPlay.hasNick && gPlay.hasChip)
  await host.screenshot({ path: `${ART}/refresh-host-playing.png` })
  await guest.screenshot({ path: `${ART}/refresh-guest-playing.png` })

  // Session fallback when identity key wiped
  await guest.evaluate(() => localStorage.removeItem('party-box:identity'))
  await guest.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(guest)
  const gSession = await state(guest)
  check('guest session-fallback silent', !gSession.hasNick && gSession.hasChip)
  await guest.screenshot({ path: `${ART}/refresh-session-fallback.png` })

  // /restore fails but GET still has our seat → silent
  guest.removeAllListeners('request')
  guest.on('request', (req) => {
    const url = req.url()
    if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
      req.abort()
      return
    }
    if (url.includes('/restore') && req.method() === 'POST') {
      req.respond({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: '房间不存在或已解散' }),
      })
      return
    }
    req.continue()
  })
  await guest.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(guest)
  const gFail = await state(guest)
  check('guest restore-api-fail silent', !gFail.hasNick && gFail.hasChip)
  check('no seat_taken toast on restore fail', !gFail.text.includes('原席被占'))
  await guest.screenshot({ path: `${ART}/refresh-restore-fail-fallback.png` })

  console.log(failed ? `${failed} failed` : 'E2E_REFRESH_OK')
  await browser.close()
  process.exit(failed ? 2 : 0)
} catch (e) {
  console.error(e)
  await browser.close()
  process.exit(1)
}
