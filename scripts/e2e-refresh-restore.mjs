/**
 * Locked QA acceptance for 回席:
 * 1) Same room-code refresh → silent restore; MUST NOT nickname page
 * 2) Balance follows host TableSnapshot (not stale/local zero)
 * 3) Paused table → silent reseat stays on paused UI (no auto-resume)
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
    const paused = !!document.querySelector('.page.paused')
    return !nick && (lobby || chip || paused)
  })
}

function state(page) {
  return page.evaluate(() => {
    const code = location.pathname.replace(/^\/r\//, '').toUpperCase()
    let balance = null
    let phase = null
    try {
      const raw = localStorage.getItem(`party-box:room:${code}`)
      if (raw) {
        const data = JSON.parse(raw)
        phase = data.room?.phase ?? null
        const session = JSON.parse(localStorage.getItem('party-box:session') || 'null')
        const seat = data.table?.seats?.find((s) => s.seatId === session?.seatId)
        balance = seat?.balance ?? null
      }
    } catch {
      /* ignore */
    }
    const hero = document.querySelector('.hero-balance')
    return {
      path: location.pathname,
      hasNick: !!document.querySelector('.nickname-card'),
      hasLobby: !!document.querySelector('.page.lobby'),
      hasChip: !!document.querySelector('.seat-self'),
      hasPaused: !!document.querySelector('.page.paused'),
      heroBalance: hero ? Number(hero.textContent) : null,
      balance,
      phase,
      text: document.body.innerText.slice(0, 320),
    }
  })
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

  // (1) Lobby refresh silent
  await host.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(host)
  const hLobby = await state(host)
  check('1a host refresh lobby silent', !hLobby.hasNick && hLobby.hasLobby)
  await host.screenshot({ path: `${ART}/refresh-host-lobby.png` })

  await guest.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(guest)
  const gLobby = await state(guest)
  check('1b guest refresh lobby silent', !gLobby.hasNick && gLobby.hasLobby)

  await clickText(host, '开桌')
  await host.waitForFunction(() => !!document.querySelector('.seat-self'))
  await guest.waitForFunction(() => !!document.querySelector('.seat-self'))

  // (2) Buy chips then refresh — balance must follow TableSnapshot
  await host.click('button.denom-100')
  await host.waitForFunction(
    () => document.querySelector('.hero-balance')?.textContent === '100',
    { timeout: 8000 },
  )
  const beforeBal = await state(host)
  check('2a host balance set to 100', beforeBal.heroBalance === 100)

  // Stale local zero must not win after refresh
  await host.evaluate((c) => {
    const key = `party-box:room:${c}`
    const raw = localStorage.getItem(key)
    if (!raw) return
    const data = JSON.parse(raw)
    data.table = {
      ...data.table,
      seats: data.table.seats.map((s) => ({ ...s, balance: 0 })),
      snapshotAt: 1,
    }
    localStorage.setItem(key, JSON.stringify(data))
  }, code)

  await host.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(host)
  await host.waitForFunction(
    () => document.querySelector('.hero-balance')?.textContent === '100',
    { timeout: 8000 },
  )
  const afterBal = await state(host)
  check(
    '2b refresh balance from TableSnapshot (not stale zero)',
    !afterBal.hasNick &&
      afterBal.hasChip &&
      afterBal.heroBalance === 100 &&
      afterBal.balance === 100,
  )
  await host.screenshot({ path: `${ART}/refresh-balance-snapshot.png` })

  await guest.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(guest)
  check(
    '1c guest refresh playing silent',
    !(await state(guest)).hasNick && (await state(guest)).hasChip,
  )

  // Session fallback when identity key wiped
  await guest.evaluate(() => localStorage.removeItem('party-box:identity'))
  await guest.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(guest)
  check(
    '1d guest session-fallback silent',
    !(await state(guest)).hasNick && (await state(guest)).hasChip,
  )

  // /restore fails but GET still has our seat → silent + keep balance path
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
  check('1e guest restore-api-fail silent', !gFail.hasNick && gFail.hasChip)
  check('1f no seat_taken toast on restore fail', !gFail.text.includes('原席被占'))

  // (3) Pause then refresh — stay on paused UI, no auto-resume
  // Drop restore interceptor so host pause/restore work normally.
  guest.removeAllListeners('request')
  guest.on('request', (req) => {
    const url = req.url()
    if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
      req.abort()
      return
    }
    req.continue()
  })

  await host.goto(`${BASE}/r/${code}?dev=1`, { waitUntil: 'domcontentloaded' })
  await waitSeat(host)
  await clickText(host, '模拟桌主离线/暂停')
  await host.waitForSelector('.page.paused')
  const pausedBefore = await state(host)
  check(
    '3a host paused UI before refresh',
    pausedBefore.hasPaused && pausedBefore.phase === 'paused',
  )
  await host.screenshot({ path: `${ART}/refresh-paused-before.png` })

  await host.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(host)
  const pausedAfter = await state(host)
  check(
    '3b paused silent reseat (no nick, no auto-resume)',
    !pausedAfter.hasNick &&
      pausedAfter.hasPaused &&
      !pausedAfter.hasChip &&
      pausedAfter.phase === 'paused' &&
      pausedAfter.text.includes('桌子已暂停'),
  )
  await host.screenshot({ path: `${ART}/refresh-paused-after.png` })

  // Guest also lands on paused UI after host pause + refresh
  await guest.reload({ waitUntil: 'domcontentloaded' })
  await waitSeat(guest)
  const gPaused = await state(guest)
  check(
    '3c guest paused after host leave + refresh',
    !gPaused.hasNick && gPaused.hasPaused && gPaused.phase === 'paused',
  )

  console.log(failed ? `${failed} failed` : 'E2E_REFRESH_OK')
  await browser.close()
  process.exit(failed ? 2 : 0)
} catch (e) {
  console.error(e)
  await browser.close()
  process.exit(1)
}
