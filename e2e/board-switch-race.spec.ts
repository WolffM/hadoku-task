import { test, expect, type Page } from '@playwright/test'

/**
 * Regression test for the board-switch load race.
 *
 * Repro (reported in prod): a returning user lands on /task/. Boards paint
 * immediately from the localStorage cache, but `initialLoad()` is still
 * fetching the server view in the background. The user clicks a non-default
 * board during that window. When the fetch lands, the UI is left showing the
 * *default* board's tasks while the clicked board stays selected.
 *
 * Cause: `reload()` sliced the response against the `currentBoardId` captured
 * in its closure at mount ('main'), not the board the user had since selected.
 */

const SESSION_ID = 'race-test-session'
const USER_TYPE = 'friend'

const MAIN_TASK = 'MAIN-BOARD-ONLY-TASK'
const WORK_TASK = 'WORK-BOARD-ONLY-TASK'

/** How long the background /boards sync is held open, in ms. */
const SYNC_DELAY_MS = 2500

function boardsPayload() {
  const now = new Date().toISOString()
  return {
    version: 1,
    updatedAt: now,
    boards: [
      {
        id: 'main',
        name: 'main',
        tags: [],
        tasks: [{ id: 'task-main-1', title: MAIN_TASK, state: 'Active', createdAt: now, tag: null }]
      },
      {
        id: 'work',
        name: 'work',
        tags: [],
        tasks: [{ id: 'task-work-1', title: WORK_TASK, state: 'Active', createdAt: now, tag: null }]
      }
    ]
  }
}

/**
 * Seed the localStorage the app would have from a previous visit, so boards
 * render before the network sync resolves — that gap is the race window.
 */
async function seedCachedSession(page: Page) {
  const payload = boardsPayload()
  await page.addInitScript(
    ({ userType, sessionId, data }) => {
      localStorage.clear()
      localStorage.setItem('hadoku_user_type', userType)
      localStorage.setItem('hadoku_session_id', sessionId)
      localStorage.setItem(
        `${userType}-${sessionId}-boards`,
        JSON.stringify({
          version: 1,
          updatedAt: data.updatedAt,
          boards: data.boards.map(b => ({ id: b.id, name: b.name, tags: b.tags }))
        })
      )
      for (const board of data.boards) {
        localStorage.setItem(
          `${userType}-${sessionId}-${board.id}-tasks`,
          JSON.stringify({ version: 1, updatedAt: data.updatedAt, tasks: board.tasks })
        )
      }
    },
    { userType: USER_TYPE, sessionId: SESSION_ID, data: payload }
  )
}

async function stubApi(page: Page) {
  await page.route('**/task/api/session/handshake', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ userType: USER_TYPE, preferences: null })
    })
  )

  // Preferences must resolve for the shell to unblock; contents don't matter here.
  await page.route('**/prefs/api/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ preferences: {} })
    })
  )

  // The board sync — held open long enough to click a board while it's in flight.
  await page.route('**/task/api/boards**', async route => {
    await new Promise(resolve => setTimeout(resolve, SYNC_DELAY_MS))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(boardsPayload())
    })
  })
}

test.describe('Board switch during initial load', () => {
  test('keeps the clicked board’s tasks when the background sync lands', async ({ page }) => {
    await seedCachedSession(page)
    await stubApi(page)

    let boardsResolved = false
    page.on('response', res => {
      if (res.url().includes('/task/api/boards')) boardsResolved = true
    })

    await page.goto('/')

    // Boards paint from cache while the sync is still in flight.
    const workBoard = page.locator('button.board-btn', { hasText: 'work' })
    await workBoard.waitFor({ state: 'visible', timeout: 15000 })
    expect(
      boardsResolved,
      'sync should still be in flight — the race window has closed, test is not exercising the bug'
    ).toBe(false)

    // Switch boards mid-flight.
    await workBoard.click()
    await expect(page.locator('.task-app__item-title')).toHaveText(WORK_TASK)

    // Now let the background sync land and overwrite state.
    await expect.poll(() => boardsResolved, { timeout: 15000 }).toBe(true)
    await page.waitForTimeout(500) // let the resulting setState flush

    // The clicked board must still be selected AND showing its own tasks.
    await expect(workBoard).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.task-app__item-title')).toHaveText(WORK_TASK)
    await expect(page.locator('.task-app__item-title', { hasText: MAIN_TASK })).toHaveCount(0)
  })
})
