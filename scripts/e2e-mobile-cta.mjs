import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://127.0.0.1:45321'
const CHROME = '/usr/bin/google-chrome-stable'

function tapProps(page) {
  return {
    executablePath: CHROME,
    headless: 'new',
    protocolTimeout: 60_000,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    defaultViewport: page,
  }
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

async function touchTapText(page, text) {
  const box = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find(
      (el) => (el.textContent || '').trim() === t,
    )
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
  }, text)
  if (!box) throw new Error(`no button ${text}`)
  await page.touchscreen.tap(box.x, box.y)
  return box
}

async function measure(page, selectorOrText, byText) {
  return page.evaluate(
    (sel, text) => {
      const el = text
        ? [...document.querySelectorAll('button')].find(
            (b) => (b.textContent || '').trim() === text,
          )
        : document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        bottom: r.bottom,
        right: r.right,
        vw: innerHeight,
        vh: innerWidth,
      }
    },
    selectorOrText,
    byText,
  )
}

const mobileVp = {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}

const browser = await puppeteer.launch(tapProps(mobileVp))
const page = await browser.newPage()
await page.setUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
)
page.setDefaultTimeout(20_000)

await page.goto(BASE, { waitUntil: 'networkidle2' })
await page.waitForSelector('.brand')

const homeBtn = await measure(page, '', '开一桌')
console.log('home 开一桌', homeBtn)
if (!homeBtn || homeBtn.w < 120) {
  throw new Error(`开一桌 too narrow: ${JSON.stringify(homeBtn)}`)
}

await touchTapText(page, '开一桌')
await page.waitForFunction(
  () =>
    document.body.innerText.includes('开桌中') ||
    document.body.innerText.includes('怎么称呼你'),
  { timeout: 5000 },
)
await page.waitForSelector('.nickname-card input')
await page.type('.nickname-card input', '桌主测')
await touchTapText(page, '进入')
await page.waitForSelector('.page.lobby')

const lobbyBtn = await measure(page, '', '开桌')
console.log('lobby 开桌', lobbyBtn)
if (!lobbyBtn) throw new Error('no 开桌')
const slack = lobbyBtn.vw - lobbyBtn.bottom
console.log('lobby slack from viewport bottom', slack)
if (slack < 36) {
  throw new Error(`开桌 too close to viewport bottom: ${slack}px`)
}

await touchTapText(page, '开桌')
await page.waitForFunction(
  () => !!document.querySelector('.denom-bar, .table'),
  { timeout: 8000 },
)
console.log('PASS mobile flow → ChipTable')

// A2HS centering (fresh context so dismiss key is empty)
const ctx2 = await browser.createBrowserContext()
const page2 = await ctx2.newPage()
await page2.setViewport(mobileVp)
await page2.goto(BASE, { waitUntil: 'networkidle2' })
await page2.waitForSelector('.brand')
await page2.waitForSelector('.a2hs', { timeout: 6000 })
const a2hs = await page2.evaluate(() => {
  const el = document.querySelector('.a2hs')
  const r = el.getBoundingClientRect()
  return { x: r.x, w: r.width, vw: innerWidth, transform: getComputedStyle(el).transform }
})
console.log('a2hs', a2hs)
const expectedX = (a2hs.vw - a2hs.w) / 2
if (Math.abs(a2hs.x - expectedX) > 8) {
  throw new Error(`A2HS not centered: x=${a2hs.x} expected~${expectedX}`)
}
console.log('PASS A2HS centered')

// Hung relay → 开桌中… then inline error (do not wait the full 12s: abort via intercept)
const ctx3 = await browser.createBrowserContext()
const page3 = await ctx3.newPage()
await page3.setViewport(mobileVp)
await page3.setRequestInterception(true)
page3.on('request', (req) => {
  if (req.url().includes('/rooms') && req.method() === 'POST') {
    // hang until client timeout — too slow for CI; abort immediately as network fail
    req.abort('failed')
    return
  }
  req.continue()
})
await page3.goto(BASE, { waitUntil: 'domcontentloaded' })
await page3.waitForSelector('.brand')
await touchTapText(page3, '开一桌')
await page3.waitForFunction(
  () => document.body.innerText.includes('连不上房间服务，请重试'),
  { timeout: 5000 },
)
const failed = await page3.evaluate(() => ({
  btn: [...document.querySelectorAll('button')].some(
    (b) => (b.textContent || '').trim() === '开一桌',
  ),
  err: document.body.innerText.includes('连不上房间服务，请重试'),
}))
if (!failed.btn || !failed.err) {
  throw new Error(`expected recover + inline error, got ${JSON.stringify(failed)}`)
}
console.log('PASS hung/fail create shows inline error and restores 开一桌')

await browser.close()

// Desktop mouse path
const desk = await puppeteer.launch(
  tapProps({ width: 1280, height: 800, isMobile: false, hasTouch: false }),
)
const dpage = await desk.newPage()
dpage.setDefaultTimeout(20_000)
await dpage.goto(BASE, { waitUntil: 'networkidle2' })
await dpage.waitForSelector('.brand')
await clickText(dpage, '开一桌')
await dpage.waitForSelector('.nickname-card input')
await dpage.type('.nickname-card input', '桌面主')
await clickText(dpage, '进入')
await dpage.waitForSelector('.page.lobby')
await clickText(dpage, '开桌')
await dpage.waitForFunction(() => !!document.querySelector('.denom-bar, .table'))
console.log('PASS desktop click flow → ChipTable')
await desk.close()

console.log('ALL PASS')
