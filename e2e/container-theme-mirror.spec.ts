import { test, expect } from '@playwright/test'
import { mockShellApi } from './helpers/mock-api'

/**
 * The theme reaches `.task-app-container` even though that div mounts late (#102).
 *
 * `useTheme` mirrors `data-theme` onto the app's container for micro-frontend
 * mounts, where an ancestor between <html> and the app may carry its own theme.
 * The container only exists once the loading skeleton gives way, and the mirror
 * used to run only when the theme changed — so a skeleton that outlived the
 * hook's first two passes (the initial apply and the ready flip 50ms later)
 * left the container bare for the rest of the session.
 *
 * A slow session handshake holds the skeleton up long enough to make that
 * deterministic rather than a 1-in-4 race.
 */

for (const theme of ['light', 'coffee-dark']) {
  test(`container carries data-theme=${theme} after a slow first load`, async ({ page }) => {
    await page.addInitScript(t => {
      sessionStorage.setItem('hadoku-theme', t)
    }, theme)
    await mockShellApi(page)
    await page.route('**/task/api/session/handshake', async route => {
      await new Promise(resolve => setTimeout(resolve, 500))
      await route.fallback()
    })

    await page.goto('/')
    await page.locator('h1.app-header__title').waitFor({ timeout: 10000 })

    await expect(page.locator('.task-app-container')).toHaveAttribute('data-theme', theme)
  })
}
