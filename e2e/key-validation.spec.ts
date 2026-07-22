import { test, expect, type Page } from '@playwright/test'
import { KEY_SUBMIT_LABEL } from './helpers/settings'

/**
 * E2E tests for the key-swap and session management flow.
 *
 * Key entry now lives in the shared ConnectedSettings popout (the gear button in
 * the AppHeader), not the old task-local SettingsModal. The flow is:
 *   1. User opens the gear ("User settings") → ConnectedSettings popout.
 *   2. Clicks "Change key…" → a password field appears.
 *   3. Types the new key, clicks the submit button (see KEY_SUBMIT_LABEL).
 *   4. ConnectedSettings POSTs the key (X-User-Key) to /session/create and, on
 *      { valid:true, sessionId, userType, name }, writes hadoku_session_id +
 *      hadoku_user_type to localStorage and calls window.location.reload().
 *   5. On failure it renders .settings-popout__error and does NOT reload.
 * The app still persists the session across reloads and still handshakes the
 * server for expiry detection — those paths are unchanged by the header
 * convergence.
 */

const APP_HEADER = 'h1.app-header__title'

/** Open the shared settings popout via the header gear. */
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'User settings' }).click()
  await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })
}

/** Reveal the key field, type a key, and submit the swap. */
async function swapKey(page: Page, key: string) {
  await page.getByRole('button', { name: /change key/i }).click()

  const keyInput = page.locator('.settings-popout__input[placeholder="New access key"]')
  await keyInput.waitFor({ state: 'visible', timeout: 5000 })
  await keyInput.fill(key)

  await page.getByRole('button', { name: KEY_SUBMIT_LABEL }).click()
}

/** Mock the whoami identity ConnectedSettings GETs when the popout opens. */
async function mockWhoami(page: Page, identity: { userType: string; name: string | null }) {
  await page.route('**/session/whoami', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, ...identity })
    })
  })
}

test.describe('Key Validation Flow', () => {
  // Note: We don't use addInitScript to clear localStorage because it runs
  // on every navigation including reloads, which would clear the session
  // data stored by the swap flow before the reload completes.

  test('should start as public user with no stored session', async ({ page }) => {
    // Clear localStorage on initial load only
    await page.addInitScript(() => localStorage.clear())
    await page.goto('/')

    // Wait for app to load by checking for the header
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    // Check localStorage - either no session or a public session was generated
    const sessionId = await page.evaluate(() => localStorage.getItem('hadoku_session_id'))
    const userType = await page.evaluate(() => localStorage.getItem('hadoku_user_type'))

    // Either no session, or a public session was generated
    if (sessionId) {
      expect(sessionId).toMatch(/^public-/)
    }
    expect(userType).toBeNull()
  })

  test('should swap key and create session', async ({ page }) => {
    await mockWhoami(page, { userType: 'public', name: null })

    // The swap POSTs the new key to /session/create with an X-User-Key header.
    await page.route('**/session/create', async route => {
      const key = route.request().headers()['x-user-key']
      if (key === 'test-valid-key') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            valid: true,
            sessionId: 'test-session-123',
            userType: 'friend',
            name: null
          })
        })
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ valid: false })
        })
      }
    })

    // Navigate and clear localStorage manually (not with addInitScript to avoid clearing on reload)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    // Open the gear and swap the key - this triggers window.location.reload()
    await openSettings(page)
    await swapKey(page, 'test-valid-key')

    // Wait for the reload the swap triggers on success
    await page.waitForEvent('load', { timeout: 15000 })
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    // Verify the session mirror was written before the reload
    const sessionId = await page.evaluate(() => localStorage.getItem('hadoku_session_id'))
    const userType = await page.evaluate(() => localStorage.getItem('hadoku_user_type'))

    expect(sessionId).toBe('test-session-123')
    expect(userType).toBe('friend')
  })

  test('should persist session across page reloads', async ({ page }) => {
    // Pre-populate localStorage with session data
    await page.addInitScript(() => {
      localStorage.setItem('hadoku_session_id', 'persisted-session-456')
      localStorage.setItem('hadoku_user_type', 'admin')
    })

    // Mock the session handshake endpoint (still owned by the app)
    await page.route('**/task/api/session/handshake', async route => {
      const request = route.request()
      const headers = request.headers()

      expect(headers['x-session-id']).toBe('persisted-session-456')
      expect(headers['x-user-type']).toBe('admin')

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          preferences: {
            version: 1,
            updatedAt: new Date().toISOString(),
            theme: 'dark'
          }
        })
      })
    })

    // Mock the boards API
    await page.route('**/task/api/boards*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          boards: [
            {
              id: 'main',
              name: 'Main',
              tasks: [],
              tags: []
            }
          ]
        })
      })
    })

    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    // Wait for the handshake to complete
    await page.waitForTimeout(2000)

    // Verify session data persists
    const sessionId = await page.evaluate(() => localStorage.getItem('hadoku_session_id'))
    const userType = await page.evaluate(() => localStorage.getItem('hadoku_user_type'))

    expect(sessionId).toBe('persisted-session-456')
    expect(userType).toBe('admin')

    // Reload and verify again
    await page.reload()
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    const sessionIdAfterReload = await page.evaluate(() =>
      localStorage.getItem('hadoku_session_id')
    )
    const userTypeAfterReload = await page.evaluate(() => localStorage.getItem('hadoku_user_type'))

    expect(sessionIdAfterReload).toBe('persisted-session-456')
    expect(userTypeAfterReload).toBe('admin')
  })

  test('should store the new session when switching accounts', async ({ page }) => {
    // The old task-local flow cleared other-account localStorage on switch; the
    // shared ConnectedSettings swap only rewrites the session mirror
    // (hadoku_session_id + hadoku_user_type) and reloads. This asserts the swap
    // overwrites an existing session with the new account's identity.
    await mockWhoami(page, { userType: 'friend', name: null })

    await page.route('**/session/create', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          valid: true,
          sessionId: 'new-session-222',
          userType: 'admin',
          name: null
        })
      })
    })

    // Content level is fetched for friend/admin on popout open — keep it hermetic.
    await page.route('**/prefs/api/v1/content-level', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ level: 1, maxLevel: 3 })
      })
    })

    // Navigate first, then set up localStorage manually
    await page.goto('/')

    // Pre-populate localStorage with an existing (friend) session
    await page.evaluate(() => {
      localStorage.setItem('hadoku_session_id', 'old-session-111')
      localStorage.setItem('hadoku_user_type', 'friend')
    })

    // Reload to pick up the pre-populated session
    await page.reload()
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    // Open the gear and swap to the new account key - triggers a reload
    await openSettings(page)
    await swapKey(page, 'new-account-key')

    await page.waitForEvent('load', { timeout: 15000 })
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    // Verify the new session replaced the old one
    const sessionId = await page.evaluate(() => localStorage.getItem('hadoku_session_id'))
    const userType = await page.evaluate(() => localStorage.getItem('hadoku_user_type'))

    expect(sessionId).toBe('new-session-222')
    expect(userType).toBe('admin')
  })

  test('should handle an invalid key gracefully', async ({ page }) => {
    await mockWhoami(page, { userType: 'public', name: null })

    // Server rejects the key: 200 with valid:false → swap fails, no reload.
    await page.route('**/session/create', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: false })
      })
    })

    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    await openSettings(page)
    await swapKey(page, 'invalid-key')

    // Error renders in the popout; the popout stays open (no reload).
    const errorMessage = page.locator('.settings-popout__error')
    await expect(errorMessage).toBeVisible({ timeout: 5000 })

    // Session should NOT be created
    const sessionId = await page.evaluate(() => localStorage.getItem('hadoku_session_id'))
    if (sessionId) {
      expect(sessionId).not.toBe('new-session-222')
      expect(sessionId).toMatch(/^public-/)
    }
  })

  test('should handle a session creation failure gracefully', async ({ page }) => {
    await mockWhoami(page, { userType: 'public', name: null })

    // Server error (non-ok) → swap fails, error shown, no reload.
    await page.route('**/session/create', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server error' })
      })
    })

    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    await openSettings(page)
    await swapKey(page, 'valid-key-but-server-fails')

    await expect(page.locator('.settings-popout__error')).toBeVisible({ timeout: 5000 })

    // Session should NOT be updated
    const sessionId = await page.evaluate(() => localStorage.getItem('hadoku_session_id'))
    if (sessionId) {
      expect(sessionId).toMatch(/^public-/)
    }
  })

  test('should handle session expiration gracefully', async ({ page }) => {
    // Mock the handshake endpoint BEFORE navigation
    await page.route('**/task/api/session/handshake', async route => {
      // Server returns 'public' (simulating expired session)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sessionId: 'expired-session-789',
          userType: 'public', // Session expired - server disagrees with client
          migrated: false,
          preferences: null
        })
      })
    })

    // Mock the boards API
    await page.route('**/task/api/boards*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          boards: []
        })
      })
    })

    // Use addInitScript that only sets localStorage if not already set to 'public'
    // This allows the test to set up 'friend' initially, but after our code
    // updates to 'public' and reloads, that value persists
    await page.addInitScript(() => {
      const hadoku_user_type = localStorage.getItem('hadoku_user_type')
      // Only set up 'friend' session if not already set to 'public' (post-expiration)
      if (hadoku_user_type !== 'public') {
        localStorage.setItem('hadoku_session_id', 'expired-session-789')
        localStorage.setItem('hadoku_user_type', 'friend')
      }
    })

    // Navigate - app will mount with userType='friend' from localStorage
    await page.goto('/')

    // Wait for the session expiration handling to complete and page to reload
    // The flow is: detect mismatch -> show toast -> wait 1.5s -> reload
    // After reload, the app should initialize as 'public' user
    await page.waitForTimeout(3000)

    // Verify localStorage was updated to 'public' after session expiration handling
    const userType = await page.evaluate(() => localStorage.getItem('hadoku_user_type'))
    expect(userType).toBe('public')

    // Verify the app eventually loads (after the reload with correct userType)
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })
  })
})
