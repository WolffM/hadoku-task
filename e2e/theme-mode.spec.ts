import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the Simple/Advanced theme mode system shipped from
 * @wolffm/themes. Verifies that:
 *
 *   1. data-theme-mode='advanced' is the default attribute on documentElement
 *   2. .hdk-advanced-page is on the task container so the gradient renders
 *   3. The Simple/Advanced toggle is visible only when the active theme has
 *      an advanced visual contract (light, cyberpunk-dark) and hidden
 *      otherwise (e.g. coffee-light)
 *   4. Clicking the toggle flips data-theme-mode and persists to the
 *      prefs-client cache (unified prefs store)
 *   5. Legacy `simpleMode` saved preferences are migrated to `themeMode`
 *      on first load and the legacy localStorage key is dropped
 */

const PUBLIC_USER_TYPE = 'public'
const PUBLIC_SESSION_ID = 'public-test-session'
const PREFS_KEY = `${PUBLIC_USER_TYPE}-${PUBLIC_SESSION_ID}-preferences`
// @wolffm/prefs-client optimistic cache: `prefs-cache:{userId}:{appId}`.
// The mocked whoami below resolves the anon user, so the key is stable.
const SDK_CACHE_KEY = 'prefs-cache:anon:task'

/** Read the prefs-client cache envelope's blob from localStorage. */
function readSdkCacheBlob(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(key => {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw).blob as Record<string, unknown>) : null
  }, SDK_CACHE_KEY)
}

async function setupRoutes(page: Page) {
  await page.route('**/task/api/session/handshake', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ preferences: null })
    })
  })

  await page.route('**/task/api/boards*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        boards: [{ id: 'main', name: 'Main', tasks: [], tags: [] }]
      })
    })
  })

  // Hermetic prefs backend for the @wolffm/prefs-client SDK — without it the
  // tests depend on real hadoku.me network behavior (a successful GET after a
  // debounced PUT would clobber the optimistic cache with live server state).
  // The endpoints are cross-origin from the vite dev server, so every fulfill
  // needs CORS headers and the PUT preflight must be answered.
  const corsHeaders = (origin: string) => ({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Key, X-Device-Id',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS'
  })

  await page.route('**/session/whoami', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders(route.request().headers()['origin'] ?? '*'),
      body: JSON.stringify({ userId: 'anon', userType: 'public' })
    })
  })

  // PUTs are accepted (writes flush cleanly); GETs return 404 so the SDK's
  // background refresh keeps the optimistic localStorage cache authoritative.
  // A 200 GET would clobber not-yet-flushed patches from the other save scope
  // (the SDK overwrites its optimistic state with the server's merged blob
  // while patches are still debounce-pending) — asserting on the optimistic
  // cache matches what the app actually renders from.
  const versions = { user: 0, device: 0 }
  await page.route('**/prefs/api/v1/task', async route => {
    const request = route.request()
    const headers = corsHeaders(request.headers()['origin'] ?? '*')
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    if (request.method() === 'PUT') {
      const { scope } = request.postDataJSON() as { scope: 'user' | 'device' }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify({ scope, version: ++versions[scope] })
      })
      return
    }
    await route.fulfill({ status: 404, headers })
  })
}

async function seedPublicSession(page: Page, prefs: Record<string, unknown> | null): Promise<void> {
  const prefsJson = prefs ? JSON.stringify(prefs) : null
  await page.addInitScript(
    ({ userType, sessionId, prefsKey, prefsJson }) => {
      window.localStorage.setItem('currentUserType', userType)
      window.localStorage.setItem('currentSessionId', sessionId)
      if (prefsJson !== null) {
        window.localStorage.setItem(prefsKey, prefsJson)
      }
    },
    {
      userType: PUBLIC_USER_TYPE,
      sessionId: PUBLIC_SESSION_ID,
      prefsKey: PREFS_KEY,
      prefsJson
    }
  )
}

async function waitForApp(page: Page) {
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
  // The data-theme-mode attribute is applied in a useEffect after the
  // preferences load, so wait for it explicitly rather than racing with paint.
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-theme-mode') !== null,
    null,
    { timeout: 10000 }
  )
}

test.describe('Theme Mode', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page)
  })

  test('default themeMode is simple on first load (light theme)', async ({ page }) => {
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'light'
    })

    await page.goto('/')
    await waitForApp(page)

    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-theme-mode'))
    expect(mode).toBe('simple')
  })

  test('hdk-advanced-page class is applied to the task container', async ({ page }) => {
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'light'
    })

    await page.goto('/')
    await waitForApp(page)

    await expect(page.locator('.task-app-container.hdk-advanced-page')).toBeVisible()
  })

  test('mode toggle is visible on light theme', async ({ page }) => {
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'light'
    })

    await page.goto('/')
    await waitForApp(page)

    await page.locator('.theme-toggle-btn').click()
    await expect(page.locator('.theme-picker__mode-toggle')).toBeVisible()

    const buttons = page.locator('.theme-picker__mode-btn')
    await expect(buttons).toHaveCount(2)
    await expect(buttons.nth(0)).toHaveText('Simple')
    await expect(buttons.nth(1)).toHaveText('Advanced')
    // Simple is the default when no themeMode pref is saved
    await expect(buttons.nth(0)).toHaveClass(/active/)
  })

  test('mode toggle is hidden on a theme without an advanced contract', async ({ page }) => {
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'coffee-light'
    })

    await page.goto('/')
    await waitForApp(page)

    await page.locator('.theme-toggle-btn').click()
    await expect(page.locator('.theme-picker__dropdown')).toBeVisible()
    await expect(page.locator('.theme-picker__mode-toggle')).toHaveCount(0)
  })

  test('--advanced-gradient does not leak from light into other themes', async ({ page }) => {
    // Regression: previously the light gradient was declared in
    // `:root, [data-theme='light']` which cascaded to every element,
    // so a user on (e.g.) coffee-light with themeMode='advanced'
    // would see the light theme's beach-day gradient. The advanced
    // contract is now scoped to [data-theme='light'] only.
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'coffee-light',
      themeMode: 'advanced'
    })

    await page.goto('/')
    await waitForApp(page)

    // Custom property should be unset on a non-advanced theme
    const gradient = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--advanced-gradient').trim()
    )
    expect(gradient).toBe('')

    // And on the actual surface element the kit applies to — confirm
    // the rendered background falls back to the flat color, no
    // linear-gradient leaks through.
    const surfaceBg = await page.evaluate(() => {
      const el = document.querySelector('.task-app-container.hdk-advanced-page')
      return el ? getComputedStyle(el).backgroundImage : null
    })
    expect(surfaceBg).not.toMatch(/linear-gradient/)
  })

  test('mode toggle is visible on cyberpunk-dark', async ({ page }) => {
    // cyberpunk is experimental — must be enabled or the theme falls back
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'cyberpunk-dark',
      experimentalThemes: true
    })

    await page.goto('/')
    await waitForApp(page)

    await page.locator('.theme-toggle-btn').click()
    await expect(page.locator('.theme-picker__mode-toggle')).toBeVisible()
    // Simple is the default when no themeMode pref is saved
    await expect(page.locator('.theme-picker__mode-btn').nth(0)).toHaveClass(/active/)
  })

  test('clicking Advanced flips data-theme-mode and persists to the prefs cache', async ({
    page
  }) => {
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'light'
    })

    await page.goto('/')
    await waitForApp(page)

    expect(
      await page.evaluate(() => document.documentElement.getAttribute('data-theme-mode'))
    ).toBe('simple')

    await page.locator('.theme-toggle-btn').click()
    await page.locator('.theme-picker__mode-btn').filter({ hasText: 'Advanced' }).click()

    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-mode')))
      .toBe('advanced')

    // Persistence: the prefs-client cache (unified store) should now have
    // themeMode='advanced' — the legacy PREFS_KEY blob is gone post-migration.
    await expect
      .poll(async () => (await readSdkCacheBlob(page))?.themeMode ?? null)
      .toBe('advanced')
  })

  test('legacy simpleMode=true is migrated to themeMode=simple on load', async ({ page }) => {
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'light',
      // Old key shape — should be migrated and removed
      simpleMode: true
    })

    await page.goto('/')
    await waitForApp(page)

    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-mode')))
      .toBe('simple')

    // Migration outcome: the legacy localStorage blob is removed and the
    // unified store's cache carries themeMode with the simpleMode key dropped.
    await expect
      .poll(() => page.evaluate(key => window.localStorage.getItem(key), PREFS_KEY))
      .toBeNull()

    // Poll past the SDK's 1s save debounce + post-flush refresh.
    await expect
      .poll(async () => (await readSdkCacheBlob(page))?.themeMode ?? null, { timeout: 10000 })
      .toBe('simple')
    expect('simpleMode' in ((await readSdkCacheBlob(page)) ?? {})).toBe(false)
  })

  test('legacy simpleMode=false migrates to themeMode=advanced', async ({ page }) => {
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'light',
      simpleMode: false
    })

    await page.goto('/')
    await waitForApp(page)

    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-mode')))
      .toBe('advanced')

    await expect
      .poll(() => page.evaluate(key => window.localStorage.getItem(key), PREFS_KEY))
      .toBeNull()

    await expect
      .poll(async () => (await readSdkCacheBlob(page))?.themeMode ?? null, { timeout: 10000 })
      .toBe('advanced')
    expect('simpleMode' in ((await readSdkCacheBlob(page)) ?? {})).toBe(false)
  })
})
