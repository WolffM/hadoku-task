import { test, expect } from '@playwright/test'

/**
 * Inline "Switch key" against production, through the site's REAL sign-in
 * client (hadoku.me/auth/sign-in.js — the /auth page's own code path: funnel
 * token, fingerprint, /session/create).
 *
 * key-validation.spec.ts covers the UI states against a stand-in module; this
 * is the one place the real module, the real funnel and a real session meet.
 *
 * Opt-in, like prod-cold-load: it signs in on production.
 *   RUN_PROD_SIGNIN=1                — required
 *   FRIEND_TEST_KEY=<key>            — required (vault: TASK_FRIEND_TEST_KEY)
 *   TASK_PROD_ORIGIN=https://...     — defaults to https://hadoku.me
 *
 *   node ../hadoku_site/scripts/secrets/dev-vault.mjs -- \
 *     sh -c 'RUN_PROD_SIGNIN=1 pnpm exec playwright test e2e/prod-inline-sign-in.spec.ts'
 */

const ORIGIN = process.env.TASK_PROD_ORIGIN ?? 'https://hadoku.me'
const KEY = process.env.FRIEND_TEST_KEY ?? ''

type Whoami = { valid?: boolean; userType?: string; userId?: string }

test.describe('Inline sign-in (production)', () => {
  test.skip(!process.env.RUN_PROD_SIGNIN, 'opt-in: set RUN_PROD_SIGNIN=1')
  test.skip(!KEY, 'FRIEND_TEST_KEY not set (run under dev-vault)')

  test('switches key inline, with no trip to /auth, and refuses a bad key inline', async ({
    page
  }) => {
    const authNavigations: string[] = []
    page.on('framenavigated', f => {
      if (f === page.mainFrame() && new URL(f.url()).pathname.startsWith('/auth')) {
        authNavigations.push(f.url())
      }
    })
    const consoleText: string[] = []
    page.on('console', m => consoleText.push(m.text()))

    const whoami = () =>
      page.evaluate(async () => {
        const r = await fetch('/session/whoami', { credentials: 'include', cache: 'no-store' })
        return (r.ok ? await r.json() : {}) as Whoami
      })

    await page.goto(`${ORIGIN}/task/`)
    await page.waitForSelector('h1.app-header__title', { timeout: 20000 })
    const before = await whoami()
    expect(before.userType ?? 'public', 'a fresh browser starts signed out').toBe('public')

    const openForm = async () => {
      await page.getByRole('button', { name: 'User settings' }).click()
      await page.getByRole('tab', { name: 'Account' }).click()
      await page.getByRole('button', { name: 'Switch key' }).click()
      return page.locator('.settings-popout__panel form')
    }

    // A refused key is an inline error, not a redirect.
    const form = await openForm()
    await form.getByLabel('Access key').fill('definitely-not-a-key')
    await form.getByRole('button', { name: 'Sign in' }).click()
    await expect(form.getByRole('alert')).toContainText(/invalid key/i, { timeout: 15000 })
    expect((await whoami()).userType ?? 'public').toBe('public')

    // The real key signs in and the page reloads as the new identity.
    await form.getByLabel('Access key').fill(KEY)
    const reloaded = page.waitForEvent('load', { timeout: 20000 })
    await form.getByRole('button', { name: 'Sign in' }).click()
    await reloaded
    await page.waitForSelector('h1.app-header__title', { timeout: 20000 })

    const after = await whoami()
    expect(after.valid, JSON.stringify(after)).toBe(true)
    expect(after.userType).not.toBe('public')
    expect(after.userType).not.toBe(before.userType)
    expect(new URL(page.url()).pathname).toBe('/task/')

    expect(authNavigations, 'never navigated to /auth').toEqual([])
    expect(
      consoleText.some(t => t.includes(KEY)),
      'the key never reaches the console'
    ).toBe(false)

    // The settings tier row reflects the switch too.
    await page.getByRole('button', { name: 'User settings' }).click()
    await page.getByRole('tab', { name: 'Profile' }).click()
    await expect(page.locator('.settings-popout__tier')).not.toHaveText('Guest')
  })
})
