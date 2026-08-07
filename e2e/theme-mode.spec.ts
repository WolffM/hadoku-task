import { test, expect, type Page } from '@playwright/test'
import { prefsUp, pointPrefsAtLocalStack } from './helpers/prefs'

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
// The local stack's edge-router shim resolves /session/whoami to the dev user
// it stamps on every request, so this is the real resolved identity rather
// than a mock's idea of one.
const DEV_USER_ID = 'dev-uid'
const TASK_CACHE_KEY = `prefs-cache:${DEV_USER_ID}:task`
const SHARED_CACHE_KEY = `prefs-cache:${DEV_USER_ID}:portfolio`

/** Read a prefs-client cache envelope's blob from localStorage. */
function readSdkCacheBlob(
  page: Page,
  key = TASK_CACHE_KEY
): Promise<Record<string, unknown> | null> {
  return page.evaluate(k => {
    const raw = window.localStorage.getItem(k)
    return raw ? (JSON.parse(raw).blob as Record<string, unknown>) : null
  }, key)
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

  // No prefs routing here on purpose. Both rows and /session/whoami are served
  // by the REAL prefs-api worker on :3003 (scripts/dev-api.mjs), against a real
  // sqlite D1 — see helpers/prefs.ts for why the mocks were removed and what
  // they were hiding.
  await pointPrefsAtLocalStack(page)
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
  test.beforeEach(async ({ page, request }) => {
    // Prefs are served by the real worker now, so these specs need the local
    // stack up — same contract as every other server-backed spec here.
    test.skip(
      !(await prefsUp(request)),
      'prefs stack not running (node scripts/dev-api.mjs, needs ../hadoku_site)'
    )
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

  test('a theme stranded in the task row migrates to the shared row and renders', async ({
    page
  }) => {
    // Regression: useThemePrefsMigration bailed whenever the shared row read
    // back as null, on the belief that null meant "not resolved yet". It does
    // not — usePrefs clears `loading` when the read settles and leaves `prefs`
    // null when the row is EMPTY. So the migration was disabled for exactly
    // the people it exists for: anyone whose only hadoku app is this one has
    // no shared row, so their theme stayed stranded in the task row and the
    // app opened on the default forever.
    await seedPublicSession(page, {
      version: 1,
      updatedAt: new Date().toISOString(),
      theme: 'coffee-dark'
    })

    await page.goto('/')
    await waitForApp(page)

    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')), {
        timeout: 10000
      })
      .toBe('coffee-dark')

    // And it landed in the SHARED row, so every other hadoku app sees it too —
    // not just re-read from the task row this app is migrating away from.
    await expect
      .poll(async () => (await readSdkCacheBlob(page, SHARED_CACHE_KEY))?.theme ?? null, {
        timeout: 10000
      })
      .toBe('coffee-dark')
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
