import { expect, type Page } from '@playwright/test'

/**
 * Open the settings popout on its App tab — the task app's own settings, with
 * the live preview TaskItem.
 *
 * Never assume App is the tab it opens on. The open tab is remembered on the
 * user-scoped prefs row, and these specs run as the stack's shared dev user,
 * whose row outlives a run (one database per `dev:api`) and which other specs
 * write (avatar-cosmetics saves settingsTabs). Click App only when it is not
 * already open, since a click saves the tab to that shared row too. A spec whose
 * premise is a clean row uses asFreshUser instead (helpers/prefs.ts).
 */
export async function openSettingsAppTab(page: Page): Promise<void> {
  await page.locator('.settings-toggle-btn').click()
  const appTab = page.getByRole('tab', { name: 'App' })
  if ((await appTab.getAttribute('aria-selected')) !== 'true') await appTab.click()
  await expect(page.locator('.settings-preview-stage')).toBeVisible()
}
