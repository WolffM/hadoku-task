import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the theme mode attribute shipped from @wolffm/themes.
 *
 * Advanced visuals are switched off platform-wide: the Simple/Advanced toggle
 * is gone from the picker and `useTheme` pins data-theme-mode='simple' on
 * every theme apply. The advanced kit (advanced.css, the hdk-advanced-*
 * class hooks) still ships and still keys off the attribute, so these tests
 * guard that nothing can turn it back on by accident. Verifies that:
 *
 *   1. data-theme-mode is 'simple' on documentElement, on every theme
 *   2. .hdk-advanced-page is still on the task container, rendering flat
 *   3. The picker exposes NO mode toggle
 *   4. A previously persisted themeMode='advanced' does not resurrect the
 *      advanced visuals
 *   5. Legacy `simpleMode` saved preferences are still migrated to `themeMode`
 *      on first load and the legacy localStorage key is dropped — the value is
 *      recorded but no longer drives rendering
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

/**
 * Seed a public session whose legacy prefs blob the app will actually find.
 *
 * A public user's sessionId comes from `task_anon_session_id`, NOT
 * `hadoku_session_id` — the host page's mf-loader owns the latter and wipes it
 * on every boot for a public user (see `src/api/session.ts`). Seeding the wrong
 * key doesn't fail loudly: the app just mints a fresh anon id, so the legacy
 * prefs key never matches, no preference is read, and every assertion here
 * silently tests the DEFAULT theme instead of the one under test.
 */
async function seedPublicSession(page: Page, prefs: Record<string, unknown> | null): Promise<void> {
  const prefsJson = prefs ? JSON.stringify(prefs) : null
  await page.addInitScript(
    ({ userType, sessionId, prefsKey, prefsJson }) => {
      window.localStorage.setItem('hadoku_user_type', userType)
      window.localStorage.setItem('task_anon_session_id', sessionId)
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

  test('the picker has no mode toggle, even on a theme with an advanced contract', async ({
    page
  }) => {
    // `light` is one of the two themes that ship an advanced contract (see
    // THEME_EFFECTS), so it is where a toggle would show up if one survived.
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'light'
    })

    await page.goto('/')
    await waitForApp(page)

    await page.locator('.theme-toggle-btn').click()
    await expect(page.locator('.theme-picker__dropdown')).toBeVisible()
    await expect(page.locator('.theme-picker__mode-toggle')).toHaveCount(0)
    await expect(page.locator('.theme-picker__mode-btn')).toHaveCount(0)
  })

  test('--advanced-gradient does not leak from light into other themes', async ({ page }) => {
    // Regression: previously the light gradient was declared in
    // `:root, [data-theme='light']` which cascaded to every element,
    // so a user on (e.g.) coffee-light with themeMode='advanced'
    // would see the light theme's beach-day gradient. The advanced
    // contract is now scoped to [data-theme='light'] only. The mode
    // seeded below is inert now, but the token scoping this guards is
    // what would break first if the advanced kit is ever switched back on.
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

  test('a persisted themeMode=advanced does not resurrect the advanced visuals', async ({
    page
  }) => {
    // Someone who used the toggle before it was removed still has
    // themeMode='advanced' in their prefs row. It must not render.
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'light',
      themeMode: 'advanced'
    })

    await page.goto('/')
    await waitForApp(page)

    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-mode')))
      .toBe('simple')

    // The page surface falls back to the flat color, not the light theme's
    // beach-day gradient.
    const surfaceBg = await page.evaluate(() => {
      const el = document.querySelector('.task-app-container.hdk-advanced-page')
      return el ? getComputedStyle(el).backgroundImage : null
    })
    expect(surfaceBg).not.toMatch(/linear-gradient/)
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

  test('legacy simpleMode=false migrates to themeMode=advanced but still renders simple', async ({
    page
  }) => {
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'light',
      simpleMode: false
    })

    await page.goto('/')
    await waitForApp(page)

    // The migration still records the old value; rendering ignores it.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-mode')))
      .toBe('simple')

    await expect
      .poll(() => page.evaluate(key => window.localStorage.getItem(key), PREFS_KEY))
      .toBeNull()

    await expect
      .poll(async () => (await readSdkCacheBlob(page))?.themeMode ?? null, { timeout: 10000 })
      .toBe('advanced')
    expect('simpleMode' in ((await readSdkCacheBlob(page)) ?? {})).toBe(false)
  })
})
