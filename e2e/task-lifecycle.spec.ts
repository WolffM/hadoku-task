import { test, expect, type Page } from '@playwright/test'

/**
 * Task lifecycle E2E: complete ≠ delete.
 *
 * Completing a task no longer removes it — the card stays on the board, faded
 * and struck through, until its 24h window elapses and it closes out of view on
 * its own. The ✓ becomes a toggle (click again to reopen) and the × still
 * dismisses immediately.
 *
 * Runs in public mode (localStorage-only, no backend) so it needs no secrets.
 * Assertions read the persisted `*-tasks` blob as well as the DOM, so we prove
 * the state actually landed in storage rather than just that a class rendered.
 */

interface StoredTask {
  id: string
  title: string
  state?: string
  closedAt?: string | null
}

async function readStoredTasks(page: Page): Promise<StoredTask[]> {
  return page.evaluate(() => {
    const out: StoredTask[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.endsWith('-tasks')) continue
      try {
        const blob = JSON.parse(localStorage.getItem(key) || '{}')
        if (Array.isArray(blob.tasks)) out.push(...blob.tasks)
      } catch {
        /* ignore corrupt blob */
      }
    }
    return out
  })
}

const storedState = async (page: Page, title: string) =>
  (await readStoredTasks(page)).find(t => t.title === title)?.state ?? 'absent'

/**
 * Type a task and wait for its card. `input` may carry #tags, which the parser
 * strips off the title — so the card is matched on the title alone.
 */
async function addTask(page: Page, input: string) {
  const field = page.locator('.task-app__input')
  await field.fill(input)
  await field.press('Enter')
  const title = input.replace(/#\S+/g, '').trim()
  await expect(page.locator('.task-app__item', { hasText: title })).toBeVisible()
}

const card = (page: Page, title: string) =>
  page.locator('.task-app__item', { hasText: title }).first()

test.describe('Task lifecycle: complete vs delete', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?userType=public')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.locator('.task-app__input')).toBeVisible()
  })

  test('completing keeps the card, fades it, and strikes the title through', async ({ page }) => {
    await addTask(page, 'Complete me')
    const item = card(page, 'Complete me')

    await item.locator('.task-app__complete-btn').click()

    // The card is STILL on the board — this is the whole point.
    await expect(item).toBeVisible()
    await expect(item).toHaveClass(/is-completed/)
    await expect(item).toHaveAttribute('data-task-state', 'Completed')

    // The strikeout and fade are really applied, not just class names.
    await expect(item.locator('.task-app__item-title')).toHaveCSS(
      'text-decoration-line',
      'line-through'
    )
    // Poll: the fade is a CSS transition, so a single sample can catch opacity
    // still at its starting value. The settled value is what we're asserting.
    await expect
      .poll(async () =>
        Number(
          await item.locator('.task-app__item-content').evaluate(el => getComputedStyle(el).opacity)
        )
      )
      .toBeLessThan(1)

    // And it landed in storage as Completed with a close stamp.
    await expect.poll(() => storedState(page, 'Complete me')).toBe('Completed')
    const stored = (await readStoredTasks(page)).find(t => t.title === 'Complete me')
    expect(stored?.closedAt).toBeTruthy()
  })

  test('clicking complete on a completed task reopens it', async ({ page }) => {
    await addTask(page, 'Toggle me')
    const item = card(page, 'Toggle me')

    await item.locator('.task-app__complete-btn').click()
    await expect(item).toHaveClass(/is-completed/)
    await expect.poll(() => storedState(page, 'Toggle me')).toBe('Completed')

    // Second click on the same button un-completes it.
    await item.locator('.task-app__complete-btn').click()
    await expect(item).not.toHaveClass(/is-completed/)
    await expect(item).toHaveAttribute('data-task-state', 'Active')
    await expect(item.locator('.task-app__item-title')).toHaveCSS('text-decoration-line', 'none')

    await expect.poll(() => storedState(page, 'Toggle me')).toBe('Active')
    const stored = (await readStoredTasks(page)).find(t => t.title === 'Toggle me')
    expect(stored?.closedAt ?? null).toBeNull()
  })

  test('the X removes a completed task right away', async ({ page }) => {
    await addTask(page, 'Dismiss me')
    const item = card(page, 'Dismiss me')

    await item.locator('.task-app__complete-btn').click()
    await expect(item).toHaveClass(/is-completed/)

    // The X is still reachable on a completed card, and takes effect immediately
    // rather than waiting out the 24h window.
    await item.locator('.task-app__delete-btn').click()
    await expect(page.locator('.task-app__item', { hasText: 'Dismiss me' })).toHaveCount(0)

    // Soft delete: the record survives in storage, it just left the board.
    await expect.poll(() => storedState(page, 'Dismiss me')).toBe('Deleted')
  })

  test('deleting an active task removes it without ever showing a strikeout', async ({ page }) => {
    await addTask(page, 'Straight to gone')
    await card(page, 'Straight to gone').locator('.task-app__delete-btn').click()

    await expect(page.locator('.task-app__item', { hasText: 'Straight to gone' })).toHaveCount(0)
    await expect.poll(() => storedState(page, 'Straight to gone')).toBe('Deleted')
  })

  test('a completed task closes out of view once its 24h window elapses', async ({ page }) => {
    await addTask(page, 'Ages out')
    await card(page, 'Ages out').locator('.task-app__complete-btn').click()
    await expect(card(page, 'Ages out')).toHaveClass(/is-completed/)

    // Backdate the close past the window, then reload. Nothing sweeps — the task
    // falls out of view purely because the clock moved.
    await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key || !key.endsWith('-tasks')) continue
        const blob = JSON.parse(localStorage.getItem(key) || '{}')
        if (!Array.isArray(blob.tasks)) continue
        for (const t of blob.tasks) {
          if (t.title === 'Ages out') {
            t.closedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
          }
        }
        localStorage.setItem(key, JSON.stringify(blob))
      }
    })
    await page.reload()
    await expect(page.locator('.task-app__input')).toBeVisible()

    await expect(page.locator('.task-app__item', { hasText: 'Ages out' })).toHaveCount(0)
    // Still on record, though — the row is history, not garbage.
    expect(await storedState(page, 'Ages out')).toBe('Completed')
  })

  test('a completed task stops counting toward its lane', async ({ page }) => {
    // Two tags, one with more active work. Completing the busier tag's tasks must
    // not keep it ranked above the tag that still has live work.
    await addTask(page, 'Done one #alpha')
    await addTask(page, 'Done two #alpha')
    await addTask(page, 'Live one #beta')

    await expect(page.locator('.task-app__tag-column')).toHaveCount(2)

    await card(page, 'Done one').locator('.task-app__complete-btn').click()
    await card(page, 'Done two').locator('.task-app__complete-btn').click()

    // Both alpha cards are still rendered (struck through)…
    await expect(page.locator('.task-app__item.is-completed')).toHaveCount(2)
    // …but alpha's live count is now 0, so beta leads the lane ranking.
    await expect
      .poll(async () => (await page.locator('.task-app__tag-header').allInnerTexts()).join('|'))
      .toMatch(/^#beta/)
  })
})
