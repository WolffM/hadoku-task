import { test, expect, type Locator, type Page } from '@playwright/test'
import { mockShellApi } from './helpers/mock-api'
import { PREFS_BASE, prefsUp, pointPrefsAtLocalStack } from './helpers/prefs'

/**
 * The settings popout's tabs: the site's groups, then the app's, as an ARIA
 * tablist, with the open tab remembered per user on the shared prefs row.
 *
 * Runs against the REAL prefs-api on :3003, because "remembered" means the
 * value survives a reload through the server, not only the SDK's local cache.
 * The task app passes `children` and no `appTabs`, so its strip is
 * Profile · Content · Account · App.
 */

const PORTFOLIO_ROW = `${PREFS_BASE}/api/v1/portfolio`
const TABS = ['Profile', 'Content', 'Account', 'App']

/** Forget any remembered tab, so each test starts from the default. */
async function clearSavedTab(page: Page) {
  const resp = await page.request.put(PORTFOLIO_ROW, {
    data: { scope: 'user', patch: { settingsTabs: {} } }
  })
  expect(resp.ok(), `clearing settingsTabs: ${resp.status()}`).toBe(true)
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'User settings' }).click()
  const panel = page.locator('.settings-popout__panel')
  await expect(panel).toBeVisible()
  return panel
}

const selected = (page: Page) => page.getByRole('tab', { selected: true })

/** Viewport rect; measured in the page, so it is never null for a visible element. */
const rect = (el: Locator) =>
  el.evaluate(n => {
    const { x, width } = n.getBoundingClientRect()
    return { x, width }
  })

test.describe('settings tabs', () => {
  // Every test signs in as the stack's one dev user and writes its one row:
  // in parallel, one test's reset bumps the version under another's save,
  // which the SDK answers by adopting the server's blob (a 409, save dropped).
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await prefsUp(request)), 'prefs stack not running (pnpm run dev:api)')
    await clearSavedTab(page)
    await mockShellApi(page)
    await pointPrefsAtLocalStack(page)
    await page.addInitScript(() => {
      localStorage.setItem('hadoku_session_id', 'settings-tabs-session')
      localStorage.setItem('hadoku_user_type', 'friend')
    })
    await page.goto('/?userType=friend')
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
  })

  test.afterEach(async ({ page }) => {
    await clearSavedTab(page)
  })

  test('site groups, then the app; opens on the app tab; one panel at a time', async ({ page }) => {
    const panel = await openSettings(page)
    const tablist = panel.getByRole('tablist', { name: 'Settings sections' })
    await expect(tablist.getByRole('tab')).toHaveText(TABS)
    await expect(selected(page)).toHaveText('App')

    const tabpanel = panel.getByRole('tabpanel')
    await expect(tabpanel).toHaveAttribute('aria-labelledby', /.+/)
    expect(await tabpanel.getAttribute('aria-labelledby')).toBe(
      await selected(page).getAttribute('id')
    )
    // The app's own section, and none of the site's rows.
    await expect(tabpanel.locator('.settings-popout__tier')).toHaveCount(0)

    await panel.getByRole('tab', { name: 'Profile' }).click()
    await expect(tabpanel.locator('.settings-popout__tier')).toHaveText('Friend')
    await expect(tabpanel.getByRole('button', { name: 'Switch key' })).toHaveCount(0)

    await panel.getByRole('tab', { name: 'Account' }).click()
    await expect(tabpanel.getByRole('button', { name: 'Switch key' })).toBeVisible()
  })

  test('arrow keys, Home and End move between tabs and open them', async ({ page }) => {
    await openSettings(page)
    // Roving tabindex: only the open tab is in the Tab order.
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveText('App')
    await selected(page).focus()

    await page.keyboard.press('ArrowRight') // wraps past the end
    await expect(selected(page)).toHaveText('Profile')
    await expect(selected(page)).toBeFocused()

    await page.keyboard.press('ArrowLeft') // and back past the start
    await expect(selected(page)).toHaveText('App')

    await page.keyboard.press('Home')
    await expect(selected(page)).toHaveText('Profile')
    await page.keyboard.press('ArrowRight')
    await expect(selected(page)).toHaveText('Content')
    await expect(page.locator('.settings-popout__pill')).toBeVisible()

    await page.keyboard.press('End')
    await expect(selected(page)).toHaveText('App')
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1)
  })

  test('the open tab is remembered across a reload, through the server', async ({ page }) => {
    // The response, not the request: a reload while the PUT is in flight
    // aborts it.
    const saved = page.waitForResponse(
      r => r.request().method() === 'PUT' && r.url().startsWith(PORTFOLIO_ROW)
    )
    const panel = await openSettings(page)
    await panel.getByRole('tab', { name: 'Account' }).click()
    const resp = await saved
    expect(resp.ok(), `PUT ${resp.status()}: ${await resp.text()}`).toBe(true)
    const body = resp.request().postDataJSON() as { scope: string; patch: unknown }
    expect(body.scope).toBe('user')
    expect(body.patch).toEqual({ settingsTabs: { '': 'account' } })

    // Drop the SDK's local cache, so only the server can bring it back.
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('prefs-cache:')) localStorage.removeItem(k)
      }
    })
    await page.reload()
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
    await openSettings(page)
    await expect(selected(page)).toHaveText('Account')
  })

  test('at phone width the strip scrolls sideways inside the panel', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    const panel = await openSettings(page)
    const box = await rect(panel)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)

    const strip = panel.getByRole('tablist')
    expect(await strip.evaluate(el => getComputedStyle(el).overflowX)).toBe('auto')
    // Nothing else in the panel overflows sideways.
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)

    // The last tab is reachable: selecting it scrolls it into the strip's view.
    await selected(page).focus()
    await page.keyboard.press('End')
    const last = await rect(selected(page))
    const stripBox = await rect(strip)
    expect(last.x + last.width).toBeLessThanOrEqual(stripBox.x + stripBox.width + 1)
  })
})
