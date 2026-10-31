import { test, expect, type Page } from '@playwright/test'

/**
 * The Avatar row: the way from any app's settings to hadoku.me/account, where
 * the avatar (watchparty character, Discord, Steam, upload) is managed.
 *
 * It is a link and nothing else. A thumbnail would cost every app a request at
 * mount (see settings-prefetch.spec.ts for why the popout costs none), so this
 * spec also pins that the row adds no avatar fetch. It opens a new tab so that
 * following it never takes a player out of a game mid-match.
 */

const APP_HEADER = 'h1.app-header__title'
const AVATAR_PATH = '/prefs/api/v1/_avatar'

async function stubBoot(page: Page, userType: 'friend' | 'public') {
  await page.route('**/prefs/api/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  )
  await page.route('**/session/whoami', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        userType === 'public'
          ? { valid: false, userType: 'public' }
          : { valid: true, userType, name: 'Avatar Tester' }
      )
    })
  )
  await page.route('**/task/api/boards**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), boards: [] })
    })
  )
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
  page.locator('.settings-popout__row', { has: page.locator('text=Avatar') })

test.describe('settings avatar row', () => {
  test('a signed-in user gets a link to /account, in a new tab, at no request', async ({
    page
  }) => {
    let avatarFetches = 0
    page.on('request', req => {
      if (req.url().includes(AVATAR_PATH)) avatarFetches++
    })
    await stubBoot(page, 'friend')
    await openSettings(page, 'friend')

    const link = avatarRow(page).getByRole('link', { name: 'Change' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/account')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    expect(avatarFetches, 'the avatar row fetched the avatar').toBe(0)
  })

  test('a public visitor gets no avatar row: /account needs a session', async ({ page }) => {
    await stubBoot(page, 'public')
    await openSettings(page, 'public')
    await expect(avatarRow(page)).toHaveCount(0)
  })
})
