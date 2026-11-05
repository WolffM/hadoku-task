import { test, expect, type Page } from '@playwright/test'

/**
 * The popout's Access tier row. A member the operator made or verified (the
 * edge's whoami `verified`) reads "Member-verified"; one who signed up alone
 * reads "Member"; every tier above member reads its own name, flag or not.
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
  await panel.getByRole('tab', { name: 'Profile' }).click()
  return panel.locator('.settings-popout__tier')
}

for (const [why, body, label] of [
  ['a verified member', { userType: 'member', verified: true }, 'Member-verified'],
  ['a member who signed up alone', { userType: 'member', verified: false }, 'Member'],
  ['a member on an edge that sends no flag', { userType: 'member' }, 'Member'],
  ['a friend', { userType: 'friend', verified: true }, 'Friend']
] as const) {
  test(`access tier for ${why}: ${label}`, async ({ page }) => {
    await expect(await showTier(page, body)).toHaveText(label)
  })
}
