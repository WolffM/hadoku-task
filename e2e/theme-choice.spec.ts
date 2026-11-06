import { test, expect, type Page, type Request } from '@playwright/test'
import { mockShellApi } from './helpers/mock-api'
import { asFreshUser, prefsUp, pointPrefsAtLocalStack, PREFS_BASE } from './helpers/prefs'

/**
 * What counts as a theme CHOICE, and where one is recorded.
 *
 * hadoku.me deals someone who has never picked a random dark theme (the host's
 * pre-paint bootstrap, hadoku_site spec/theme-bootstrap.js). It keeps the draw
 * out of localStorage['hadoku-theme'] and echoes it only into sessionStorage,
 * so "nothing durable, nothing in prefs" is how this hook recognises it.
 *
 *   - A pick from the picker is saved at user scope (a device with no pick of
 *     its own inherits it, which is what stops the draw on every device) and
 *     at device scope (this device's own answer).
 *   - The OS light/dark switch moves a CHOSEN theme within its family, on this
 *     device only, and leaves a draw alone: the draw is dark whatever the OS
 *     says, and following it would persist a pick nobody made.
 */

const PORTFOLIO = `${PREFS_BASE}/api/v1/portfolio`

/** Scopes of every portfolio-row PUT the page sends. */
function portfolioPuts(page: Page): Array<{ scope: string; theme: unknown }> {
  const puts: Array<{ scope: string; theme: unknown }> = []
  page.on('request', (r: Request) => {
    if (r.method() !== 'PUT' || !r.url().startsWith(PORTFOLIO)) return
    const body = r.postDataJSON() as { scope: string; patch: { theme?: unknown } }
    puts.push({ scope: body.scope, theme: body.patch.theme })
  })
  return puts
}

/**
 * The one state the shared dev user's real row cannot express: "no pick on the
 * server". Every spec signs in as the same `dev-uid`, and any pick writes its
 * user scope, so the real row may already hold a theme the hook would adopt.
 * Answer the read with the real worker's shape for an empty row; writes still
 * go to the real worker.
 */
async function serverHoldsNoPick(page: Page) {
  await page.route(`${PORTFOLIO}*`, route =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { user: null, device: null, merged: {} } })
      : route.fallback()
  )
}

async function waitForApp(page: Page) {
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
}

const theme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'))

test.describe('Theme choice', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await prefsUp(request)), 'prefs stack not running (pnpm run dev:api)')
    await mockShellApi(page)
    await pointPrefsAtLocalStack(page)
  })

  test('a pick is saved at user and device scope', async ({ page }) => {
    const puts = portfolioPuts(page)
    await page.goto('/')
    await waitForApp(page)

    await page.locator('.theme-toggle-btn').click()
    await page.locator('.theme-pill__btn:not(.active)').first().click()
    const picked = await theme(page)

    // The second scope's save flushes the first; the last one waits out the
    // SDK's 1 s debounce.
    await expect
      .poll(() => puts.map(p => p.scope).sort(), { timeout: 5000 })
      .toEqual(['device', 'user'])
    expect(puts.every(p => p.theme === picked)).toBe(true)
  })

  test('a random draw ignores the OS light/dark switch', async ({ page }) => {
    await serverHoldsNoPick(page)
    const puts = portfolioPuts(page)
    await page.emulateMedia({ colorScheme: 'dark' })
    // The host's draw, echoed into the tab-local layer only.
    await page.addInitScript(() => sessionStorage.setItem('hadoku-theme', 'ocean-dark'))
    await page.goto('/')
    await waitForApp(page)
    expect(await theme(page)).toBe('ocean-dark')

    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForTimeout(1500)
    expect(await theme(page)).toBe('ocean-dark')
    expect(await page.evaluate(() => localStorage.getItem('hadoku-theme'))).toBeNull()
    expect(puts).toEqual([])
  })

  test('a chosen theme follows the OS switch, on this device only', async ({ page }) => {
    await serverHoldsNoPick(page)
    const puts = portfolioPuts(page)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => {
      if (localStorage.getItem('hadoku-theme') === null) {
        localStorage.setItem('hadoku-theme', 'ocean-dark')
        sessionStorage.setItem('hadoku-theme', 'ocean-dark')
      }
    })
    await page.goto('/')
    await waitForApp(page)
    expect(await theme(page)).toBe('ocean-dark')

    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => theme(page)).toBe('ocean-light')
    await expect
      .poll(() => puts, { timeout: 5000 })
      .toEqual([{ scope: 'device', theme: 'ocean-light' }])
  })

  // hadoku.me's loader always passes the theme on screen into the app, and on a
  // device that never picked that is the random draw. It must not stand in the
  // way of a pick made on another device.
  test('a host-passed draw yields to a pick from another device', async ({ page }) => {
    await asFreshUser(page)
    const put = await page.request.put(PORTFOLIO, {
      headers: { 'X-Device-Id': crypto.randomUUID() },
      data: { scope: 'user', patch: { theme: 'nature-light' } }
    })
    expect(put.ok()).toBe(true)

    await page.addInitScript(() => sessionStorage.setItem('hadoku-theme', 'pink-dark'))
    await page.goto('/?theme=pink-dark')
    await waitForApp(page)
    await expect.poll(() => theme(page), { timeout: 10000 }).toBe('nature-light')
    // …and is this device's now, so the next cold load paints it directly.
    expect(await page.evaluate(() => localStorage.getItem('hadoku-theme'))).toBe('nature-light')
  })

  test("a host-passed theme this device chose is kept over another device's", async ({ page }) => {
    await asFreshUser(page)
    const put = await page.request.put(PORTFOLIO, {
      headers: { 'X-Device-Id': crypto.randomUUID() },
      data: { scope: 'user', patch: { theme: 'nature-light' } }
    })
    expect(put.ok()).toBe(true)

    await page.addInitScript(() => {
      localStorage.setItem('hadoku-theme', 'pink-dark')
      sessionStorage.setItem('hadoku-theme', 'pink-dark')
    })
    await page.goto('/?theme=pink-dark')
    await waitForApp(page)
    await page.waitForTimeout(2000)
    expect(await theme(page)).toBe('pink-dark')
  })
})
