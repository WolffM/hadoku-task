import { test, expect } from '@playwright/test'

/**
 * Every board in the Edit Boards modal must stay reachable, however many there are.
 *
 * The regression this pins: `.edit-boards__list` had no height cap and no overflow,
 * and neither did any ancestor — `.modal-card` and `.modal-overlay` are both
 * `overflow: visible`. So the card simply grew with the account. At 67 boards it
 * rendered 3492px tall inside a 720px viewport and the bottom rows were not
 * clipped-but-scrollable, they were unreachable: nothing scrolled, and
 * `scrollIntoViewIfNeeded` had no scroll container to work with. A user with
 * enough boards could not click the last one, and `preset-update.spec.ts` failed
 * with "element is outside of the viewport" — which read like a test flake rather
 * than the product bug it was.
 *
 * Uses route interception rather than the dev API: the point is a large board
 * count, and seeding 60 real boards into a shared dev DB to prove it would leak
 * into every other spec's fixtures.
 */

const BOARD_COUNT = 60

test.beforeEach(async ({ page }) => {
  await page.route('**/task/api/session/handshake', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ preferences: null })
    })
  )
  await page.route('**/task/api/boards*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        boards: [
          { id: 'main', name: 'Main', tasks: [], tags: [] },
          ...Array.from({ length: BOARD_COUNT }, (_, i) => ({
            id: `board-${String(i).padStart(3, '0')}`,
            name: `Board ${String(i).padStart(3, '0')}`,
            tasks: [],
            tags: []
          }))
        ]
      })
    })
  )
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hadoku_session_id', 'dev-uid')
    localStorage.setItem('hadoku_user_type', 'friend')
  })
})

test('the last board stays reachable with a long board list', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
  await page.getByRole('button', { name: 'Edit boards' }).click()

  const rows = page.locator('.edit-boards__row')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThan(BOARD_COUNT / 2)

  // 1. The card must fit the viewport — that is what makes the rest possible.
  const card = page.locator('.edit-boards-modal').first()
  const geom = await card.evaluate(el => ({
    cardH: el.getBoundingClientRect().height,
    viewportH: window.innerHeight
  }))
  expect(
    geom.cardH,
    `modal card is ${geom.cardH}px in a ${geom.viewportH}px viewport — it must not outgrow the screen`
  ).toBeLessThanOrEqual(geom.viewportH)

  // 2. Something must actually scroll, or the overflow is just hidden.
  const list = page.locator('.edit-boards__list').first()
  const scrollable = await list.evaluate(el => ({
    canScroll: el.scrollHeight > el.clientHeight + 2,
    overflowY: getComputedStyle(el).overflowY
  }))
  expect(scrollable.canScroll, 'the board list should overflow its cap').toBe(true)
  expect(['auto', 'scroll']).toContain(scrollable.overflowY)

  // 3. The real test: the LAST row can be scrolled to and clicked. This is the
  //    step that threw "element is outside of the viewport" before the fix.
  const last = rows.last()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()

  const rename = last.getByRole('button', { name: /rename/i })
  if (await rename.count()) {
    await expect(rename.first()).toBeInViewport()
  }
})
