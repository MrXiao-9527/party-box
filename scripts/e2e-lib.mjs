/** Shared puppeteer helpers for party-box e2e. */

export async function clickText(page, text) {
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

/** Set a React-controlled <input> value (native setter + input event). */
export async function setInputValue(page, selector, value) {
  await page.waitForSelector(selector)
  await page.$eval(
    selector,
    (el, v) => {
      const desc = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )
      desc.set.call(el, String(v))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    value,
  )
}

function pageOrigin(page) {
  try {
    return new URL(page.url()).origin
  } catch {
    return ''
  }
}

/** Tool landing: /tools/chip | /tools/undercover | /tools/truthDare */
export async function gotoTool(page, tool) {
  const origin = pageOrigin(page)
  const path =
    tool === 'truthDare'
      ? '/tools/truthDare'
      : tool === 'undercover'
        ? '/tools/undercover'
        : '/tools/chip'
  let here = ''
  try {
    here = new URL(page.url()).pathname
  } catch {
    here = ''
  }
  if (here !== path) {
    await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' })
  }
}

export async function openChipCreate(page) {
  await gotoTool(page, 'chip')
  if (!(await page.$('[data-create-room] [name="buyInN"]'))) {
    await clickText(page, '开一桌')
  }
  await page.waitForSelector('[data-create-room] [name="buyInN"]')
}

export async function openPartyCreate(page, gameId) {
  const tool = gameId === 'truthDare' ? 'truthDare' : 'undercover'
  await gotoTool(page, tool)
  if (!(await page.$(`[data-create-party][data-game-id="${tool}"] [name="maxSeats"]`))) {
    await clickText(page, '开一桌')
  }
  await page.waitForSelector('[data-create-party] [name="maxSeats"]')
}

/** After chip tool「开一桌」is showing the create form. */
export async function fillCreateRoom(
  page,
  { buyIn = '100', maxSeats, smallBlind, bigBlind } = {},
) {
  await openChipCreate(page)
  await setInputValue(page, '[data-create-room] [name="buyInN"]', buyIn)
  await setInputValue(page, '[data-create-room] [name="maxSeats"]', maxSeats ?? '8')
  if (smallBlind != null) {
    await setInputValue(page, '[data-create-room] [name="smallBlind"]', smallBlind)
  }
  if (bigBlind != null) {
    await setInputValue(page, '[data-create-room] [name="bigBlind"]', bigBlind)
  }
}

export async function confirmCreateRoom(page, opts) {
  await fillCreateRoom(page, opts)
  await clickText(page, '确认')
}

export async function confirmCreateParty(page, { maxSeats, gameId } = {}) {
  await openPartyCreate(page, gameId)
  if (maxSeats != null) {
    await setInputValue(page, '[data-create-party] [name="maxSeats"]', maxSeats)
  }
  await clickText(page, '确认')
}

export async function hostOpenTable(page, { name = '桌主', ...create } = {}) {
  await confirmCreateRoom(page, create)
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', name)
  await clickText(page, '进入')
}
