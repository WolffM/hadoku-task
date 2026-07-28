import { test, expect, type Page } from '@playwright/test'

/**
 * A task carries AT MOST ONE tag.
 *
 * `Task.tag` is a string that used to hold space-separated tokens, and every
 * write path treated tagging as "add to what's there": dropping a task on a
 * lane left it in the old lane as well, the pill grid was a multi-select, and
 * "task #a #b" produced two tags. This spec pins the replacement rule at each
 * of those entry points — the last tag applied wins.
 *
 * Public mode (localStorage-only, no backend) so it needs no secrets; the
 * stored blob is asserted alongside the DOM, so a green run means the single
 * tag actually persisted rather than merely rendering that way.
 */

const PUBLIC_USER_TYPE = 'public'
const PUBLIC_SESSION_ID = 'public-single-tag-session'
const PREFS_KEY = `${PUBLIC_USER_TYPE}-${PUBLIC_SESSION_ID}-preferences`

interface StoredTask {
  id: string
  title: string
  tag?: string | null
  state?: string
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

/** The persisted tag of `title`, as a plain string ('' when the tag is gone). */
const storedTag = async (page: Page, title: string) =>
  (await readStoredTasks(page)).find(t => t.title === title)?.tag ?? ''

/**
 * Hermetic prefs backend, borrowed from task-button-prefs.spec.ts: the seeded
 * legacy blob is migrated through the prefs SDK on load, and without these
 * routes that migration fails and every pref falls back to its default — which
 * would silently drop `showTagButton` and hide the modal under test. GET 404s
 * on purpose, keeping the optimistic localStorage cache authoritative.
 */
async function stubPrefsBackend(page: Page) {
  const corsHeaders = (origin: string) => ({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Key, X-Device-Id',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS'
  })

  await page.route('**/session/whoami', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders(route.request().headers()['origin'] ?? '*'),
      body: JSON.stringify({ userId: 'anon', userType: 'public' })
    })
  })

  const versions = { user: 0, device: 0 }
  await page.route('**/prefs/api/v1/task', async route => {
    const request = route.request()
    const headers = corsHeaders(request.headers()['origin'] ?? '*')
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    if (request.method() === 'PUT') {
      const { scope } = request.postDataJSON() as { scope: 'user' | 'device' }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify({ scope, version: ++versions[scope] })
      })
      return
    }
    await route.fulfill({ status: 404, headers })
  })
}

/** Seed a public session; a public sessionId comes from `task_anon_session_id`. */
async function seedPublicSession(page: Page, prefs: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ userType, sessionId, prefsKey, prefsJson }) => {
      window.localStorage.setItem('hadoku_user_type', userType)
      window.localStorage.setItem('task_anon_session_id', sessionId)
      window.localStorage.setItem(prefsKey, prefsJson)
    },
    {
      userType: PUBLIC_USER_TYPE,
      sessionId: PUBLIC_SESSION_ID,
      prefsKey: PREFS_KEY,
      prefsJson: JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        theme: 'light',
        ...prefs
      })
    }
  )
}

async function addTask(page: Page, input: string) {
  const field = page.locator('.task-app__input')
  await field.fill(input)
  await field.press('Enter')
  const title = input.replace(/#\S+/g, '').trim()
  await expect(page.locator('.task-app__item', { hasText: title })).toBeVisible()
}

const card = (page: Page, title: string) =>
  page.locator('.task-app__item', { hasText: title }).first()

/** Create a tag ON THE BOARD (the "＋" in the filter bar), not just on a task. */
async function createBoardTag(page: Page, tag: string) {
  await page.locator('button[aria-label="Add tag"]').click()
  const dialog = page.locator('.modal-card', { hasText: 'Create New Tag' })
  await dialog.locator('input').fill(tag)
  await dialog.locator('button', { hasText: 'Create' }).click()
  await expect(dialog).toHaveCount(0)
}

const column = (page: Page, tag: string) =>
  page.locator('.task-app__tag-column').filter({ has: page.locator(`h3:text-is("#${tag}")`) })

test.describe('One tag per task', () => {
  test.beforeEach(async ({ page }) => {
    await seedPublicSession(page)
    await page.goto('/?userType=public')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.locator('.task-app__input')).toBeVisible()
  })

  test('quick-create keeps the last tag typed, not all of them', async ({ page }) => {
    await addTask(page, 'Book the flights #travel #soon')

    await expect(card(page, 'Book the flights').locator('.task-app__item-tag')).toHaveText('#soon')
    await expect.poll(() => storedTag(page, 'Book the flights')).toBe('soon')
  })

  test('dragging a task into a lane REPLACES its tag', async ({ page }) => {
    await addTask(page, 'Ship it #alpha')
    await addTask(page, 'Anchor #beta')
    await expect(column(page, 'beta')).toBeVisible()

    await page.dragAndDrop(
      '.task-app__item:has-text("Ship it")',
      '.task-app__tag-column:has(h3:text-is("#beta"))'
    )

    // Only tag is beta — the whole point: it left the alpha lane.
    await expect.poll(() => storedTag(page, 'Ship it')).toBe('beta')
    await expect(card(page, 'Ship it').locator('.task-app__item-tag')).toHaveText('#beta')
    await expect(
      column(page, 'beta').locator('.task-app__item', { hasText: 'Ship it' })
    ).toHaveCount(1)
    await expect(column(page, 'alpha')).toHaveCount(0)
  })

  test('dragging a task onto the untagged section clears its tag', async ({ page }) => {
    await addTask(page, 'Untag me #alpha')
    // An untagged task, so the untagged block exists to be dropped on.
    await addTask(page, 'Plain task')
    await expect(page.locator('.task-app__remaining')).toBeVisible()

    await page.dragAndDrop('.task-app__item:has-text("Untag me")', '.task-app__remaining')

    await expect.poll(() => storedTag(page, 'Untag me')).toBe('')
  })

  test('dropping a task on a filter chip REPLACES its tag', async ({ page }) => {
    await addTask(page, 'Retag me #alpha')
    await addTask(page, 'Anchor #beta')

    const chip = page.locator('.task-app__filters .pill-btn', { hasText: '#beta' }).first()
    await expect(chip).toBeVisible()
    await page.dragAndDrop(
      '.task-app__item:has-text("Retag me")',
      '.task-app__filters .pill-btn:has-text("#beta")'
    )

    await expect.poll(() => storedTag(page, 'Retag me')).toBe('beta')
  })

  test('a completed task keeps its own tag when retagged by drag', async ({ page }) => {
    await addTask(page, 'Finish up #alpha')
    await addTask(page, 'Anchor #beta')

    await card(page, 'Finish up').locator('.task-app__complete-btn').click()
    await expect(card(page, 'Finish up')).toHaveClass(/is-completed/)

    await page.dragAndDrop(
      '.task-app__item:has-text("Finish up")',
      '.task-app__tag-column:has(h3:text-is("#beta"))'
    )

    await expect.poll(() => storedTag(page, 'Finish up')).toBe('beta')
  })
})

test.describe('One tag per task: the edit-tag modal', () => {
  // The pill grid is only reachable with the tag button pref turned on, and
  // that pref only survives load with the prefs backend stubbed.
  test.beforeEach(async ({ page }) => {
    await stubPrefsBackend(page)
    await seedPublicSession(page, { showTagButton: true })
    await page.goto('/?userType=public')
    await expect(page.locator('.task-app__input')).toBeVisible()
  })

  test('the edit-tag pills are single-select', async ({ page }) => {
    // Pills list the BOARD's tags, which only a real tag creation writes — a
    // tag typed into the quick-add lives on the task alone.
    await createBoardTag(page, 'alpha')
    await createBoardTag(page, 'beta')
    await addTask(page, 'Pick one #alpha')

    await card(page, 'Pick one').locator('.task-app__edit-tag-btn').click()
    const pills = page.locator('.edit-tag-pill')
    await expect(pills.filter({ hasText: '#alpha' })).toHaveClass(/active/)

    await pills.filter({ hasText: '#beta' }).click()

    // Selecting beta DESELECTS alpha — exactly one pill is ever active.
    await expect(pills.filter({ hasText: '#beta' })).toHaveClass(/active/)
    await expect(pills.filter({ hasText: '#alpha' })).not.toHaveClass(/active/)
    await expect(page.locator('.edit-tag-pill.active')).toHaveCount(1)

    await page.locator('.modal-card button', { hasText: 'Save' }).click()

    await expect.poll(() => storedTag(page, 'Pick one')).toBe('beta')
  })

  test('a typed tag replaces the current one instead of joining it', async ({ page }) => {
    await addTask(page, 'Rewrite my tag #alpha')

    await card(page, 'Rewrite my tag').locator('.task-app__edit-tag-btn').click()
    await page.locator('.edit-tag-input').fill('gamma')
    await page.locator('.modal-card button', { hasText: 'Save' }).click()

    await expect.poll(() => storedTag(page, 'Rewrite my tag')).toBe('gamma')
  })
})
