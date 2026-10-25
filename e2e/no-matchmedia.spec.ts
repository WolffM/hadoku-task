import { test, expect } from '@playwright/test'
import { mockShellApi } from './helpers/mock-api'

/**
 * The app mounts in an environment with no `window.matchMedia` (#91).
 *
 * jsdom has never implemented it, so every consumer that renders a themed tree
 * under jsdom hit `window.matchMedia is not a function` in useTheme's OS
 * light/dark effect — cardtable shipped a local shim to get its tests back.
 * The real browser here stands in for jsdom: the same global is removed before
 * any script runs, and the page must mount without an uncaught error.
 */

test('mounts without matchMedia and raises no page error', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true })
  })
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  await mockShellApi(page)
  await page.goto('/')
  // The app's error boundary catches a render/effect throw, so it never reaches
  // `pageerror` — the header just never shows. Name what the page did render
  // in the failure instead of a bare timeout.
  await page
    .locator('h1.app-header__title')
    .waitFor({ timeout: 10000 })
    .catch(async (err: Error) => {
      const body = await page.locator('body').innerText()
      throw new Error(`${err.message}\npage rendered: ${body}`)
    })
  await expect(page.locator('.task-app-container')).toBeVisible()

  expect(errors).toEqual([])
})
