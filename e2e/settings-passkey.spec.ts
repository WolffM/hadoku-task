import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * The settings popout's passkey controls and display name, interrupted at
 * every point a person can interrupt them.
 *
 * The popout never runs a WebAuthn ceremony itself: it calls the site's
 * /auth/sign-in.js (`addPasskey`, `signInWithPasskey`). Each test serves a
 * stand-in module with exactly the behaviour under test — answering, refusing,
 * or never answering at all, which is what a password manager does when its
 * prompt is dismissed. The stand-ins IGNORE the abort signal unless a test
 * says otherwise, so a passing test proves the popout lets go on its own.
 * The real ceremony is hadoku_site's workers/edge-router/e2e/passkey-ceremony.e2e.ts.
 */

const APP_HEADER = 'h1.app-header__title'

async function mockWhoami(
  page: Page,
  identity: { userType: string; name: string | null; passkeys?: number }
) {
  await page.route('**/session/whoami', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, ...identity })
    })
  )
}

/** Serve a stand-in /auth/sign-in.js. `body` is the module's source. */
async function signInModule(page: Page, body: string) {
  // The trailing `*`: vite dev appends `?import` to a dynamic import's URL.
  await page.route('**/auth/sign-in.js*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `export async function signIn() { throw new Error('unused') }\n${body}`
    })
  )
}

/**
 * A passkey call that settles only when the test says so. `window.__settle`
 * resolves the current call ('ok') or rejects it with a message; calls and
 * the signals they were given are counted.
 */
const HELD = (name: string, result: string) => `
  window.__calls = 0
  window.__aborted = 0
  export function ${name}(opts) {
    window.__calls++
    if (opts && opts.signal) opts.signal.addEventListener('abort', () => window.__aborted++)
    return new Promise((resolve, reject) => {
      window.__settle = msg => (msg === 'ok' ? resolve(${result}) : reject(new Error(msg)))
    })
  }`

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calls: number }).__calls)
const aborted = (page: Page) =>
  page.evaluate(() => (window as unknown as { __aborted: number }).__aborted)
/**
 * Waits for the `n`th held prompt to be OPEN. The click loads the site's
 * sign-in client first (a dynamic import), so an abort sent straight after it
 * can land during the load, where it is honoured before any prompt exists:
 * `aborted` then reads 0. A settle sent that early finds no `__settle`, or the
 * previous call's. Either way the test fails under load for a reason it is not
 * about.
 */
const promptOpen = (page: Page, n = 1) => expect.poll(() => calls(page)).toBe(n)
const settle = (page: Page, msg: string) =>
  page.evaluate(m => (window as unknown as { __settle: (m: string) => void }).__settle(m), msg)

async function openSettings(page: Page, tab: 'Account' | 'Profile' = 'Account') {
  await page.getByRole('button', { name: 'User settings' }).click()
  const panel = page.locator('.settings-popout__panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('tab', { name: tab }).click()
  return panel
}

async function load(page: Page) {
  await page.goto('/')
  await page.waitForSelector(APP_HEADER, { timeout: 10000 })
}

test.describe('settings popout: asks someone with no passkey to save one', () => {
  const dot = (page: Page) => page.locator('.settings-toggle-btn__dot')
  const animation = (el: Locator) => el.evaluate(n => getComputedStyle(n).animationName)

  test('no passkey: a dot on the gear and Save passkey leads, both gone once saved', async ({
    page
  }) => {
    await mockWhoami(page, { userType: 'friend', name: 'alice', passkeys: 0 })
    await signInModule(page, HELD('addPasskey', '{ saved: true, passkeys: 1 }'))
    await load(page)
    await expect(dot(page)).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'User settings, no passkey saved' })
    ).toBeVisible()
    const panel = await openSettings(page)
    const save = panel.getByRole('button', { name: 'Save passkey' })
    await expect(save).toHaveClass(/settings-popout__btn--primary/)
    expect(await animation(save)).toBe('settings-passkey-pulse')
    await save.click()
    await promptOpen(page)
    await settle(page, 'ok')
    const saved = panel.getByRole('button', { name: 'Passkey saved' })
    await expect(saved).toBeVisible()
    expect(await animation(saved)).toBe('none')
    await expect(dot(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'User settings', exact: true })).toBeVisible()
  })

  test('no pulse for someone who asked for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mockWhoami(page, { userType: 'friend', name: 'alice', passkeys: 0 })
    await signInModule(page, HELD('addPasskey', '{ saved: true, passkeys: 1 }'))
    await load(page)
    const panel = await openSettings(page)
    const save = panel.getByRole('button', { name: 'Save passkey' })
    await expect(save).toHaveClass(/settings-popout__btn--primary/)
    expect(await animation(save)).toBe('none')
  })

  for (const [why, identity] of [
    ['already has one', { userType: 'friend', name: 'alice', passkeys: 1 }],
    ['an edge that does not say', { userType: 'friend', name: 'alice' }],
    ['a guest', { userType: 'public', name: null, passkeys: 0 }]
  ] as const) {
    test(`no prompt for ${why}`, async ({ page }) => {
      await mockWhoami(page, identity)
      await signInModule(page, HELD('addPasskey', '{ saved: true, passkeys: 1 }'))
      await load(page)
      await expect(page.getByRole('button', { name: 'User settings', exact: true })).toBeVisible()
      await expect(dot(page)).toHaveCount(0)
      if (identity.userType === 'public') return
      const panel = await openSettings(page)
      await expect(panel.getByRole('button', { name: 'Save passkey' })).not.toHaveClass(
        /settings-popout__btn--primary/
      )
    })
  }
})

test.describe('settings popout: save a passkey', () => {
  test.beforeEach(async ({ page }) => {
    await mockWhoami(page, { userType: 'friend', name: 'alice' })
  })

  test('sits on the Access key row, next to Switch key', async ({ page }) => {
    await signInModule(page, HELD('addPasskey', '{ saved: true, passkeys: 1 }'))
    await load(page)
    const panel = await openSettings(page)
    const row = panel.locator('section', { hasText: 'Access key' })
    await expect(row.getByRole('button', { name: 'Save passkey' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Switch key' })).toBeVisible()
    await expect(panel.getByText('Passkey', { exact: true })).toHaveCount(0)
  })

  test('saves, and says so', async ({ page }) => {
    await signInModule(page, HELD('addPasskey', '{ saved: true, passkeys: 1 }'))
    await load(page)
    const panel = await openSettings(page)
    await panel.getByRole('button', { name: 'Save passkey' }).click()
    await expect(panel.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    await promptOpen(page)
    await settle(page, 'ok')
    await expect(panel.getByRole('button', { name: 'Passkey saved' })).toBeDisabled()
    await expect(panel.getByRole('alert')).toHaveCount(0)
  })

  test("the site's refusal is shown, and a retry works", async ({ page }) => {
    await signInModule(page, HELD('addPasskey', '{ saved: true, passkeys: 1 }'))
    await load(page)
    const panel = await openSettings(page)
    await panel.getByRole('button', { name: 'Save passkey' }).click()
    await promptOpen(page)
    await settle(page, 'This device already has your passkey')
    await expect(panel.getByRole('alert')).toHaveText('This device already has your passkey')
    await panel.getByRole('button', { name: 'Save passkey' }).click()
    await expect(panel.getByRole('alert')).toHaveCount(0)
    await promptOpen(page, 2)
    await settle(page, 'ok')
    await expect(panel.getByRole('button', { name: 'Passkey saved' })).toBeVisible()
  })

  test('a prompt that never answers: Cancel lets go, even when the client ignores it', async ({
    page
  }) => {
    await signInModule(page, HELD('addPasskey', '{ saved: true, passkeys: 1 }'))
    await load(page)
    const panel = await openSettings(page)
    await panel.getByRole('button', { name: 'Save passkey' }).click()
    await promptOpen(page)
    // No switching mid-prompt; Cancel is on its own line.
    await expect(panel.getByRole('button', { name: 'Switch key' })).toBeDisabled()
    await panel.getByRole('button', { name: 'Cancel' }).click()
    await expect(panel.getByRole('alert')).toHaveText('Passkey not saved')
    await expect(panel.getByRole('button', { name: 'Save passkey' })).toBeEnabled()
    await expect(panel.getByRole('button', { name: 'Switch key' })).toBeEnabled()
    await expect(panel.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
    expect(await aborted(page)).toBe(1)

    // The abandoned call answering late changes nothing.
    await settle(page, 'ok')
    await expect(panel.getByRole('button', { name: 'Save passkey' })).toBeEnabled()

    await panel.getByRole('button', { name: 'Save passkey' }).click()
    await promptOpen(page, 2)
    await settle(page, 'ok')
    await expect(panel.getByRole('button', { name: 'Passkey saved' })).toBeVisible()
  })

  test('closing the popout mid-prompt abandons it quietly', async ({ page }) => {
    await signInModule(page, HELD('addPasskey', '{ saved: true, passkeys: 1 }'))
    await load(page)
    let panel = await openSettings(page)
    await panel.getByRole('button', { name: 'Save passkey' }).click()
    await promptOpen(page)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    expect(await aborted(page)).toBe(1)

    panel = await openSettings(page)
    await expect(panel.getByRole('alert')).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Save passkey' })).toBeEnabled()
  })

  test('a double click saves once', async ({ page }) => {
    await signInModule(page, HELD('addPasskey', '{ saved: true, passkeys: 1 }'))
    await load(page)
    const panel = await openSettings(page)
    await panel.getByRole('button', { name: 'Save passkey' }).dblclick()
    await expect(panel.getByRole('button', { name: 'Saving…' })).toBeVisible()
    expect(await calls(page)).toBe(1)
    expect(await aborted(page)).toBe(0)
  })

  test('clicking outside the popout during a prompt closes it and abandons the prompt', async ({
    page
  }) => {
    await signInModule(page, HELD('addPasskey', '{ saved: true, passkeys: 1 }'))
    await load(page)
    const panel = await openSettings(page)
    await panel.getByRole('button', { name: 'Save passkey' }).click()
    await promptOpen(page)
    await page.locator('.settings-popout__overlay').click({ position: { x: 5, y: 5 } })
    await expect(panel).toBeHidden()
    expect(await aborted(page)).toBe(1)
  })

  test('a site client without passkeys sends you to /auth to save one', async ({ page }) => {
    await signInModule(page, '')
    await page.route(/\/auth\?/, route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>auth</h1>' })
    )
    await load(page)
    const panel = await openSettings(page)
    await panel.getByRole('button', { name: 'Save passkey' }).click()
    await page.waitForURL(/\/auth\?/)
    const url = new URL(page.url())
    expect(url.searchParams.get('passkey')).toBe('add')
    expect(url.searchParams.get('return')).toBe('/')
  })

  test('a public visitor is not offered one', async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await mockWhoami(page, { userType: 'public', name: null })
    await load(page)
    const panel = await openSettings(page)
    await expect(panel.getByRole('button', { name: 'Save passkey' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Switch key' })).toBeVisible()
  })
})

test.describe('settings popout: sign in with a passkey', () => {
  test.beforeEach(async ({ page }) => {
    await mockWhoami(page, { userType: 'public', name: null })
  })

  async function openKeyForm(page: Page) {
    const panel = await openSettings(page)
    await panel.getByRole('button', { name: 'Switch key' }).click()
    return panel.locator('form')
  }

  const SIGNED_IN = `(localStorage.setItem('hadoku_user_type', 'friend'), { valid: true, userType: 'friend' })`

  test('signs in, then reloads as the new identity', async ({ page }) => {
    await signInModule(page, HELD('signInWithPasskey', SIGNED_IN))
    await load(page)
    const form = await openKeyForm(page)
    await form.getByRole('button', { name: 'Use a passkey' }).click()
    await expect(form.getByLabel('Access key')).toBeDisabled()
    await promptOpen(page)
    const reloaded = page.waitForEvent('load')
    await settle(page, 'ok')
    await reloaded
    expect(await page.evaluate(() => localStorage.getItem('hadoku_user_type'))).toBe('friend')
  })

  test('a prompt that never answers: Cancel gives the form back', async ({ page }) => {
    await signInModule(page, HELD('signInWithPasskey', SIGNED_IN))
    await load(page)
    const form = await openKeyForm(page)
    await form.getByRole('button', { name: 'Use a passkey' }).click()
    await expect(form.getByRole('button', { name: 'Waiting for passkey…' })).toBeDisabled()
    await promptOpen(page)
    await form.getByRole('button', { name: 'Cancel' }).click()
    await expect(form.getByRole('alert')).toHaveText('Passkey sign-in cancelled')
    await expect(form.getByLabel('Access key')).toBeEnabled()
    await expect(form.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    await expect(form.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
    expect(await aborted(page)).toBe(1)
  })

  test("the site's refusal is shown inline, with no navigation", async ({ page }) => {
    await signInModule(page, HELD('signInWithPasskey', SIGNED_IN))
    await load(page)
    const form = await openKeyForm(page)
    await form.getByRole('button', { name: 'Use a passkey' }).click()
    await promptOpen(page)
    await settle(page, 'That passkey was retired with its key. Ask for a new login code.')
    await expect(form.getByRole('alert')).toHaveText(
      'That passkey was retired with its key. Ask for a new login code.'
    )
    await expect(form.getByRole('button', { name: 'Use a passkey' })).toBeEnabled()
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('a double click starts one prompt and cannot cancel it', async ({ page }) => {
    await signInModule(page, HELD('signInWithPasskey', SIGNED_IN))
    await load(page)
    const form = await openKeyForm(page)
    await form.getByRole('button', { name: 'Use a passkey' }).dblclick()
    await expect(form.getByRole('button', { name: 'Waiting for passkey…' })).toBeVisible()
    expect(await calls(page)).toBe(1)
    expect(await aborted(page)).toBe(0)
  })

  test('closing the popout mid-prompt leaves the form usable', async ({ page }) => {
    await signInModule(page, HELD('signInWithPasskey', SIGNED_IN))
    await load(page)
    const form = await openKeyForm(page)
    await form.getByRole('button', { name: 'Use a passkey' }).click()
    await promptOpen(page)
    await page.keyboard.press('Escape')
    expect(await aborted(page)).toBe(1)
    const panel = await openSettings(page)
    await expect(panel.getByRole('alert')).toHaveCount(0)
    await expect(panel.getByLabel('Access key')).toBeEnabled()
  })
})

test.describe('settings popout: display name', () => {
  test.beforeEach(async ({ page }) => {
    await mockWhoami(page, { userType: 'friend', name: 'alice' })
  })

  test('click the name to edit it; Enter saves', async ({ page }) => {
    const posted: string[] = []
    await page.route('**/session/name', async route => {
      const { name } = route.request().postDataJSON() as { name: string }
      posted.push(name)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, name })
      })
    })
    await load(page)
    const panel = await openSettings(page, 'Profile')
    await expect(panel.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Edit display name' }).click()
    const input = panel.locator('section', { hasText: 'Display name' }).getByRole('textbox')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('alice')
    await input.fill('Alice W')
    await input.press('Enter')
    await expect(panel.getByRole('button', { name: 'Edit display name' })).toHaveText('Alice W')
    expect(posted).toEqual(['Alice W'])
  })

  test('a refused name keeps the editor open and says why', async ({ page }) => {
    let refuse = true
    await page.route('**/session/name', route =>
      refuse
        ? route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'That display name is already taken' })
          })
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, name: 'Alice W' })
          })
    )
    await load(page)
    const panel = await openSettings(page, 'Profile')
    await panel.getByRole('button', { name: 'Edit display name' }).click()
    const input = panel.locator('section', { hasText: 'Display name' }).getByRole('textbox')
    await input.fill('Bob')
    await input.press('Enter')
    await expect(panel.getByRole('alert')).toHaveText('That display name is already taken')
    await expect(input).toHaveValue('Bob')
    await expect(input).toHaveAttribute('aria-invalid', 'true')

    // Typing clears the reason; a name that is free saves.
    refuse = false
    await input.fill('Alice W')
    await expect(panel.getByRole('alert')).toHaveCount(0)
    await input.press('Enter')
    await expect(panel.getByRole('button', { name: 'Edit display name' })).toHaveText('Alice W')
  })

  test('Escape abandons the edit and posts nothing', async ({ page }) => {
    const posted: string[] = []
    await page.route('**/session/name', route => {
      posted.push('x')
      return route.fulfill({ status: 200, body: '{}' })
    })
    await load(page)
    const panel = await openSettings(page, 'Profile')
    await panel.getByRole('button', { name: 'Edit display name' }).click()
    const input = panel.locator('section', { hasText: 'Display name' }).getByRole('textbox')
    await input.fill('nope')
    await input.press('Escape')
    // Escape ends the edit; the popout stays open.
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Edit display name' })).toHaveText('alice')
    expect(posted).toEqual([])
  })
})

test.describe('settings popout: a member deletes their own account', () => {
  test('two separate clicks, then gone; nobody else sees the control', async ({ page }) => {
    await mockWhoami(page, { userType: 'member', name: 'Stranger', passkeys: 1 })
    let deletes = 0
    await page.route('**/session/account/delete', route => {
      deletes++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deleted: true })
      })
    })
    await load(page)
    const panel = await openSettings(page, 'Profile')
    await expect(panel.getByText('Member', { exact: true })).toBeVisible()
    await panel.getByRole('tab', { name: 'Account' }).click()

    // A double click on Delete never confirms: the confirm is a separate button.
    await panel.getByRole('button', { name: 'Delete account' }).dblclick()
    await expect(panel.getByRole('button', { name: 'Delete for good' })).toBeVisible()
    expect(deletes).toBe(0)

    // Keep backs out; the next try confirms.
    await panel.getByRole('button', { name: 'Keep' }).click()
    await panel.getByRole('button', { name: 'Delete account' }).click()
    await Promise.all([
      page.waitForURL(url => url.pathname === '/'),
      panel.getByRole('button', { name: 'Delete for good' }).click()
    ])
    expect(deletes).toBe(1)
  })

  test('a friend has no delete control', async ({ page }) => {
    await mockWhoami(page, { userType: 'friend', name: 'alice', passkeys: 1 })
    await load(page)
    const panel = await openSettings(page)
    await expect(panel.getByRole('button', { name: 'Delete account' })).toHaveCount(0)
  })
})
