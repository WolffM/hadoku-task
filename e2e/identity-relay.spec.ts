import { test, expect, type Page } from '@playwright/test'

/**
 * A rename made in the gear reaches every other hadoku tab of the browser,
 * on a page with no room mounted (task-ui-components' identityRelay, started by
 * ConnectedSettings). The other tab hears it as the same `hadoku:name` window
 * event the gear fires locally — exactly what a room's identity sync listens
 * for — once, and the renaming tab never hears its own change echoed back.
 *
 * Two pages of ONE context are two tabs of one browser: they share the origin,
 * so a BroadcastChannel joins them.
 */

const APP_HEADER = 'h1.app-header__title'

async function load(page: Page) {
  await page.goto('/')
  await page.waitForSelector(APP_HEADER, { timeout: 10000 })
  await page.evaluate(() => {
    const w = window as unknown as { __names: unknown[]; __avatars: unknown[] }
    w.__names = []
    w.__avatars = []
    window.addEventListener('hadoku:name', e =>
      w.__names.push((e as Event & { detail: unknown }).detail)
    )
    window.addEventListener('hadoku:avatar', e =>
      w.__avatars.push((e as Event & { detail: unknown }).detail)
    )
  })
}

const heard = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __names: unknown[]; __avatars: unknown[] }
    return { names: w.__names, avatars: w.__avatars }
  })

test('a rename in the gear reaches another tab of the same browser, once, with no echo', async ({
  context
}) => {
  await context.route('**/session/whoami', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, userType: 'friend', name: 'alice', passkeys: 1 })
    })
  )
  await context.route('**/session/name', route => {
    const { name } = route.request().postDataJSON() as { name: string }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, name })
    })
  })

  const renaming = await context.newPage()
  const room = await context.newPage()
  await load(renaming)
  await load(room)

  await renaming.getByRole('button', { name: 'User settings' }).click()
  const panel = renaming.locator('.settings-popout__panel')
  await panel.getByRole('tab', { name: 'Profile' }).click()
  await panel.getByRole('button', { name: 'Edit display name' }).click()
  const input = panel.locator('section', { hasText: 'Display name' }).getByRole('textbox')
  await input.fill('Alice W')
  await input.press('Enter')
  await expect(panel.getByRole('button', { name: 'Edit display name' })).toHaveText('Alice W')

  await expect.poll(async () => (await heard(room)).names).toEqual([{ name: 'Alice W' }])

  // An avatar change crosses the same way, from the other direction.
  await room.evaluate(() =>
    window.dispatchEvent(new window.CustomEvent('hadoku:avatar', { detail: { sprite: 'mage' } }))
  )
  await expect.poll(async () => (await heard(renaming)).avatars).toEqual([{ sprite: 'mage' }])

  // Nothing bounced back: each tab heard each change exactly once.
  expect(await heard(renaming)).toEqual({
    names: [{ name: 'Alice W' }],
    avatars: [{ sprite: 'mage' }]
  })
  expect(await heard(room)).toEqual({
    names: [{ name: 'Alice W' }],
    avatars: [{ sprite: 'mage' }]
  })
})

test('one relay per window: a page that starts it again, from another copy of the package, adds no duplicates', async ({
  context
}) => {
  await context.route('**/session/whoami', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, userType: 'friend', name: 'alice', passkeys: 1 })
    })
  )
  const a = await context.newPage()
  const b = await context.newPage()
  await load(a)
  await load(b)
  // A room in tab b starts the relay too, from two separately bundled copies
  // (watchparty-ui's chrome beside the host's gear): two distinct module
  // instances, as the query strings make them.
  const src = `/@fs${process.cwd()}/task-ui-components/src/lib/identityRelay.ts`
  await b.evaluate(async src => {
    const one = await import(/* @vite-ignore */ `${src}?copy=1`)
    const two = await import(/* @vite-ignore */ `${src}?copy=2`)
    ;(window as unknown as { __stops: Array<() => void> }).__stops = [
      one.relayIdentityChanges(),
      two.relayIdentityChanges()
    ]
  }, src)

  await a.evaluate(() =>
    window.dispatchEvent(new window.CustomEvent('hadoku:name', { detail: { name: 'Once' } }))
  )
  await b.evaluate(() =>
    window.dispatchEvent(new window.CustomEvent('hadoku:avatar', { detail: { sprite: 'sage' } }))
  )
  await expect.poll(async () => (await heard(a)).avatars).toEqual([{ sprite: 'sage' }])
  await expect.poll(async () => (await heard(b)).names).toEqual([{ name: 'Once' }])

  // The extra starts stopping leaves the gear's relay running.
  await b.evaluate(() =>
    (window as unknown as { __stops: Array<() => void> }).__stops.forEach(s => s())
  )
  await a.evaluate(() =>
    window.dispatchEvent(new window.CustomEvent('hadoku:name', { detail: { name: 'Still' } }))
  )
  await expect
    .poll(async () => (await heard(b)).names)
    .toEqual([{ name: 'Once' }, { name: 'Still' }])
  expect((await heard(a)).avatars).toEqual([{ sprite: 'sage' }])
})
