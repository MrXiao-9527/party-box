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

/** After homepage「开一桌」is showing the create form. */
export async function fillCreateRoom(
  page,
  { buyIn = '100', maxSeats, smallBlind, bigBlind } = {},
) {
  await page.waitForSelector('[data-create-room] [name="buyInN"]')
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
  await clickText(page, '开一桌')
  await fillCreateRoom(page, opts)
  await clickText(page, '确认')
}

export async function hostOpenTable(page, { name = '桌主', ...create } = {}) {
  await confirmCreateRoom(page, create)
  await page.waitForSelector('.nickname-card input')
  await page.type('.nickname-card input', name)
  await clickText(page, '进入')
}
