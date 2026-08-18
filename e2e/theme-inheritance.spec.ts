import { test, expect, type Page } from '@playwright/test'
import { mockShellApi } from './helpers/mock-api'

/**
 * E2E tests for the hadoku.me theme-integration contract.
 *
 * The host page persists the current theme in sessionStorage['hadoku-theme']
 * and pushes changes into the embedded app by setting data-theme and
 * dispatching a synthetic StorageEvent for that key. Verifies that:
 *
 * 1. A fully-qualified inherited theme (e.g. 'ocean-dark') is adopted on load
 *    and NOT clobbered back to the app default (the old prefs-client
 *    write-through bug)
 * 2. A bare family token (e.g. 'coffee') expands to the light/dark variant
 *    per prefers-color-scheme instead of falling through to 'light'
 * 3. A StorageEvent push-down after load is adopted (with the same
 *    normalization)
 * 4. Only an explicit in-app theme change writes sessionStorage['hadoku-theme']
 */

const THEME_KEY = 'hadoku-theme'

async function seedHostTheme(page: Page, theme: string) {
  await page.addInitScript(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: THEME_KEY,
    value: theme
  })
}

async function loadApp(page: Page) {
  await page.goto('/')
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
}

function getAppliedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'))
}

test.describe('Theme inheritance from host page', () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApi(page)
  })

  test('adopts a fully-qualified inherited theme and does not clobber it', async ({ page }) => {
    await seedHostTheme(page, 'ocean-dark')
    await loadApp(page)

    await expect.poll(() => getAppliedTheme(page)).toBe('ocean-dark')

    // The shared key must survive hydration untouched — the app only writes
    // it on an explicit in-app theme change.
    await page.waitForTimeout(500)
    expect(await page.evaluate(key => window.sessionStorage.getItem(key), THEME_KEY)).toBe(
      'ocean-dark'
    )
    expect(await getAppliedTheme(page)).toBe('ocean-dark')
  })

  test('expands a bare family token per light color scheme', async ({ page }) => {
    // Playwright contexts default to prefers-color-scheme: light
    await seedHostTheme(page, 'coffee')
    await loadApp(page)

    await expect.poll(() => getAppliedTheme(page)).toBe('coffee-light')
  })

  test('expands a bare family token per dark color scheme', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' })
    const page = await context.newPage()
    await mockShellApi(page)
    await seedHostTheme(page, 'coffee')
    await loadApp(page)

    await expect.poll(() => getAppliedTheme(page)).toBe('coffee-dark')

    await context.close()
  })

  test('adopts a theme pushed down via StorageEvent after load', async ({ page }) => {
    await loadApp(page)

    await page.evaluate(key => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'strawberry-dark' }))
    }, THEME_KEY)
    await expect.poll(() => getAppliedTheme(page)).toBe('strawberry-dark')

    // Push-down also normalizes bare family tokens (light scheme by default).
    await page.evaluate(key => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'lavender' }))
    }, THEME_KEY)
    await expect.poll(() => getAppliedTheme(page)).toBe('lavender-light')
  })

  test('explicit in-app theme change writes the shared sessionStorage key', async ({ page }) => {
    await loadApp(page)

    await page.locator('.theme-toggle-btn').click()
    await expect(page.locator('.theme-picker__dropdown')).toBeVisible()
    await page.locator('.theme-pill__btn:not(.active)').first().click()

    const applied = await getAppliedTheme(page)
    expect(applied).not.toBeNull()
    await expect
      .poll(() => page.evaluate(key => window.sessionStorage.getItem(key), THEME_KEY))
      .toBe(applied)
  })
})
