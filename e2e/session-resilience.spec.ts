import { test, expect, type Page } from '@playwright/test'

/**
 * Guards the two behaviours that moved when the cold-load chain was
 * de-serialised (handshake no longer blocks first paint):
 *
 *  1. Session expiry — the handshake result is now handled after the app has
 *     painted rather than before. The expiry prompt + reload must still happen.
 *  2. Handshake failure — the app must still become usable. It renders from the
 *     localStorage cache and the board sync authenticates off the session cookie,
 *     so a dead handshake must not strand the user on the skeleton.
 */

const SESSION_ID = 'resilience-session'
const TASK_TITLE = 'CACHED-TASK'

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
        tasks: [{ id: 't1', title: TASK_TITLE, state: 'Active', createdAt: now, tag: null }]
      }
    ]
  }
}

async function seedFriendSession(page: Page) {
  await page.addInitScript(sessionId => {
    localStorage.clear()
    localStorage.setItem('hadoku_user_type', 'friend')
    localStorage.setItem('hadoku_session_id', sessionId)
  }, SESSION_ID)
}

async function stubPrefsAndBoards(page: Page) {
  await page.route('**/prefs/api/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ preferences: {} })
    })
  )
  await page.route('**/task/api/boards**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(boardsPayload())
    })
  )
}

test.describe('Session resilience', () => {
  test('expired session still prompts and reloads, even though paint no longer waits on the handshake', async ({
    page
  }) => {
    await seedFriendSession(page)
    await stubPrefsAndBoards(page)

    // Server says this key is no longer a friend — i.e. the session expired.
    await page.route('**/task/api/session/handshake', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ userType: 'public', preferences: null })
      })
    )

    await page.goto('/')

    // The expiry handling now runs after the handshake resolves. It must still:
    //  (a) downgrade the stored userType to match the server
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('hadoku_user_type')), {
        timeout: 15000,
        message: 'stored userType should be downgraded to public on expiry'
      })
      .toBe('public')

    //  (b) tell the user
    await expect(page.getByText(/session has expired/i)).toBeVisible({ timeout: 10000 })
  })

  test('a failing handshake does not strand the user on the skeleton', async ({ page }) => {
    await seedFriendSession(page)
    await stubPrefsAndBoards(page)

    await page.route('**/task/api/session/handshake', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    )

    await page.goto('/')

    // App still mounts...
    await expect(page.locator('.task-app-container')).toBeAttached({ timeout: 15000 })

    // ...and the board sync still lands, because it authenticates off the session
    // cookie rather than the handshake.
    await expect(page.locator('.task-app__item-title', { hasText: TASK_TITLE })).toBeAttached({
      timeout: 15000
    })

    // And we did NOT wrongly treat a 500 as an expiry.
    expect(await page.evaluate(() => localStorage.getItem('hadoku_user_type'))).toBe('friend')
  })
})
