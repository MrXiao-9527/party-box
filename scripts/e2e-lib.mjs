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

/** After homepage「开一桌」is showing the create form. */
export async function fillCreateRoom(
  page,
  { buyIn = '100', maxSeats, smallBlind, bigBlind } = {},
) {
  await page.waitForSelector('[data-create-room] [name="buyInN"]')
  const buy = await page.$('[name="buyInN"]')
  await buy.click({ clickCount: 3 })
  await page.keyboard.press('Backspace')
  await buy.type(String(buyIn))
  if (maxSeats != null) {
    const el = await page.$('[name="maxSeats"]')
    await el.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    await el.type(String(maxSeats))
  }
  if (smallBlind != null) {
    const el = await page.$('[name="smallBlind"]')
    await el.click({ clickCount: 3 })
    await el.type(String(smallBlind))
  }
  if (bigBlind != null) {
    const el = await page.$('[name="bigBlind"]')
    await el.click({ clickCount: 3 })
    await el.type(String(bigBlind))
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
