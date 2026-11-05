import { expect, type Page } from '@playwright/test'

/**
 * Open the settings popout on its App tab — the task app's own settings, with
 * the live preview TaskItem.
 *
 * Never assume App is the tab it opens on. The open tab is remembered on the
 * user-scoped prefs row, and against the local stack that is ONE row shared by
 * every spec: settings-tabs.spec.ts sets it to Account while the rest of the
 * suite runs in parallel, so "the default tab" is whatever it last wrote. Click
 * App only when it is not already open, because a click saves the tab to that
 * same row and would race settings-tabs in turn.
 */
export async function openSettingsAppTab(page: Page): Promise<void> {
  await page.locator('.settings-toggle-btn').click()
  const appTab = page.getByRole('tab', { name: 'App' })
  if ((await appTab.getAttribute('aria-selected')) !== 'true') await appTab.click()
  await expect(page.locator('.settings-preview-stage')).toBeVisible()
}
