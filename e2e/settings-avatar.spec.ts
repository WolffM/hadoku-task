import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * The Avatar row: the person's picture (character, Discord, Steam, upload) and
 * their character, chosen in place in the settings popout (AvatarPicker).
 *
 * Pinned here:
 *   - opening the gear fetches no avatar (settings-prefetch.spec.ts is why the
 *     popout costs no request); only Change loads it;
 *   - picking a character writes it through prefs-api, and the page never
 *     navigates;
 *   - linking signs in through a POPUP opened inside the click, and the picker
 *     re-reads its settings when the callback page reports back on the
 *     BroadcastChannel (hadoku_site src/pages/account/link/callback.astro).
 */

const APP_HEADER = 'h1.app-header__title'
const AVATAR_PATH = '/prefs/api/v1/_avatar'

const CHARACTERS = {
  pageSize: 8,
  sets: [
    {
      id: 'fantasy',
      characters: [
        {
          id: 'sage',
          name: 'Frieren',
          color: '#7f7c84',
          portrait: '/media/sprites/square_sage.png'
        },
        { id: 'mage', name: 'Fern', color: '#794983', portrait: '/media/sprites/square_mage.png' }
      ]
    }
  ]
}

function settings(over: Record<string, unknown> = {}) {
  return {
    avatar: { source: 'sprite', sprite: 'sage' },
    choice: null,
    sprite: 'sage',
    linked: {},
    upload: null,
    providers: { discord: true, steam: true },
    limits: {
      maxBytes: 5242880,
      minDimension: 64,
      maxDimension: 4096,
      acceptedTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      perDay: 10,
      outputSize: 256
    },
    ...over
  }
}

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

async function stubBoot(page: Page, userType: 'friend' | 'public') {
  await page.route('**/prefs/api/**', route => json(route, {}))
  await page.route('**/session/whoami', route =>
    json(
      route,
      userType === 'public'
        ? { valid: false, userType: 'public' }
        : { valid: true, userType, name: 'Avatar Tester' }
    )
  )
  await page.route('**/task/api/boards**', route =>
    json(route, { version: 1, updatedAt: new Date().toISOString(), boards: [] })
  )
  await page.route('**/watchparty/api/characters', route => json(route, CHARACTERS))
  await page.route('**/watchparty/media/**', route => route.fulfill({ status: 404, body: '' }))
  if (userType !== 'public') {
    await page.addInitScript(() => {
      localStorage.setItem('hadoku_session_id', 'avatar-session')
      localStorage.setItem('hadoku_user_type', 'friend')
    })
  }
}

async function openSettings(page: Page, userType: 'friend' | 'public') {
  await page.goto(`/?userType=${userType}`)
  await page.waitForSelector(APP_HEADER, { timeout: 15000 })
  await page.getByRole('button', { name: 'User settings' }).click()
  await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })
  await expect(page.locator('.settings-popout__tier')).toBeVisible({ timeout: 5000 })
}

const avatarRow = (page: Page) =>
  page.locator('.settings-popout__row', { has: page.getByText('Avatar', { exact: true }) })

test.describe('settings avatar row', () => {
  test('opening the gear fetches no avatar; Change loads it in place', async ({ page }) => {
    let avatarFetches = 0
    page.on('request', req => {
      if (req.url().includes(AVATAR_PATH)) avatarFetches++
    })
    await stubBoot(page, 'friend')
    await page.route(`**${AVATAR_PATH}`, route => json(route, settings()))
    await openSettings(page, 'friend')
    expect(avatarFetches, 'opening the gear fetched the avatar').toBe(0)

    await avatarRow(page).getByRole('button', { name: 'Change' }).click()
    await expect(avatarRow(page).getByRole('radio', { name: 'Fern' })).toBeVisible()
    expect(avatarFetches).toBe(1)
  })

  test('picking a character writes it, and the page stays put', async ({ page }) => {
    await stubBoot(page, 'friend')
    const puts: unknown[] = []
    let sprite = 'sage'
    await page.route(`**${AVATAR_PATH}`, async route => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { sprite?: string }
        puts.push(body)
        if (body.sprite) sprite = body.sprite
      }
      await json(route, settings({ sprite, avatar: { source: 'sprite', sprite } }))
    })
    await openSettings(page, 'friend')
    const url = page.url()
    await page.evaluate(() => {
      window.addEventListener('hadoku:avatar', e => {
        ;(window as unknown as { __avatar: unknown }).__avatar = (
          e as Event & { detail: unknown }
        ).detail
      })
    })
    await avatarRow(page).getByRole('button', { name: 'Change' }).click()
    await avatarRow(page).getByRole('radio', { name: 'Fern' }).click()
    await expect(avatarRow(page).getByRole('radio', { name: 'Fern' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(puts).toEqual([{ sprite: 'mage' }])
    // The host page hears the change (watchparty sends the new character on).
    const heard = await page.evaluate(
      () => (window as unknown as { __avatar?: { sprite?: string } }).__avatar?.sprite
    )
    expect(heard).toBe('mage')
    expect(page.url()).toBe(url)
  })

  test('linking opens a popup after the consent step, and reads back when it reports', async ({
    page,
    context
  }) => {
    await stubBoot(page, 'friend')
    let linked = false
    await page.route(`**${AVATAR_PATH}`, route =>
      json(
        route,
        linked
          ? settings({
              linked: {
                discord: {
                  avatarUrl: 'https://cdn.discordapp.com/avatars/1/abc.png',
                  linkedAt: 1,
                  refreshedAt: 1
                }
              }
            })
          : settings()
      )
    )
    await page.route(`**${AVATAR_PATH}/link/discord`, route =>
      json(route, { authorizeUrl: `${new URL(page.url()).origin}/fake-discord-consent` })
    )
    await context.route('**/fake-discord-consent', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>consent</p>' })
    )
    await openSettings(page, 'friend')
    const url = page.url()
    await avatarRow(page).getByRole('button', { name: 'Change' }).click()
    await avatarRow(page).getByRole('button', { name: 'Link' }).first().click()
    await expect(avatarRow(page).getByText(/identify/)).toBeVisible()

    const popupPromise = page.waitForEvent('popup')
    await avatarRow(page).getByRole('button', { name: 'Continue to Discord' }).click()
    const popup = await popupPromise
    await popup.waitForURL('**/fake-discord-consent')

    // What the callback page does once the link lands.
    linked = true
    await popup.evaluate(() => {
      const c = new BroadcastChannel('hadoku-avatar-link')
      c.postMessage({ type: 'hadoku-avatar-link', ok: true, provider: 'discord' })
      c.close()
    })
    await expect(avatarRow(page).getByText('Discord · linked')).toBeVisible()
    expect(page.url(), 'the page navigated').toBe(url)
  })

  test('a public visitor gets no avatar row: an avatar needs a session', async ({ page }) => {
    await stubBoot(page, 'public')
    await openSettings(page, 'public')
    await expect(avatarRow(page)).toHaveCount(0)
  })
})
