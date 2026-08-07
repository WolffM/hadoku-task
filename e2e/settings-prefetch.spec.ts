import { test, expect, type Page } from '@playwright/test'

/**
 * Settings data must be PREFETCHED at page load, never fetched on gear-click.
 *
 * ConnectedSettings used to resolve `GET /session/whoami` and
 * `GET /prefs/api/v1/content-level` inside its open handler. Both are the
 * signed-in user's own identity — known at boot, unchanged for the life of the
 * page — so the only thing that gating bought was a round trip of the user
 * staring at a panel that was already on screen but not yet filled in
 * (measured against prod: whoami 167ms and content-level 186ms, concurrent).
 *
 * The client now resolves both at MOUNT and memoises them page-wide, so:
 *   1. opening settings issues ZERO requests, and
 *   2. whoami is fetched at most once per page load — under the hadoku.me shell
 *      (hadoku_site/src/components/mf-loader.js) it is fetched ZERO times,
 *      because the loader already has one in flight and parks it on
 *      `window.__hadokuWhoami` for exactly this reason.
 *
 * This spec is the enforcement. If someone moves the fetch back behind the
 * click, or stops reusing the shell's whoami, test 1 or test 3 goes red.
 */

const APP_HEADER = 'h1.app-header__title'
const WHOAMI_PATH = '/session/whoami'
const CONTENT_PATH = '/prefs/api/v1/content-level'

const IDENTITY = { valid: true, userType: 'friend', name: 'Prefetch Tester' }
const CONTENT = { level: 2, maxLevel: 3 }

/** Counts of the two settings requests, by path, for the whole page life. */
type Counts = { whoami: number; content: number }

function countRequests(page: Page): Counts {
  const counts: Counts = { whoami: 0, content: 0 }
  page.on('request', req => {
    const url = req.url()
    if (url.includes(WHOAMI_PATH)) counts.whoami++
    // Match the path only — the app's own prefs traffic shares the /prefs/api
    // prefix and must not be counted here.
    else if (url.includes(CONTENT_PATH)) counts.content++
  })
  return counts
}

/**
 * Stub everything the boot touches, so the spec asserts on request COUNTS
 * rather than on whether a dev API stack happens to be running.
 */
async function stubBoot(page: Page) {
  // Playwright matches handlers in REVERSE registration order, so the catch-all
  // for the app's own prefs blob goes first and the specific content-level
  // route below overrides it.
  await page.route('**/prefs/api/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  )
  await page.route(`**${WHOAMI_PATH}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(IDENTITY) })
  )
  await page.route(`**${CONTENT_PATH}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONTENT) })
  )
  await page.route('**/task/api/session/handshake', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId: 'prefetch-session', userType: 'friend', preferences: null })
    })
  )
  await page.route('**/task/api/boards**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), boards: [] })
    })
  )
}

/** Sign in as `friend` the way hadoku_site's loader would, before any script runs. */
async function signedIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('hadoku_session_id', 'prefetch-session')
    localStorage.setItem('hadoku_user_type', 'friend')
  })
}

async function bootApp(page: Page) {
  await page.goto('/?userType=friend')
  await page.waitForSelector(APP_HEADER, { timeout: 15000 })
}

test.describe('settings prefetch', () => {
  test('resolves at page load, so opening the gear costs zero requests', async ({ page }) => {
    const counts = countRequests(page)
    await stubBoot(page)
    await signedIn(page)
    await bootApp(page)

    // The prefetch must have happened WITHOUT any interaction. This is the half
    // that fails if the fetch goes back behind the click.
    await expect
      .poll(() => counts.content, {
        timeout: 10000,
        message: 'content-level not prefetched at load'
      })
      .toBe(1)

    const atRest = { ...counts }

    await page.getByRole('button', { name: 'User settings' }).click()
    await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })

    // Populated in the same paint the panel appears in — no placeholder, no
    // round trip. A short timeout on purpose: this must be already-resolved
    // state, not a request that merely happens to be fast.
    await expect(page.locator('.settings-popout__tier')).toHaveText('Friend', { timeout: 1000 })
    await expect(page.locator('.settings-popout__pill')).toBeVisible({ timeout: 1000 })
    await expect(page.locator('.settings-popout__seg--filled')).toHaveCount(CONTENT.level)

    // Give any click-triggered request a generous window to show up.
    await page.waitForTimeout(1500)
    expect(counts.content, 'opening settings refetched content-level').toBe(atRest.content)
    expect(counts.whoami, 'opening settings refetched whoami').toBe(atRest.whoami)
  })

  test('fetches whoami at most once for the whole page load', async ({ page }) => {
    const counts = countRequests(page)
    await stubBoot(page)
    await signedIn(page)
    await bootApp(page)

    await page.getByRole('button', { name: 'User settings' }).click()
    await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })
    await expect(page.locator('.settings-popout__tier')).toHaveText('Friend', { timeout: 1000 })

    await page.waitForTimeout(1000)
    expect(counts.whoami, 'whoami resolved more than once per page load').toBeLessThanOrEqual(1)
  })

  test('takes the content level off whoami when edge-router reports it', async ({ page }) => {
    // The current edge-router carries contentLevel/maxContentLevel on whoami —
    // authGate already resolved the level to stamp X-Hadoku-Content-Level, so
    // reporting it is free and the proxied prefs-api round trip disappears.
    const counts = countRequests(page)
    await stubBoot(page)
    await signedIn(page)
    await page.route(`**${WHOAMI_PATH}`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...IDENTITY, contentLevel: 3, maxContentLevel: 4 })
      })
    )

    await bootApp(page)
    await page.getByRole('button', { name: 'User settings' }).click()
    await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })

    // Rendered from the whoami body — note maxLevel 4, which the CONTENT stub
    // does not serve, so this can only have come from whoami.
    await expect(page.locator('.settings-popout__seg')).toHaveCount(4)
    await expect(page.locator('.settings-popout__seg--filled')).toHaveCount(3)

    await page.waitForTimeout(1500)
    expect(counts.content, 'fetched content-level that whoami already carried').toBe(0)
  })

  test('falls back to the GET when whoami does not carry the level', async ({ page }) => {
    // An older edge-router, or a host not behind one at all. The popout must
    // still fill in — the fallback is what keeps this bundle deployable ahead
    // of the edge change, and usable from Capacitor/Storybook.
    const counts = countRequests(page)
    await stubBoot(page) // IDENTITY has no contentLevel fields
    await signedIn(page)
    await bootApp(page)

    await expect
      .poll(() => counts.content, { timeout: 10000, message: 'fallback GET never issued' })
      .toBe(1)

    await page.getByRole('button', { name: 'User settings' }).click()
    await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })
    await expect(page.locator('.settings-popout__seg')).toHaveCount(CONTENT.maxLevel)
    await expect(page.locator('.settings-popout__seg--filled')).toHaveCount(CONTENT.level)
  })

  test('reuses the shell’s boot whoami instead of issuing its own', async ({ page }) => {
    const counts = countRequests(page)
    await stubBoot(page)
    await signedIn(page)

    // Exactly what hadoku_site's mf-loader does: kick whoami alongside the
    // module import and park the promise on the global. Nothing downstream may
    // fetch it a second time.
    await page.addInitScript(() => {
      ;(globalThis as { __hadokuWhoami?: Promise<unknown> }).__hadokuWhoami = Promise.resolve({
        valid: true,
        userType: 'friend',
        name: 'Shell Identity'
      })
    })

    await bootApp(page)
    await page.getByRole('button', { name: 'User settings' }).click()
    await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })

    // Identity came from the shell's promise, not the network.
    await expect(page.locator('.settings-popout__value').first()).toHaveText('Shell Identity', {
      timeout: 2000
    })
    expect(counts.whoami, 'refetched whoami the shell had already resolved').toBe(0)
  })
})
