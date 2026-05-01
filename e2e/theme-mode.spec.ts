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
 *   4. Clicking the toggle flips data-theme-mode and persists across reload
 *   5. Legacy `simpleMode: true` saved preferences are migrated to
 *      `themeMode: 'simple'` on first load and the legacy key is dropped
 */

const PUBLIC_USER_TYPE = 'public'
const PUBLIC_SESSION_ID = 'public-test-session'
const PREFS_KEY = `${PUBLIC_USER_TYPE}-${PUBLIC_SESSION_ID}-preferences`

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
  await page.waitForSelector('h1.task-app__header', { timeout: 15000 })
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

  test('clicking Advanced flips data-theme-mode and persists to localStorage', async ({ page }) => {
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

    // Persistence: the public-user prefs key in localStorage should now have themeMode='advanced'
    await expect
      .poll(() =>
        page.evaluate(key => {
          const raw = window.localStorage.getItem(key)
          return raw ? (JSON.parse(raw).themeMode as string) : null
        }, PREFS_KEY)
      )
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

    const stored = await page.evaluate(key => {
      const raw = window.localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    }, PREFS_KEY)

    expect(stored).not.toBeNull()
    expect(stored.themeMode).toBe('simple')
    expect('simpleMode' in stored).toBe(false)
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

    const stored = await page.evaluate(key => {
      const raw = window.localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    }, PREFS_KEY)

    expect(stored.themeMode).toBe('advanced')
    expect('simpleMode' in stored).toBe(false)
  })
})
