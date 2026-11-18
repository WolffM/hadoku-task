import { test, expect, type Page } from '@playwright/test'
import { asFreshUser, pointPrefsAtLocalStack, PREFS_BASE } from './helpers/prefs'

/**
 * The header's two account prompts for a guest (hadoku_site
 * docs/planning/account-journeys-2026-11-18.md, J5 and §4), end to end in the
 * task app, which renders them through AppHeader like every app:
 *
 *   - the verify dialog, opened by a 403 MEMBER_NOT_VERIFIED on any fetch the
 *     page makes, by the app's requestVerification(), or by the account tab's
 *     "Link your account";
 *   - the keep-your-account banner, after the first click, once per page,
 *     snoozed for a week by Later on the person's prefs row (the REAL prefs-api).
 *
 * whoami and the edge's /session/verify-request are mocked; prefs are not.
 * The rules underneath are src/test/account-prompts-verify.ts.
 */

const APP_HEADER = 'h1.app-header__title'
const DIALOG = { name: /needs a verified account/ }

async function as(page: Page, identity: Record<string, unknown>) {
  await page.route('**/session/whoami', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, name: 'Player 12345', passkeys: 1, ...identity })
    })
  )
}

/** /session/verify-request: GET answers `open`; POST answers `post`, and is recorded. */
async function verifyRequestRoute(
  page: Page,
  {
    open = false,
    post = { status: 200, body: { requested: true, fresh: true, requestedAt: 1 } }
  } = {}
) {
  const posts: unknown[] = []
  await page.route('**/session/verify-request', route => {
    const req = route.request()
    if (req.method() === 'POST') {
      posts.push(req.postDataJSON())
      return route.fulfill({
        status: post.status,
        contentType: 'application/json',
        body: JSON.stringify(post.body)
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tier: 'guest', requested: open, requestedAt: open ? 1 : null })
    })
  })
  return posts
}

/** A backend refusing this caller: the route answers 403 with `body`. */
async function refusal(page: Page, body: Record<string, unknown>) {
  await page.route('**/e2e-refusal', route =>
    route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify(body) })
  )
}
const hitRefusal = (page: Page) => page.evaluate(() => fetch('/e2e-refusal').then(r => r.status))

async function load(page: Page) {
  await page.goto('/')
  await page.waitForSelector(APP_HEADER, { timeout: 10000 })
  // Identity has settled: the gear's tier is known once the account tab says so.
  await expect(page.getByRole('button', { name: /User settings/ })).toBeVisible()
}

/** The app's own call, through the package the header came from. */
const requestVerification = (page: Page, reason?: string) =>
  page.evaluate(r => {
    window.dispatchEvent(
      new window.CustomEvent('hadoku:verify-needed', { detail: { reason: r, source: 'app' } })
    )
  }, reason)

test.describe('verify dialog', () => {
  test('a 403 MEMBER_NOT_VERIFIED on any fetch opens it for a guest', async ({ page }) => {
    await as(page, { userType: 'guest', verified: false })
    await verifyRequestRoute(page)
    await refusal(page, { error: 'Forbidden', code: 'MEMBER_NOT_VERIFIED' })
    await load(page)
    expect(await hitRefusal(page)).toBe(403)
    const dialog = page.getByRole('dialog', DIALOG)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog.getByRole('heading')).toHaveText('This needs a verified account')
    await expect(dialog).toContainText("You're playing as Player 12345.")
  })

  test('any other 403 opens nothing', async ({ page }) => {
    await as(page, { userType: 'guest', verified: false })
    await refusal(page, { error: 'Forbidden', code: 'FORBIDDEN' })
    await load(page)
    expect(await hitRefusal(page)).toBe(403)
    await page.waitForTimeout(300)
    await expect(page.getByRole('dialog', DIALOG)).toHaveCount(0)
  })

  for (const [why, identity] of [
    ['public', { valid: false, userType: 'public', name: null }],
    [
      'an unverified member (before the platform mints guests)',
      { userType: 'member', verified: false }
    ],
    ['a verified member', { userType: 'member', verified: true }],
    ['a friend', { userType: 'friend', verified: true }]
  ] as const) {
    test(`nothing for ${why}`, async ({ page }) => {
      await as(page, identity)
      await refusal(page, { code: 'MEMBER_NOT_VERIFIED' })
      await load(page)
      await hitRefusal(page)
      await requestVerification(page, 'Saving decks')
      await page.waitForTimeout(300)
      await expect(page.getByRole('dialog', DIALOG)).toHaveCount(0)
    })
  }

  test('requestVerification opens it titled by the reason', async ({ page }) => {
    await as(page, { userType: 'guest', verified: false })
    await verifyRequestRoute(page)
    await load(page)
    await requestVerification(page, 'Saving decks')
    await expect(
      page.getByRole('dialog', { name: 'Saving decks needs a verified account' })
    ).toBeVisible()
  })

  test('focus stays inside, Escape closes, Not now closes', async ({ page }) => {
    await as(page, { userType: 'guest', verified: false })
    await verifyRequestRoute(page)
    await load(page)
    await requestVerification(page)
    const dialog = page.getByRole('dialog', DIALOG)
    await expect(dialog.getByRole('button', { name: 'I already have an account' })).toBeFocused()
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate(d => d.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Shift+Tab')
    expect(await dialog.evaluate(d => d.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await requestVerification(page)
    await dialog.getByRole('button', { name: 'Not now' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('after Not now, a repeated refusal waits for the next action', async ({ page }) => {
    await as(page, { userType: 'guest', verified: false })
    await verifyRequestRoute(page)
    await refusal(page, { code: 'MEMBER_NOT_VERIFIED' })
    await load(page)
    await hitRefusal(page)
    const dialog = page.getByRole('dialog', DIALOG)
    await dialog.getByRole('button', { name: 'Not now' }).click()
    await hitRefusal(page) // a retry nobody asked for
    await page.waitForTimeout(300)
    await expect(dialog).toHaveCount(0)
    await page.locator(APP_HEADER).click()
    await hitRefusal(page)
    await expect(dialog).toBeVisible()
  })

  test('I already have an account signs in and comes back here', async ({ page }) => {
    await as(page, { userType: 'guest', verified: false })
    await verifyRequestRoute(page)
    await page.route('**/auth?**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>auth</p>' })
    )
    await page.goto('/?board=x#lane')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })
    await requestVerification(page)
    await page
      .getByRole('dialog', DIALOG)
      .getByRole('button', { name: 'I already have an account' })
      .click()
    await page.waitForURL('**/auth?**')
    const url = new URL(page.url())
    expect(url.pathname).toBe('/auth')
    expect(url.searchParams.get('switch')).toBe('1')
    expect(url.searchParams.get('return')).toBe('/?board=x#lane')
  })

  test('Ask to be verified posts the reason, then says it was sent', async ({ page }) => {
    await as(page, { userType: 'guest', verified: false })
    const posts = await verifyRequestRoute(page)
    await load(page)
    await requestVerification(page, 'Saving decks')
    const dialog = page.getByRole('dialog', DIALOG)
    await dialog.getByRole('button', { name: 'Ask to be verified' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Request sent')
    expect(posts).toEqual([{ reason: 'Saving decks' }])
  })

  test('a request already sent says so (fresh: false)', async ({ page }) => {
    await as(page, { userType: 'guest', verified: false })
    await verifyRequestRoute(page, {
      post: { status: 200, body: { requested: true, fresh: false, requestedAt: 1 } }
    })
    await load(page)
    await requestVerification(page)
    const dialog = page.getByRole('dialog', DIALOG)
    await dialog.getByRole('button', { name: 'Ask to be verified' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Already requested')
  })

  test('an open request shows Requested in place of the button', async ({ page }) => {
    await as(page, { userType: 'guest', verified: false })
    await verifyRequestRoute(page, { open: true })
    await load(page)
    await requestVerification(page)
    const dialog = page.getByRole('dialog', DIALOG)
    await expect(dialog.getByRole('status')).toHaveText('Requested')
    await expect(dialog.getByRole('button', { name: 'Ask to be verified' })).toHaveCount(0)
  })

  test('409: already verified, so it closes and whoami is read again', async ({ page }) => {
    let whoamis = 0
    let verifiedNow = false
    await page.route('**/session/whoami', route => {
      whoamis++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          verifiedNow
            ? { valid: true, userType: 'member', verified: true, name: 'Player 12345', passkeys: 1 }
            : { valid: true, userType: 'guest', verified: false, name: 'Player 12345', passkeys: 1 }
        )
      })
    })
    await verifyRequestRoute(page, { post: { status: 409, body: { error: 'Already verified' } } })
    await load(page)
    const before = whoamis
    await requestVerification(page)
    const dialog = page.getByRole('dialog', DIALOG)
    verifiedNow = true
    await dialog.getByRole('button', { name: 'Ask to be verified' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => whoamis).toBeGreaterThan(before)
    await page.getByRole('button', { name: 'User settings' }).click()
    const panel = page.locator('.settings-popout__panel')
    await panel.getByRole('tab', { name: 'Account' }).click()
    await expect(panel.locator('.settings-popout__tier')).toHaveText('Member-verified')
  })

  test('the account tab: "Guest · Link your account" opens it', async ({ page }) => {
    await as(page, { userType: 'guest', verified: false })
    await verifyRequestRoute(page)
    await load(page)
    await page.getByRole('button', { name: 'User settings' }).click()
    const panel = page.locator('.settings-popout__panel')
    await panel.getByRole('tab', { name: 'Account' }).click()
    const line = panel.locator('.settings-popout__tier').locator('..')
    await expect(line).toHaveText('Guest·Link your account')
    await panel.getByRole('button', { name: 'Link your account' }).click()
    await expect(page.getByRole('dialog', DIALOG)).toBeVisible()
    await expect(panel).toHaveCount(0)
  })

  test('no Link your account line for a member', async ({ page }) => {
    await as(page, { userType: 'member', verified: false })
    await load(page)
    await page.getByRole('button', { name: 'User settings' }).click()
    const panel = page.locator('.settings-popout__panel')
    await panel.getByRole('tab', { name: 'Account' }).click()
    await expect(panel.locator('.settings-popout__tier')).toHaveText('Member')
    await expect(panel.getByRole('button', { name: 'Link your account' })).toHaveCount(0)
  })
})

test.describe('keep-your-account banner', () => {
  const banner = (page: Page) => page.getByRole('region', { name: 'Keep this account' })

  test.beforeEach(async ({ page }) => {
    await pointPrefsAtLocalStack(page)
  })

  test('not on load; after the first click, under the header', async ({ page }) => {
    // A real userId: the prefs client keys the person's row by it.
    await as(page, {
      userType: 'guest',
      verified: false,
      passkeys: 0,
      userId: await asFreshUser(page)
    })
    await load(page)
    await page.waitForTimeout(300)
    await expect(banner(page)).toHaveCount(0)
    await page.locator(APP_HEADER).click()
    await expect(banner(page)).toBeVisible()
    await expect(banner(page)).toContainText("You're playing as Player 12345 on this device only.")
    // The header's next sibling holds it.
    expect(
      await page.evaluate(
        () => document.querySelector('header.app-header')?.nextElementSibling?.className
      )
    ).toBe('app-header-notice')
  })

  test('Later: gone for the page, snoozed a week on the prefs row, still gone after reload', async ({
    page,
    browser
  }) => {
    const userId = await asFreshUser(page)
    const guest = { userType: 'guest', verified: false, passkeys: 0, userId }
    await as(page, guest)
    await load(page)
    await page.locator(APP_HEADER).click()
    const t0 = Date.now()
    await banner(page).getByRole('button', { name: 'Later' }).click()
    await expect(banner(page)).toHaveCount(0)
    await page.locator(APP_HEADER).click()
    await expect(banner(page)).toHaveCount(0)
    // The prefs client debounces its PUT; read the row the server holds.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`${PREFS_BASE}/api/v1/portfolio`)
          const body = (await res.json()) as {
            user?: { blob?: { keepAccountSnoozedUntil?: number } }
          }
          return body.user?.blob?.keepAccountSnoozedUntil ?? 0
        },
        { timeout: 10000 }
      )
      .toBeGreaterThanOrEqual(t0 + 7 * 24 * 60 * 60 * 1000 - 1000)
    await page.reload()
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })
    await page.locator(APP_HEADER).click()
    await page.waitForTimeout(500)
    await expect(banner(page)).toHaveCount(0)

    // Per person, not per device: another browser signed in as them is snoozed too.
    const other = await browser.newContext()
    try {
      const page2 = await other.newPage()
      await pointPrefsAtLocalStack(page2)
      await other.addCookies([{ name: 'dev_user', value: userId, domain: 'localhost', path: '/' }])
      await as(page2, guest)
      await load(page2)
      await page2.locator(APP_HEADER).click()
      await page2.waitForTimeout(500)
      await expect(banner(page2)).toHaveCount(0)
    } finally {
      await other.close()
    }
  })

  test('Save a passkey hides it for good', async ({ page }) => {
    // A real userId: the prefs client keys the person's row by it.
    await as(page, {
      userType: 'guest',
      verified: false,
      passkeys: 0,
      userId: await asFreshUser(page)
    })
    await page.route('**/auth/sign-in.js*', route =>
      route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `export async function signIn() { throw new Error('unused') }
export async function addPasskey() { window.__added = (window.__added || 0) + 1; return { saved: true, passkeys: 1 } }`
      })
    )
    await load(page)
    await page.locator(APP_HEADER).click()
    await banner(page).getByRole('button', { name: 'Save a passkey' }).click()
    await expect(banner(page)).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __added: number }).__added)).toBe(1)
    await page.locator(APP_HEADER).click()
    await expect(banner(page)).toHaveCount(0)
    await expect(page.locator('.settings-toggle-btn__dot')).toHaveCount(0)
  })

  for (const [why, identity] of [
    ['a guest with a passkey', { userType: 'guest', verified: false, passkeys: 1 }],
    ['an unverified member with none', { userType: 'member', verified: false, passkeys: 0 }],
    ['a friend with none', { userType: 'friend', verified: true, passkeys: 0 }],
    ['public', { valid: false, userType: 'public', name: null, passkeys: 0 }]
  ] as const) {
    test(`never for ${why}`, async ({ page }) => {
      await asFreshUser(page)
      await as(page, identity)
      await load(page)
      await page.locator(APP_HEADER).click()
      await page.waitForTimeout(500)
      await expect(banner(page)).toHaveCount(0)
    })
  }
})
