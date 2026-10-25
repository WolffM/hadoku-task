import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for switching keys and for session persistence.
 *
 * The settings popout (shared ConnectedSettings, the gear in the AppHeader)
 * does not take a key. Only the site's /auth page may create a session — it
 * carries the edge-signed funnel token and the device fingerprint that
 * /session/create requires — so "Switch key" is a link to
 * /auth?switch=1&return=<this page>, and /auth brings the user back with the
 * new session cookie. The app still persists the session across reloads and
 * still handshakes the server for expiry detection.
 */

const APP_HEADER = 'h1.app-header__title'

/** Open the shared settings popout via the header gear. */
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'User settings' }).click()
  await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })
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

  test('Switch key links to /auth and round-trips the path, query and hash', async ({ page }) => {
    // Public, so the popout fetches no content level and the spec stays hermetic.
    await mockWhoami(page, { userType: 'public', name: null })
    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    // A page address with every part /auth has to hand back, including
    // characters that must survive encoding.
    const here = '/board/two%20words?view=calendar&sort=a+b#lane-3'
    await page.evaluate(url => window.history.replaceState(null, '', url), here)

    await openSettings(page)
    const link = page.getByRole('link', { name: 'Switch key' })
    await expect(link).toBeVisible()

    const href = await link.getAttribute('href')
    expect(href).toBe('/auth?switch=1&return=' + encodeURIComponent(here))
    const url = new URL(href ?? '', 'https://hadoku.me')
    expect(url.pathname).toBe('/auth')
    expect(url.searchParams.get('switch')).toBe('1')
    expect(url.searchParams.get('return')).toBe(here)

    // The key is never typed into an app: the panel has no key field at all.
    await expect(page.locator('.settings-popout__panel input[type="password"]')).toHaveCount(0)
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
