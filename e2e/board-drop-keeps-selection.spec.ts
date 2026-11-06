import { test, expect, type Page } from '@playwright/test'

/**
 * A failed board drop keeps the selection (#85).
 *
 * Dropping a multi-card selection onto a board in the top bar moves the cards
 * there. When that move FAILED, the selection used to be cleared anyway — the
 * toast said it failed, and the user then had to re-select every card before
 * retrying. Two things cleared it: the drop handler cleared unconditionally
 * (the hook reported the failure and resolved), and drag teardown cleared on
 * every drop/dragend before the move had even resolved.
 *
 * The failure injected is the one that reaches this path: every write is
 * optimistic, so a server refusal goes to onSyncError (refused-writes.spec.ts),
 * and the foreground failure is a failed LOCAL write — a full quota. Same shape
 * as error-reporting.spec.ts. Runs in public mode (localStorage-only), so it
 * needs no backend.
 */

const TITLES = ['Drop one', 'Drop two', 'Drop three']
const BOARD = 'dest'

const toast = (page: Page) => page.locator('.toast, [role="alert"]')
const card = (page: Page, title: string) => page.locator('.task-app__item', { hasText: title })
const selected = (page: Page) => page.locator('.task-app__item.selected')
const boardButton = (page: Page, name: string) =>
  page.locator('button.board-btn', { hasText: new RegExp(`^${name}$`) })

/** Neuter native dialogs exactly as the browser setting does. */
async function suppressNativeDialogs(page: Page) {
  await page.addInitScript(() => {
    window.confirm = () => false
    window.prompt = () => null
    window.alert = () => {}
  })
}

function dialogFuse(page: Page): { raised: string[] } {
  const raised: string[] = []
  page.on('dialog', async d => {
    raised.push(`${d.type()}: ${d.message()}`)
    await d.dismiss()
  })
  return { raised }
}

/** Three cards on main, and an empty board to drop them on; ends on main. */
async function setUp(page: Page) {
  await page.goto('/?userType=public')
  const field = page.locator('.task-app__input')
  await field.waitFor({ timeout: 15000 })
  for (const title of TITLES) {
    await field.fill(title)
    await field.press('Enter')
    await expect(card(page, title)).toBeVisible()
  }

  await page.getByRole('button', { name: 'Create board' }).click()
  await page.getByPlaceholder('Board name').fill(BOARD)
  await page.getByPlaceholder('Board name').press('Enter')
  await expect(boardButton(page, BOARD)).toHaveAttribute('aria-pressed', 'true')

  await boardButton(page, 'Main').click()
  await expect(boardButton(page, 'Main')).toHaveAttribute('aria-pressed', 'true')
  for (const title of TITLES) await expect(card(page, title)).toBeVisible()
}

/** Marquee-select every card, starting from the whitespace beside the list. */
async function selectAllCards(page: Page) {
  const first = await card(page, TITLES[0]).boundingBox()
  const last = await card(page, TITLES[TITLES.length - 1]).boundingBox()
  if (!first || !last) throw new Error('cards have no layout')
  const top = Math.min(first.y, last.y)
  const bottom = Math.max(first.y + first.height, last.y + last.height)
  await page.mouse.move(first.x + first.width + 20, top - 10)
  await page.mouse.down()
  await page.mouse.move(first.x + first.width / 2, bottom + 5, { steps: 8 })
  await page.mouse.up()
  await expect(selected(page)).toHaveCount(TITLES.length)
}

/**
 * The app's own drag protocol, as the browser runs it: `dragstart` on a selected
 * card, `drop` on the board button, then `dragend` on the source card if it is
 * still mounted (it is, when the move failed). Dispatched rather than
 * `locator.dragTo()`, which hangs on these targets (refused-lane-drag.spec.ts).
 */
async function dropSelectionOnBoard(page: Page, title: string, board: string) {
  const result = await page.evaluate(
    ({ title, board }) => {
      const src = [...document.querySelectorAll('.task-app__item')].find(el =>
        el.textContent?.includes(title)
      ) as HTMLElement | undefined
      const target = [...document.querySelectorAll('button.board-btn')].find(
        el => el.textContent?.trim() === board
      ) as HTMLElement | undefined
      if (!src || !target) return { ok: false, ids: '' }
      const dt = new DataTransfer()
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
      if (src.isConnected) {
        src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
      }
      return { ok: true, ids: dt.getData('application/x-hadoku-task-ids') }
    },
    { title, board }
  )
  expect(result.ok, `card "${title}" and board "${board}" should both exist`).toBe(true)
  // The whole selection travels, not just the card the drag started on.
  expect(JSON.parse(result.ids || '[]')).toHaveLength(TITLES.length)
}

/** Fail every task-blob write from here on, the way a full origin does. */
async function breakTaskWrites(page: Page) {
  await page.evaluate(() => {
    const realSetItem = window.localStorage.setItem.bind(window.localStorage)
    window.localStorage.setItem = (key: string, value: string) => {
      if (key.endsWith('-tasks')) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      realSetItem(key, value)
    }
  })
}

test.beforeEach(async ({ page }) => {
  await suppressNativeDialogs(page)
})

test('a failed board drop reports it and keeps the selection', async ({ page }) => {
  const fuse = dialogFuse(page)
  await setUp(page)
  await selectAllCards(page)
  await breakTaskWrites(page)

  await dropSelectionOnBoard(page, TITLES[1], BOARD)

  await expect(toast(page).first()).toContainText(/quota/i, { timeout: 10000 })
  // Still on main, every card still there AND still selected — a retry is one
  // drag, not three re-selections.
  await expect(boardButton(page, 'Main')).toHaveAttribute('aria-pressed', 'true')
  for (const title of TITLES) await expect(card(page, title)).toBeVisible()
  await expect(selected(page)).toHaveCount(TITLES.length)
  // And it stays that way once everything has settled.
  await page.waitForTimeout(500)
  await expect(selected(page)).toHaveCount(TITLES.length)

  expect(fuse.raised, 'the app must not raise native browser dialogs').toEqual([])
})

test('a board drop that lands moves the cards and clears the selection', async ({ page }) => {
  await setUp(page)
  await selectAllCards(page)

  await dropSelectionOnBoard(page, TITLES[1], BOARD)

  // The move switches to the target board, where the cards now are.
  await expect(boardButton(page, BOARD)).toHaveAttribute('aria-pressed', 'true')
  for (const title of TITLES) await expect(card(page, title)).toBeVisible()
  await expect(selected(page)).toHaveCount(0)
  await expect(toast(page)).toHaveCount(0)

  await boardButton(page, 'Main').click()
  for (const title of TITLES) await expect(card(page, title)).toHaveCount(0)
})
