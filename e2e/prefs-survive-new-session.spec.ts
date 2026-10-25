import { test, expect, type Page } from '@playwright/test'
import { apiUp } from './helpers/stack'
import {
  prefsUp,
  pointPrefsAtLocalStack,
  seedDevicePrefs,
  readTaskPrefsCache
} from './helpers/prefs'

/**
 * A new session must leave the user's saved prefs alone.
 *
 * Loading prefs used to run a one-shot "legacy migration" first, flagged per
 * sessionId. edge-router mints a sessionId on every sign-in, so every new
 * session re-ran it: it fetched the retired /task/api/preferences route, which
 * always answered 200 — with DEFAULTS when it held nothing — and saved that
 * over the real prefs. Theme included. Loading now never writes.
 *
 * The task worker on :3001 is the real one, so on the old code the legacy
 * route really answers and the overwrite really happens.
 */

// `theme` is the field the bug clobbered: of what the legacy route's blob
// carried, only device fields were saved forward, and theme is the one it had.
const SAVED = { theme: 'coffee-dark', showDeleteButton: false, showTagButton: true }

/** Sign in as a friend under `sessionId`, the way the host page leaves it. */
async function signInAs(page: Page, sessionId: string): Promise<void> {
  await page.addInitScript(id => {
    localStorage.setItem('hadoku_session_id', id)
    localStorage.setItem('hadoku_user_type', 'friend')
  }, sessionId)
}

test.describe('Saved prefs across sessions', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiUp(request)), 'API stack not running (pnpm run dev:api)')
    test.skip(!(await prefsUp(request)), 'prefs stack not running (pnpm run dev:api)')
  })

  test('a second session leaves the saved prefs alone', async ({ page }) => {
    const legacyCalls: string[] = []
    const taskRowWrites: string[] = []
    page.on('request', r => {
      if (r.url().includes('/task/api/preferences')) legacyCalls.push(r.url())
      // The SDK's debounced PUT. (The shared `portfolio` row legitimately takes
      // the theme once — useThemePrefsMigration — and is a different row.)
      if (r.method() === 'PUT' && r.url().includes('/prefs/api/v1/task')) {
        taskRowWrites.push(r.url())
      }
    })

    await pointPrefsAtLocalStack(page)
    await seedDevicePrefs(page, SAVED)
    await signInAs(page, 'session-one')
    await page.goto('/')
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })

    // A fresh sign-in on the same device: new sessionId, same saved prefs.
    // (Registered later, so it wins over session-one on the reload.)
    await signInAs(page, 'session-two')
    await page.reload()
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })

    // Outlast the SDK's 1 s save debounce, so a load-time write has landed.
    await page.waitForTimeout(2500)

    expect.soft(legacyCalls, 'nothing calls the retired legacy prefs route').toEqual([])
    expect.soft(taskRowWrites, 'loading prefs must not write them').toEqual([])
    expect(await readTaskPrefsCache(page), 'the saved prefs are untouched').toMatchObject(SAVED)

    // And the app is rendering from them: the Delete chip reflects the row.
    await page.locator('.settings-toggle-btn').click()
    await expect(
      page.locator('.settings-toggle-chip').filter({ hasText: 'Delete' }).locator('input')
    ).not.toBeChecked()
  })
})
