import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for switching keys and for session persistence.
 *
 * The settings popout (shared ConnectedSettings, the gear in the AppHeader)
 * does not take a key. Only the site's /auth page may create a session — it
 * carries the edge-signed funnel token and the device fingerprint that
 * /session/create requires — so "Switch key" is a link to
 * /auth?switch=1&return=<this page>, and /auth brings the user back with the
 * new session cookie. The host owns the session: the app reads what it stored,
 * never rewrites it, and sends no session handshake of its own.
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

    // A public user keys local data by the app's own anon id. The host-owned
    // session keys stay untouched — the app never writes them.
    const stored = await page.evaluate(() => ({
      anon: localStorage.getItem('task_anon_session_id'),
      session: localStorage.getItem('hadoku_session_id'),
      userType: localStorage.getItem('hadoku_user_type')
    }))
    expect(stored.anon).toMatch(/^public-/)
    expect(stored.session).toBeNull()
    expect(stored.userType).toBeNull()
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

    const handshakes: string[] = []
    page.on('request', r => {
      if (r.url().includes('/session/handshake')) handshakes.push(r.url())
    })
    const boardHeaders: Record<string, string>[] = []
    page.on('request', r => {
      if (r.url().includes('/task/api/boards')) boardHeaders.push(r.headers())
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

    // The board sync is the app's identity-bearing call: the session id rides
    // along for the edge, the retired X-User-Type does not.
    await expect.poll(() => boardHeaders.length).toBeGreaterThan(0)
    expect(boardHeaders[0]['x-session-id']).toBe('persisted-session-456')
    expect(boardHeaders[0]['x-user-type']).toBeUndefined()

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

    expect(handshakes, 'the app sends no session handshake').toEqual([])
  })
})
