import { test, expect, type Page } from '@playwright/test'
import { pointPrefsAtLocalStack, prefsUp } from './helpers/prefs'
import { mockShellApi } from './helpers/mock-api'

/**
 * The task app ADOPTS the themed controls: scrollbars on the app root,
 * <Tooltip> instead of `title=`, <Select> instead of a native <select>.
 * e2e/controls.spec.ts proves the components; this proves the app wires them
 * in without breaking what was there.
 */

const TASK_TITLE = 'A task with action buttons'

async function boot(page: Page) {
  // A friend session reads its boards from the server; a public one keeps them
  // local and would never see the mocked task.
  await page.addInitScript(() => {
    localStorage.setItem('hadoku_user_type', 'friend')
    localStorage.setItem('hadoku_session_id', 'controls-in-app-session')
  })
  const now = new Date().toISOString()
  await mockShellApi(page, [
    {
      id: 'main',
      name: 'Main',
      tags: [],
      tasks: [{ id: 't1', title: TASK_TITLE, state: 'Active', createdAt: now, tag: null }]
    }
  ])
  await pointPrefsAtLocalStack(page)
  await page.goto('/')
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
}

/** The settings panel renders a live preview TaskItem, so opening it puts
 *  every optional action button on screen for the title sweep. */
async function openPreview(page: Page) {
  await page.locator('.settings-toggle-btn').click()
  await expect(page.locator('.settings-preview-stage')).toBeVisible()
}

/** The real card's action row (the preview's is pointer-events: none). */
async function taskActions(page: Page) {
  const card = page.locator('.task-app__item', { hasText: TASK_TITLE }).first()
  await expect(card).toBeVisible()
  return card.locator('.task-app__item-actions')
}

test.describe('themed controls in the running app', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(
      !(await prefsUp(request)),
      'prefs stack not running (node scripts/dev-api.mjs, needs ../hadoku_site)'
    )
  })

  test('every scroller in the app takes the active theme accent', async ({ page }) => {
    await boot(page)
    const container = page.locator('.task-app-container')
    await expect(container).toHaveClass(/\bhdk-scroll\b/)

    for (const theme of ['light', 'ocean-dark', 'izakaya-light']) {
      // Switch on the mount container only — see icons-in-app.spec.ts for why.
      await container.evaluate((n, t) => n.setAttribute('data-theme', t), theme)
      const colors = await page
        .locator('.task-app__item, .app-header')
        .first()
        .evaluate(n => {
          const read = (el: Element, expr: string) => {
            const probe = document.createElement('span')
            probe.style.color = expr
            el.append(probe)
            const c = getComputedStyle(probe).color
            probe.remove()
            return c
          }
          return {
            thumb: read(n, 'var(--hdk-scrollbar-thumb)'),
            primary: read(n, 'var(--color-primary)')
          }
        })
      expect(colors.thumb, theme).toBe(colors.primary)
    }
  })

  test('no native title tooltips remain in the app chrome', async ({ page }) => {
    await boot(page)
    await openPreview(page)
    expect(
      await page
        .locator('.task-app-container [title]')
        .evaluateAll(els => els.map(e => `${e.tagName}: ${e.getAttribute('title')}`))
    ).toEqual([])
  })

  test('task action buttons show card tooltips and keep their DOM shape', async ({ page }) => {
    await boot(page)
    const actions = await taskActions(page)
    const del = actions.getByRole('button', { name: 'Delete task' })

    // No wrapper: every action button is still a direct child of the row, so
    // `.task-app__action-btn:last-child` still rounds ONLY the last one.
    const shape = await actions.evaluate(row =>
      Array.from(row.querySelectorAll('.task-app__action-btn')).map(b => ({
        parentIsRow: b.parentElement === row,
        isLast: b.matches(':last-child')
      }))
    )
    expect(shape.every(s => s.parentIsRow)).toBe(true)
    expect(shape.filter(s => s.isLast)).toHaveLength(1)

    await del.hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toHaveText('Delete task')
    await expect(tip).toHaveClass(/hdk-tooltip--card/)
    // Portalled into the SAME theme scope as its anchor — the nearest
    // [data-theme], or <html>/:root when the container carries none (it often
    // doesn't: HadokuThemeRoot only mirrors the attribute if the container is
    // mounted when the theme applies) — so it resolves the anchor's tokens.
    const sameScope = await page.evaluate(() => {
      const tipEl = document.querySelector('[role="tooltip"]')
      const anchor = document.querySelector('.task-app__item .task-app__delete-btn')
      const scope = (n: Element | null) => n?.closest('[data-theme]') ?? null
      const read = (n: Element, expr: string) => {
        const probe = document.createElement('span')
        probe.style.color = expr
        n.append(probe)
        const c = getComputedStyle(probe).color
        probe.remove()
        return c
      }
      if (!tipEl || !anchor) throw new Error('tooltip or anchor missing')
      return {
        scope: scope(tipEl) === scope(anchor),
        card: read(tipEl, 'var(--color-bg-card)') === read(anchor, 'var(--color-bg-card)')
      }
    })
    expect(sameScope).toEqual({ scope: true, card: true })
  })

  test('the theme picker trigger has a tooltip and a press dismisses it', async ({ page }) => {
    await boot(page)
    const trigger = page.locator('.theme-toggle-btn')
    await trigger.hover()
    await expect(page.getByRole('tooltip')).toHaveText('Choose theme')
    await trigger.click()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect(page.locator('.theme-picker__dropdown')).toBeVisible()
  })
})
