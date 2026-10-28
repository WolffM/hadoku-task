import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for switching keys and for session persistence.
 *
 * The settings popout (shared ConnectedSettings, the gear in the AppHeader)
 * never creates a session itself. Only the site's sign-in code may — it carries
 * the edge-signed funnel token and the device fingerprint that /session/create
 * requires. "Switch key" therefore signs in inline through the
 * site's own sign-in client (/auth/sign-in.js, the /auth page's code path),
 * and falls back to /auth?switch=1&return=<this page> only when that client
 * can't be loaded. The host owns the session: the app reads what it stored,
 * never rewrites it, and sends no session handshake of its own.
 */

const APP_HEADER = 'h1.app-header__title'

/** Open the shared settings popout via the header gear. */
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'User settings' }).click()
  await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })
}

/** Mock the whoami identity ConnectedSettings GETs when the popout opens. */
async function mockWhoami(page: Page, identity: { userType: string; name: string | null }) {
  await page.route('**/session/whoami', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, ...identity })
    })
  })
}

test.describe('Key Validation Flow', () => {
  // Note: We don't use addInitScript to clear localStorage because it runs
  // on every navigation including reloads, which would clear the session
  // data stored by the swap flow before the reload completes.

  test('should start as public user with no stored session', async ({ page }) => {
    // Clear localStorage on initial load only
    await page.addInitScript(() => localStorage.clear())
    await page.goto('/')

    // Wait for app to load by checking for the header
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    // A public user keys local data by the app's own anon id. The host-owned
    // session keys stay untouched — the app never writes them.
    const stored = await page.evaluate(() => ({
      anon: localStorage.getItem('task_anon_session_id'),
      session: localStorage.getItem('hadoku_session_id'),
      userType: localStorage.getItem('hadoku_user_type')
    }))
    expect(stored.anon).toMatch(/^public-/)
    expect(stored.session).toBeNull()
    expect(stored.userType).toBeNull()
  })

  test('Switch key falls back to /auth when the sign-in client is not served', async ({ page }) => {
    // The vite dev server is not hadoku.me: /auth/sign-in.js 404s, so the only
    // way to sign in is the page-level flow. Answer /auth with a stub page so the
    // navigation lands somewhere observable.
    await mockWhoami(page, { userType: 'public', name: null })
    await page.route('**/auth/sign-in.js*', route => route.fulfill({ status: 404, body: '' }))
    await page.route(/\/auth\?/, route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>auth</h1>' })
    )
    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    // A page address with every part /auth has to hand back, including
    // characters that must survive encoding.
    const here = '/board/two%20words?view=calendar&sort=a+b#lane-3'
    await page.evaluate(url => window.history.replaceState(null, '', url), here)

    await openSettings(page)
    await page.getByRole('button', { name: 'Switch key' }).click()

    await page.waitForURL(/\/auth\?/)
    const url = new URL(page.url())
    expect(url.pathname).toBe('/auth')
    expect(url.searchParams.get('switch')).toBe('1')
    expect(url.searchParams.get('return')).toBe(here)
  })

  test('Switch key signs in inline: busy state, inline refusal, reload on success', async ({
    page
  }) => {
    await mockWhoami(page, { userType: 'public', name: null })
    // A stand-in for hadoku.me's /auth/sign-in.js, honouring its contract:
    // `signIn(key)` resolves on success and throws Error(message) on a refusal.
    // It holds each call until the spec releases it, so the busy state is
    // observable rather than a race. (prod-inline-sign-in.spec.ts drives the
    // real module.) The trailing `*` matters: vite dev appends `?import` to a
    // dynamic import's URL; a production build does not.
    await page.route('**/auth/sign-in.js*', route =>
      route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `
          window.__signInCalls = 0
          export async function signIn(key) {
            window.__signInCalls++
            await new Promise(r => { window.__releaseSignIn = r })
            if (key !== 'good-key') throw new Error('Invalid key')
            localStorage.setItem('hadoku_user_type', 'friend')
            return { valid: true, userType: 'friend', sessionId: 'inline-session' }
          }`
      })
    )
    const sessionCreates: string[] = []
    page.on('request', r => {
      if (r.url().includes('/session/create')) sessionCreates.push(r.url())
    })

    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })
    await openSettings(page)
    await page.getByRole('button', { name: 'Switch key' }).click()

    // A real form a password manager recognises.
    const form = page.locator('.settings-popout__panel form')
    const key = form.getByLabel('Access key')
    await expect(key).toHaveAttribute('type', 'password')
    await expect(key).toHaveAttribute('autocomplete', 'current-password')
    await expect(form.locator('input[autocomplete="username"]')).toHaveValue('hadoku')

    // A refused key: busy while the call is out, then an inline error, no navigation.
    await key.fill('wrong-key')
    await form.getByRole('button', { name: 'Sign in' }).click()
    await expect(form.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
    await page.evaluate(() =>
      (window as unknown as { __releaseSignIn: () => void }).__releaseSignIn()
    )
    await expect(form.getByRole('alert')).toHaveText('Invalid key')
    expect(new URL(page.url()).pathname).not.toBe('/auth')

    // An accepted key reloads the page, which re-mounts as the new identity.
    await key.fill('good-key')
    await form.getByRole('button', { name: 'Sign in' }).click()
    const reloaded = page.waitForEvent('load')
    await page.evaluate(() =>
      (window as unknown as { __releaseSignIn: () => void }).__releaseSignIn()
    )
    await reloaded
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })
    expect(await page.evaluate(() => localStorage.getItem('hadoku_user_type'))).toBe('friend')
    expect(new URL(page.url()).pathname).not.toBe('/auth')

    // The site's client is the only thing that may create a session.
    expect(sessionCreates).toEqual([])
  })

  test('Use a passkey signs in inline through the site client, then reloads', async ({ page }) => {
    await mockWhoami(page, { userType: 'public', name: null })
    await page.route('**/auth/sign-in.js*', route =>
      route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `
          export async function signIn() { throw new Error('unused') }
          window.__passkeyCalls = 0
          export async function signInWithPasskey() {
            window.__passkeyCalls++
            if (window.__passkeyCalls === 1) throw new Error('Passkey sign-in cancelled')
            localStorage.setItem('hadoku_user_type', 'friend')
            return { valid: true, userType: 'friend', sessionId: 'pk-session' }
          }`
      })
    )
    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })
    await openSettings(page)
    await page.getByRole('button', { name: 'Switch key' }).click()
    const form = page.locator('.settings-popout__panel form')

    // A dismissed prompt is an inline message, not a navigation.
    await form.getByRole('button', { name: 'Use a passkey' }).click()
    await expect(form.getByRole('alert')).toHaveText('Passkey sign-in cancelled')

    const reloaded = page.waitForEvent('load')
    await form.getByRole('button', { name: 'Use a passkey' }).click()
    await reloaded
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })
    expect(await page.evaluate(() => localStorage.getItem('hadoku_user_type'))).toBe('friend')
  })

  test('a signed-in person saves a passkey from the popout', async ({ page }) => {
    await mockWhoami(page, { userType: 'friend', name: 'alice' })
    await page.route('**/auth/sign-in.js*', route =>
      route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `
          export async function signIn() { throw new Error('unused') }
          window.__addCalls = 0
          export async function addPasskey() {
            window.__addCalls++
            if (window.__addCalls === 1) throw new Error('This device already has your passkey')
            return { saved: true, passkeys: 1 }
          }`
      })
    )
    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })
    await openSettings(page)
    const panel = page.locator('.settings-popout__panel')

    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(panel.getByRole('alert')).toHaveText('This device already has your passkey')
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Saved' })).toBeDisabled()
    await expect(panel.getByRole('alert')).toHaveCount(0)
  })

  test('a public visitor is not offered to save a passkey', async ({ page }) => {
    await mockWhoami(page, { userType: 'public', name: null })
    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })
    await openSettings(page)
    await expect(page.locator('.settings-popout__panel').getByText('Passkey')).toHaveCount(0)
  })

  test('should persist session across page reloads', async ({ page }) => {
    // Pre-populate localStorage with session data
    await page.addInitScript(() => {
      localStorage.setItem('hadoku_session_id', 'persisted-session-456')
      localStorage.setItem('hadoku_user_type', 'admin')
    })

    const handshakes: string[] = []
    page.on('request', r => {
      if (r.url().includes('/session/handshake')) handshakes.push(r.url())
    })
    const boardHeaders: Record<string, string>[] = []
    page.on('request', r => {
      if (r.url().includes('/task/api/boards')) boardHeaders.push(r.headers())
    })

    // Mock the boards API
    await page.route('**/task/api/boards*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          boards: [
            {
              id: 'main',
              name: 'Main',
              tasks: [],
              tags: []
            }
          ]
        })
      })
    })

    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    // The board sync is the app's identity-bearing call: the session id rides
    // along for the edge, the retired X-User-Type does not.
    await expect.poll(() => boardHeaders.length).toBeGreaterThan(0)
    expect(boardHeaders[0]['x-session-id']).toBe('persisted-session-456')
    expect(boardHeaders[0]['x-user-type']).toBeUndefined()

    // Verify session data persists
    const sessionId = await page.evaluate(() => localStorage.getItem('hadoku_session_id'))
    const userType = await page.evaluate(() => localStorage.getItem('hadoku_user_type'))

    expect(sessionId).toBe('persisted-session-456')
    expect(userType).toBe('admin')

    // Reload and verify again
    await page.reload()
    await page.waitForSelector(APP_HEADER, { timeout: 10000 })

    const sessionIdAfterReload = await page.evaluate(() =>
      localStorage.getItem('hadoku_session_id')
    )
    const userTypeAfterReload = await page.evaluate(() => localStorage.getItem('hadoku_user_type'))

    expect(sessionIdAfterReload).toBe('persisted-session-456')
    expect(userTypeAfterReload).toBe('admin')

    expect(handshakes, 'the app sends no session handshake').toEqual([])
  })
})
