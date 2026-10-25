import { test, expect, type Page } from '@playwright/test'

/**
 * A failing prefs backend must not strand the user on the skeleton.
 *
 * The shell reveals once prefs settle, and the prefs SDK's first call is the
 * /session/whoami identity lookup. If that lookup fails, the SDK must fall back
 * to defaults and the app must still mount and show the board — the board sync
 * authenticates off the session cookie at the edge, not off prefs.
 *
 * (Session expiry is no longer the app's to detect: the host page re-resolves
 * whoami on every boot and mounts the app with the tier it got.)
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
  test('a failing prefs identity lookup does not strand the user on the skeleton', async ({
    page
  }) => {
    await seedFriendSession(page)
    await stubPrefsAndBoards(page)

    await page.route('**/session/whoami', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    )

    await page.goto('/')

    // App still mounts...
    await expect(page.locator('.task-app-container')).toBeAttached({ timeout: 15000 })

    // ...and the board sync still lands.
    await expect(page.locator('.task-app__item-title', { hasText: TASK_TITLE })).toBeAttached({
      timeout: 15000
    })

    // And the signed-in tier is left alone: the app never rewrites it.
    expect(await page.evaluate(() => localStorage.getItem('hadoku_user_type'))).toBe('friend')
  })
})
