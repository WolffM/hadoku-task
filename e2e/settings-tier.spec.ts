import { test, expect, type Page } from '@playwright/test'

/**
 * The popout's Access tier row reads the tier whoami names: a member (an
 * account the operator verified) reads "Member", every tier above it its own
 * name, a guest (an account the visitor made) "Guest", and nobody signed in
 * "Not signed in".
 */

async function showTier(page: Page, body: Record<string, unknown>) {
  await page.route('**/session/whoami', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, name: 'ada', passkeys: 1, ...body })
    })
  )
  await page.goto('/')
  await page.waitForSelector('h1.app-header__title', { timeout: 10000 })
  await page.getByRole('button', { name: 'User settings' }).click()
  const panel = page.locator('.settings-popout__panel')
  await panel.getByRole('tab', { name: 'Account' }).click()
  return panel.locator('.settings-popout__tier')
}

for (const [why, body, label] of [
  ['a member', { userType: 'member' }, 'Member'],
  ['a friend', { userType: 'friend' }, 'Friend'],
  ['a guest', { userType: 'guest' }, 'Guest'],
  ['nobody signed in', { valid: false, userType: 'public', name: null }, 'Not signed in']
] as const) {
  test(`access tier for ${why}: ${label}`, async ({ page }) => {
    await expect(await showTier(page, body)).toHaveText(label)
  })
}
