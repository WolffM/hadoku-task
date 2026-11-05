import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * The settings popout's Account tab, the parts behind a second factor:
 *   - Authenticator (Authenticator.tsx): offered once a passkey is saved, set
 *     up with a passkey tap, then a code makes a one-time sign-in link;
 *   - Service access (ServiceAccess.tsx): a grantee mints a 7-day credential
 *     with a passkey tap and a code from that same authenticator.
 *
 * The edge routes are a stateful stand-in; the passkey tap is a stand-in
 * /auth/sign-in.js exporting `stepUpPasskey`, as settings-passkey.spec.ts does
 * for its ceremonies. The real routes are pinned in hadoku_site's
 * workers/edge-router/test/authenticator.test.ts and service-access.test.ts.
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

async function boot(
  page: Page,
  serviceGrants: number,
  who: { userType?: string; passkeys?: number } = {}
) {
  const userType = who.userType ?? 'friend'
  await page.route('**/prefs/api/**', route => json(route, {}))
  // The Account tab mounts Linked accounts, which reads the avatar settings.
  await page.route('**/prefs/api/v1/_avatar', route =>
    json(route, { linked: {}, providers: { discord: true, steam: true } })
  )
  await page.route('**/session/whoami', route =>
    json(route, {
      valid: true,
      userType,
      name: 'alice',
      passkeys: who.passkeys ?? 1,
      serviceGrants
    })
  )
  await page.route('**/task/api/boards**', route =>
    json(route, { version: 1, updatedAt: new Date().toISOString(), boards: [] })
  )
  await page.route('**/auth/sign-in.js*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `export async function signIn() { throw new Error('unused') }
        window.__taps = []
        export async function stepUpPasskey(opts) {
          window.__taps.push(opts ? opts.challengePath : null)
          return ${JSON.stringify(ASSERTION)}
        }`
    })
  )
  await page.addInitScript(t => {
    localStorage.setItem('hadoku_session_id', 'svc-session')
    localStorage.setItem('hadoku_user_type', t)
  }, userType)
}

const taps = (page: Page) =>
  page.evaluate(() => (window as unknown as { __taps: (string | null)[] }).__taps)

/**
 * The edge's authenticator, sign-in link and service-access routes, sharing
 * one authenticator, keeping what the popout posted. `linkRefusals` are the
 * errors the next sign-in-link posts answer, in order.
 */
function edge(page: Page, linkRefusals: string[] = []) {
  const posts: { path: string; body: Record<string, unknown> }[] = []
  let totp: 'none' | 'active' = 'none'
  let credentials: unknown[] = []
  const now = Date.now()
  void page.route('**/session/authenticator**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'GET') return json(route, { passkeys: 1, totp })
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    posts.push({ path, body })
    if (path === '/session/authenticator/start') {
      return json(route, {
        uri: 'otpauth://totp/hadoku.me:alice?secret=JBSWY3DPEHPK3PXP&issuer=hadoku.me',
        secret: 'JBSWY3DPEHPK3PXP'
      })
    }
    if (path === '/session/authenticator/confirm') {
      totp = 'active'
      return json(route, { ok: true })
    }
    return json(route, { error: 'unexpected' }, 404)
  })
  void page.route('**/session/sign-in-link', async route => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    posts.push({ path: '/session/sign-in-link', body })
    const refusal = linkRefusals.shift()
    if (refusal) return json(route, { error: refusal }, refusal === 'locked' ? 429 : 403)
    return json(route, {
      code: 'K7QM-3XRA-9P2D',
      link: 'https://hadoku.me/auth?key=K7QM-3XRA-9P2D',
      expiresAt: Date.now() + 15 * 60_000
    })
  })
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

async function openAccount(page: Page, userType = 'friend') {
  await page.goto(`/?userType=${userType}`)
  await page.waitForSelector(APP_HEADER, { timeout: 15000 })
  await page.getByRole('button', { name: 'User settings' }).click()
  const panel = page.locator('.settings-popout__panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('tab', { name: 'Account' }).click()
  await expect(panel.getByText('Linked accounts', { exact: true })).toBeVisible({ timeout: 5000 })
  return panel
}

const row = (page: Page) => page.getByRole('region', { name: 'Service access' })
const auth = (page: Page) => page.getByRole('region', { name: 'Authenticator' })

/** Set up the authenticator: a passkey tap, the QR and secret, one code. */
async function setUp(page: Page) {
  await auth(page).getByRole('button', { name: 'Set up' }).click()
  await expect(auth(page).getByRole('img', { name: 'Authenticator QR code' })).toBeVisible()
  await expect(auth(page).getByText('JBSWY3DPEHPK3PXP')).toBeVisible()
  await auth(page).getByLabel('Authenticator code').fill('123456')
  await auth(page).getByRole('button', { name: 'Confirm' }).click()
  await expect(auth(page).getByText('On', { exact: true })).toBeVisible()
}

test.describe('settings authenticator and sign-in link', () => {
  test('not offered without a saved passkey, and nothing fetched', async ({ page }) => {
    await boot(page, 0, { userType: 'member', passkeys: 0 })
    let fetched = 0
    page.on('request', r => {
      if (r.url().includes('/session/authenticator')) fetched++
    })
    await openAccount(page, 'member')
    await expect(auth(page)).toHaveCount(0)
    expect(fetched).toBe(0)
  })

  test('a member sets one up with a passkey tap, then makes a sign-in link', async ({ page }) => {
    await boot(page, 0, { userType: 'member' })
    const posts = edge(page)
    await openAccount(page, 'member')
    await expect(auth(page).getByRole('button', { name: 'Make link' })).toHaveCount(0)

    await setUp(page)
    expect(posts.slice(0, 2)).toEqual([
      { path: '/session/authenticator/start', body: { assertion: ASSERTION } },
      { path: '/session/authenticator/confirm', body: { code: '123456' } }
    ])
    // The tap was challenged by the authenticator's own route.
    expect(await taps(page)).toEqual(['/session/authenticator/challenge'])

    await auth(page).getByLabel('Authenticator code').fill('654321')
    await auth(page).getByRole('button', { name: 'Make link' }).click()
    await expect(auth(page).getByText('https://hadoku.me/auth?key=K7QM-3XRA-9P2D')).toBeVisible()
    await expect(auth(page).getByRole('img', { name: 'Sign-in link QR code' })).toBeVisible()
    await expect(auth(page).getByText('15 min, works once')).toBeVisible()
    expect(posts[2]).toEqual({ path: '/session/sign-in-link', body: { code: '654321' } })
    // No passkey tap for a link: the code is the second factor.
    expect(await taps(page)).toHaveLength(1)

    await auth(page).getByRole('button', { name: 'Hide' }).click()
    await expect(auth(page).getByText(/auth\?key=/)).toHaveCount(0)
  })

  test('says why a code was refused', async ({ page }) => {
    await boot(page, 0, { userType: 'member' })
    edge(page, ['wrong', 'locked'])
    await openAccount(page, 'member')
    await setUp(page)
    const make = async () => {
      await auth(page).getByLabel('Authenticator code').fill('000000')
      await auth(page).getByRole('button', { name: 'Make link' }).click()
    }
    await make()
    await expect(auth(page).getByRole('alert')).toHaveText('That code is not right')
    await make()
    await expect(auth(page).getByRole('alert')).toHaveText('Too many wrong codes; try again later')
  })
})

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
    // No heading: until the authenticator is on, it says what minting takes.
    await expect(page.getByText('Service access', { exact: true })).toHaveCount(0)
    await expect(row(page).getByText(/set it up above/)).toBeVisible()

    // 1. The authenticator, in its own section; minting appears without a reload.
    await setUp(page)

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
    // Set up was challenged by the authenticator; the mint, by service access.
    expect(await taps(page)).toEqual(['/session/authenticator/challenge', null])

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
