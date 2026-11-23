import { test, expect } from '@wolffm/e2e-harness/playwright'
import type { Page, Route } from '@playwright/test'

/**
 * The loading skeleton stays up until the boards have loaded.
 *
 * The shell used to reveal on the localStorage paint, before GET /boards came
 * back. On a cold cache that paint is a synthesized, empty "main" board, so the
 * user watched an empty board fill in a beat later. A synced user's reveal now
 * waits for the server's boards — bounded by a cap, so a hung network still
 * falls back to the cached paint instead of trapping the user on the skeleton.
 *
 * /task/api/boards is intercepted so its timing is deterministic.
 */

const BOARDS_ROUTE = '**/task/api/boards*'
const TASK_TITLE = 'SERVER-ONLY-TASK'
/** Longer than any reveal that doesn't wait on the network, shorter than the cap. */
const BOARDS_DELAY_MS = 2000

function boardsBody() {
  const now = new Date().toISOString()
  return JSON.stringify({
    version: 1,
    updatedAt: now,
    boards: [
      {
        id: 'main',
        name: 'main',
        tags: [],
        tasks: [{ id: 't1', title: TASK_TITLE, state: 'Active', createdAt: now, tag: null }]
      }
    ]
  })
}

/** Fresh friend session with an empty cache, starting on the skeleton. */
async function coldFriendLoad(page: Page, onBoards: (route: Route) => Promise<void>) {
  await page.goto('/?userType=friend')
  await page.evaluate(() => localStorage.clear())
  await page.route(BOARDS_ROUTE, onBoards)
  await page.reload()
}

test.describe('Loading skeleton', () => {
  test('stays up until the server boards land, then reveals with them', async ({ page }) => {
    let released = false
    await coldFriendLoad(page, async route => {
      await new Promise(r => setTimeout(r, BOARDS_DELAY_MS))
      released = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: boardsBody() })
    })

    // Sample the DOM the moment the shell appears: it must already hold the
    // server's task, and the boards response must already have been released.
    const container = page.locator('.task-app-container')
    await expect(page.locator('.task-app-loading')).toBeVisible()
    await expect(container).toBeAttached({ timeout: 15000 })
    expect(released, 'shell revealed before GET /boards answered').toBe(true)
    await expect(page.locator('.task-app__item-title', { hasText: TASK_TITLE })).toBeVisible()
    await expect(page.locator('.task-app-loading')).toHaveCount(0)
  })

  test('a hung boards request still reveals the shell after the cap', async ({ page }) => {
    // Never answered: the cap is the only thing that can end the skeleton.
    await coldFriendLoad(page, () => new Promise<void>(() => {}))

    await expect(page.locator('.task-app-loading')).toBeVisible()
    await expect(page.locator('.task-app-container')).toBeAttached({ timeout: 10000 })
    await expect(page.locator('.task-app__filters')).toBeVisible()
  })
})
