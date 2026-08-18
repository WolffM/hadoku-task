import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { API, apiUp } from './helpers/stack'

/**
 * Every optimistic write the server definitively refuses must be rolled back.
 *
 * Lane drags were fixed first (refused-lane-drag.spec.ts) because a refusal there
 * is routine — an automation board rejects a move into an agent-owned lane. The
 * same hazard applies to every other optimistic write: each one lands in
 * localStorage immediately and syncs fire-and-forget, so a 4xx left the UI showing
 * a change the server never accepted, until the next full sync silently undid it.
 *
 * Covered here: create, rename (patch), complete, delete. The create case is
 * driven against the REAL worker — creating a task straight into an agent lane is
 * refused for the same reason a drag into one is. The others are driven with an
 * injected `403 FORBIDDEN`, which is what a read-only grantee on a shared board
 * receives, because provoking a genuine one needs a second identity mid-session.
 *
 * The 5xx/network side is deliberately NOT retested per operation — that rule
 * lives in `backgroundSync` and is covered once, in refused-lane-drag.spec.ts.
 *
 * Requires the local API stack (`node scripts/dev-api.mjs`).
 */

const FORBIDDEN = {
  status: 403,
  contentType: 'application/json',
  body: JSON.stringify({ error: 'Read-only access to this board', code: 'FORBIDDEN' })
}

/** An automation board on tenhands-simple: `todo`/`review` user, `working` agent. */
async function createAutomationBoard(request: APIRequestContext, id: string) {
  await request.post(`${API}/boards`, { data: { id, name: id } })
  const presets = await (await request.get(`${API}/automation/presets`)).json()
  const preset = presets.presets.find((p: { schemaId: string }) => p.schemaId === 'tenhands-simple')
  const input = {
    schemaId: preset.schemaId,
    schemaVersion: preset.schemaVersion,
    lanes: preset.lanes
  }
  const preview = await (
    await request.post(`${API}/boards/${id}/activate-automation`, {
      data: { ...input, dryRun: true }
    })
  ).json()
  expect(
    (
      await request.post(`${API}/boards/${id}/activate-automation`, {
        data: { ...input, expectedDigest: preview.preview.digest }
      })
    ).ok()
  ).toBe(true)
}

const card = (page: Page, title: string) =>
  page.locator('.task-app__item').filter({ hasText: title })

const undoneToast = (page: Page) =>
  page.locator('.toast, [role="alert"]').filter({ hasText: 'undone' })

const serverTasks = async (request: APIRequestContext, boardId: string) =>
  (await (await request.get(`${API}/tasks?boardId=${boardId}`)).json()).tasks as Array<{
    id: string
    title: string
    tag?: string | null
    state: string
  }>

test.describe('a refused optimistic write is rolled back', () => {
  let boardId: string

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')
    // Unique per RUN: the dev stack's in-memory DB outlives a playwright invocation.
    boardId = `refw-${Date.now().toString(36)}${test
      .info()
      .testId.replace(/[^a-z0-9]/gi, '')
      .slice(0, 6)}`
    await createAutomationBoard(request, boardId)
    expect(
      (
        await request.post(API, {
          data: { boardId, id: `${boardId}-t`, title: 'Existing task', tag: 'todo' }
        })
      ).ok()
    ).toBe(true)

    await page.addInitScript(() => {
      localStorage.clear()
      localStorage.setItem('hadoku_session_id', 'dev-uid')
      localStorage.setItem('hadoku_user_type', 'friend')
    })
    await page.goto('/')
    await page.getByRole('button', { name: boardId, exact: true }).click()
    await page.locator('.task-app__item').first().waitFor({ state: 'visible', timeout: 10000 })
  })

  test('create: a task the real worker refuses does not linger on the board', async ({
    page,
    request
  }) => {
    // `#working` is the agent lane — the worker refuses a human create into it,
    // exactly as it refuses a drag.
    const refusal = page.waitForResponse(
      r => r.url().endsWith('/task/api') && r.request().method() === 'POST'
    )
    const field = page.locator('.task-app__input')
    await field.fill('Never allowed #working')
    await field.press('Enter')
    expect((await refusal).status()).toBe(403)

    await expect(undoneToast(page).first()).toBeVisible({ timeout: 5000 })
    // The optimistic card is removed, so the board stops showing a task that
    // never existed server-side.
    await expect.poll(() => card(page, 'Never allowed').count(), { timeout: 5000 }).toBe(0)
    expect((await serverTasks(request, boardId)).some(t => t.title === 'Never allowed')).toBe(false)
  })

  test('rename: a refused title change reverts to the old title', async ({ page }) => {
    await page.route(/\/task\/api\/[^/?]+(\?|$)/, route =>
      route.request().method() === 'PATCH' ? route.fulfill(FORBIDDEN) : route.continue()
    )

    await card(page, 'Existing task').locator('.task-app__item-title').click()
    const input = page.locator('.task-app__title-input')
    await expect(input).toBeVisible()
    await input.fill('Renamed to something refused')
    await input.press('Enter')

    await expect(undoneToast(page).first()).toBeVisible({ timeout: 5000 })
    await expect.poll(() => card(page, 'Existing task').count(), { timeout: 5000 }).toBe(1)
    expect(await card(page, 'Renamed to something refused').count()).toBe(0)
  })

  test('complete: a refused completion un-completes the card', async ({ page }) => {
    await page.route(/\/complete(\?|$)/, route => route.fulfill(FORBIDDEN))

    await card(page, 'Existing task').getByRole('button', { name: 'Complete task' }).click()

    await expect(undoneToast(page).first()).toBeVisible({ timeout: 5000 })
    // Completing toggles, so the undo is another toggle — the card must end up
    // active again, not struck through.
    await expect
      .poll(() => card(page, 'Existing task').locator('.is-completed').count(), { timeout: 5000 })
      .toBe(0)
    await expect(page.locator('.task-app__item.is-completed')).toHaveCount(0)
  })

  test('delete: a refused delete brings the task back', async ({ page }) => {
    await page.route(/\/task\/api\/[^/?]+(\?|$)/, route =>
      route.request().method() === 'DELETE' ? route.fulfill(FORBIDDEN) : route.continue()
    )

    await card(page, 'Existing task').getByRole('button', { name: '×' }).click()

    await expect(undoneToast(page).first()).toBeVisible({ timeout: 5000 })
    // Rebuilt from the snapshot the local delete handed back — the card returns
    // with its lane intact, not as a bare title.
    await expect.poll(() => card(page, 'Existing task').count(), { timeout: 5000 }).toBe(1)
    await expect(card(page, 'Existing task').locator('.task-app__item-tag')).toContainText('#todo')
  })
})
