import { test, expect } from '@playwright/test'

/**
 * jsdom implements no Element.prototype.scrollIntoView, and every consumer's
 * unit test that renders the settings popout runs in jsdom. The tab strip's
 * scroll-into-view must not throw there: it reddened cardtable's CI
 * (header.test.ts) the day the tabs shipped. Same condition, in a real page.
 */
test('the popout opens where the DOM has no scrollIntoView', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })
  await page.route('**/session/whoami', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, userType: 'friend', name: 'alice', passkeys: 1 })
    })
  )
  await page.goto('/')
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })

  await page.getByRole('button', { name: 'User settings' }).click()
  await expect(page.getByRole('tab', { selected: true })).toHaveText('App')
  await page.getByRole('tab', { name: 'Account' }).click()
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Account')
  expect(errors).toEqual([])
})
