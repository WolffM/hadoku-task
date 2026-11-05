import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * Service access in the settings popout's Account tab (ServiceAccess.tsx): a grantee enrols
 * their own authenticator and mints a 7-day credential, both behind a passkey
 * tap (hadoku_site docs/planning/service-grants-2026-10-31.md).
 *
 * The edge routes are a stateful stand-in; the passkey tap is a stand-in
 * /auth/sign-in.js exporting `stepUpPasskey`, as settings-passkey.spec.ts does
 * for its ceremonies. The real step-up is pinned in hadoku_site's
 * workers/edge-router/test/service-access.test.ts.
 */

const APP_HEADER = 'h1.app-header__title'
const ASSERTION = {
  id: 'cred',
  clientDataJSON: 'cd',
  authenticatorData: 'ad',
  signature: 'sig',
  userHandle: null
}
const IDENTITY = 'cccccccc-0000-4000-8000-000000000003'

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function boot(page: Page, serviceGrants: number) {
  await page.route('**/prefs/api/**', route => json(route, {}))
  // The Account tab mounts Linked accounts, which reads the avatar settings.
  await page.route('**/prefs/api/v1/_avatar', route =>
    json(route, { linked: {}, providers: { discord: true, steam: true } })
  )
  await page.route('**/session/whoami', route =>
    json(route, { valid: true, userType: 'friend', name: 'alice', passkeys: 1, serviceGrants })
  )
  await page.route('**/task/api/boards**', route =>
    json(route, { version: 1, updatedAt: new Date().toISOString(), boards: [] })
  )
  await page.route('**/auth/sign-in.js*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `export async function signIn() { throw new Error('unused') }
        window.__taps = 0
        export async function stepUpPasskey() { window.__taps++; return ${JSON.stringify(ASSERTION)} }`
    })
  )
  await page.addInitScript(() => {
    localStorage.setItem('hadoku_session_id', 'svc-session')
    localStorage.setItem('hadoku_user_type', 'friend')
  })
}

/** The edge's service-access routes, keeping what the popout posted. */
function edge(page: Page) {
  const posts: { path: string; body: Record<string, unknown> }[] = []
  let totp: 'none' | 'active' = 'none'
  let credentials: unknown[] = []
  const now = Date.now()
  void page.route('**/session/service-access**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/session/service-access', '')
    if (route.request().method() === 'GET') {
      return json(route, {
        grants: [{ identityUserId: IDENTITY, name: 'hopper-service-key' }],
        totp,
        credentials
      })
    }
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    posts.push({ path, body })
    if (path === '/totp/start') {
      return json(route, {
        uri: 'otpauth://totp/hadoku.me:alice?secret=JBSWY3DPEHPK3PXP&issuer=hadoku.me',
        secret: 'JBSWY3DPEHPK3PXP'
      })
    }
    if (path === '/totp/confirm') {
      totp = 'active'
      return json(route, { ok: true })
    }
    if (path === '/mint') {
      credentials = [
        {
          prefix: 'abcd1234',
          identityUserId: IDENTITY,
          name: 'hopper-service-key',
          expiresAt: now + 7 * 86_400_000,
          lastSeenAt: 0,
          live: true
        }
      ]
      return json(route, {
        key: 'abcd1234-0000-4000-8000-000000000000',
        name: 'hopper-service-key',
        expiresAt: now + 7 * 86_400_000
      })
    }
    if (path === '/revoke') {
      credentials = []
      return json(route, { retired: 1 })
    }
    return json(route, { error: 'unexpected' }, 404)
  })
  return posts
}

async function openAccount(page: Page) {
  await page.goto('/?userType=friend')
  await page.waitForSelector(APP_HEADER, { timeout: 15000 })
  await page.getByRole('button', { name: 'User settings' }).click()
  const panel = page.locator('.settings-popout__panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('tab', { name: 'Account' }).click()
  await expect(panel.getByText('Linked accounts', { exact: true })).toBeVisible({ timeout: 5000 })
  return panel
}

const row = (page: Page) => page.getByRole('region', { name: 'Service access' })

test.describe('settings service access', () => {
  test('a person with no grant sees no Service access, and fetches none', async ({ page }) => {
    await boot(page, 0)
    let fetched = 0
    page.on('request', r => {
      if (r.url().includes('/session/service-access')) fetched++
    })
    await openAccount(page)
    await expect(row(page)).toHaveCount(0)
    expect(fetched).toBe(0)
  })

  test('enrol an authenticator, mint a credential shown once, then revoke it', async ({ page }) => {
    await boot(page, 1)
    const posts = edge(page)
    await openAccount(page)
    // No heading or Open toggle: the authenticator line leads, ready to use.
    await expect(page.getByText('Service access', { exact: true })).toHaveCount(0)

    // 1. Enrol: passkey tap, QR + secret, one code.
    await row(page).getByRole('button', { name: 'Set up' }).click()
    await expect(row(page).getByRole('img', { name: 'Authenticator QR code' })).toBeVisible()
    await expect(row(page).getByText('JBSWY3DPEHPK3PXP')).toBeVisible()
    await row(page).getByLabel('Authenticator code').fill('123456')
    await row(page).getByRole('button', { name: 'Confirm' }).click()
    expect(posts[0]).toEqual({ path: '/totp/start', body: { assertion: ASSERTION } })
    await expect.poll(() => posts[1]).toEqual({ path: '/totp/confirm', body: { code: '123456' } })

    // 2. Mint: a code, then a second passkey tap.
    await expect(row(page).getByRole('button', { name: 'Mint' })).toBeVisible()
    await row(page).getByLabel('Authenticator code').fill('654321')
    await row(page).getByRole('button', { name: 'Mint' }).click()
    await expect(row(page).getByText('abcd1234-0000-4000-8000-000000000000')).toBeVisible()
    await expect(row(page).getByText(/shown once/)).toBeVisible()
    expect(posts[2]).toEqual({
      path: '/mint',
      body: { identityUserId: IDENTITY, assertion: ASSERTION, totp: '654321' }
    })
    expect(await page.evaluate(() => (window as unknown as { __taps: number }).__taps)).toBe(2)

    // Hide drops the key for good; the credential stays listed by prefix.
    await row(page).getByRole('button', { name: 'Hide' }).click()
    await expect(row(page).getByText('abcd1234-0000-4000-8000-000000000000')).toHaveCount(0)
    await expect(row(page).getByText(/abcd1234…/)).toBeVisible()

    // 3. Revoke it.
    await row(page).getByRole('button', { name: 'Revoke' }).click()
    await expect.poll(() => posts[3]).toEqual({ path: '/revoke', body: { prefix: 'abcd1234' } })
    await expect(row(page).getByText(/abcd1234…/)).toHaveCount(0)
  })
})
