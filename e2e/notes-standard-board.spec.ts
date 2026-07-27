import { test, expect, type Page } from '@playwright/test'

/**
 * Notes on a STANDARD board.
 *
 * Notes used to be gated behind `BoardTypeConfig.notesEnabled`, which was true
 * only for automation boards — the affordance was scoped to the agent flow
 * (write a plan → review → work). That gate is gone: notes are a plain task
 * column with no server-side board-mode check, so the button now appears
 * wherever the user wants it and the `showNotesButton` preference is the only
 * thing that hides it.
 *
 * Public mode is a standard board backed by localStorage, so these run with no
 * API stack and prove the whole round trip: button → popout → save → persist.
 */

const card = (page: Page, title: string) =>
  page.locator('.task-app__item').filter({ hasText: title })

async function addTask(page: Page, title: string) {
  const field = page.locator('.task-app__input')
  await field.fill(title)
  await field.press('Enter')
  await expect(card(page, title)).toBeVisible()
}

/** The notes actually persisted for `title`, read back out of storage. */
async function storedNotes(page: Page, title: string): Promise<string | null | undefined> {
  return page.evaluate(t => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.endsWith('-tasks')) continue
      try {
        const blob = JSON.parse(localStorage.getItem(key) || '{}')
        const hit = (blob.tasks ?? []).find((x: { title: string }) => x.title === t)
        if (hit) return hit.notes
      } catch {
        /* ignore corrupt blob */
      }
    }
    return undefined
  }, title)
}

test.describe('Notes on a standard board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?userType=public')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.locator('.task-app__input')).toBeVisible()
  })

  test('a standard-board card offers the notes button', async ({ page }) => {
    await addTask(page, 'Plain board task')
    await expect(card(page, 'Plain board task').locator('.task-app__notes-toggle')).toBeVisible()
  })

  test('writing notes on a standard board saves and survives a reload', async ({ page }) => {
    await addTask(page, 'Task with a note')
    await card(page, 'Task with a note').locator('.task-app__notes-toggle').click()

    const panel = page.locator('.notes-popout')
    await expect(panel).toBeVisible()

    // A card with no notes opens straight into the editor (startEditing).
    await panel.locator('.notes-popout__editor').fill('Remember the milk')
    await panel.getByRole('button', { name: 'Save' }).click()

    // Saving drops back to read mode rather than closing — you save, then read
    // what you wrote. The editor going away is what proves the save landed.
    await expect(panel.locator('.notes-popout__editor')).toHaveCount(0)
    await expect(panel.locator('.notes-popout__body')).toContainText('Remember the milk')

    await expect.poll(() => storedNotes(page, 'Task with a note')).toBe('Remember the milk')

    await panel.getByRole('button', { name: 'Close notes' }).click()
    await expect(panel).toHaveCount(0)

    // The has-notes marker is what tells you a card carries a plan at a glance.
    await expect(
      card(page, 'Task with a note').locator('.task-app__notes-toggle.has-notes')
    ).toBeVisible()

    await page.reload()
    await expect(card(page, 'Task with a note')).toBeVisible()
    await card(page, 'Task with a note').locator('.task-app__notes-toggle').click()
    await expect(page.locator('.notes-popout__body')).toContainText('Remember the milk')
  })

  test('the Notes preference hides the button on a standard board', async ({ page }) => {
    await addTask(page, 'Toggle my notes')
    const notesBtn = card(page, 'Toggle my notes').locator('.task-app__notes-toggle')
    await expect(notesBtn).toBeVisible()

    await page.locator('.settings-toggle-btn').click()
    await page
      .locator('.settings-toggle-chip')
      .filter({ hasText: 'Notes' })
      .locator('input[type="checkbox"]')
      .uncheck()

    await expect(notesBtn).toHaveCount(0)
  })
})
