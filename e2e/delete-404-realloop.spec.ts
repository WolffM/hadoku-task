import { test, expect, type Page } from '@playwright/test'
import { API, apiUp } from './helpers/stack'

/**
 * "I delete the task, refresh, and it comes back" — the customer loop, end to
 * end, against the REAL worker with nothing mocked.
 *
 * Two tabs on the same board. Tab A deletes the task, which succeeds: the row is
 * soft-deleted (`state='Deleted'`) and drops out of `getTasks`, whose
 * VISIBLE_PREDICATE excludes Deleted. Tab B still shows the card from its cache.
 * Clicking delete there makes the server answer `Task <id> not found` (404).
 *
 * A delete is idempotent, so that 404 means the goal state already holds and the
 * card must STAY gone. Before the fix the client counted 404 as a definitive
 * refusal and re-created the task in tab B's localStorage — the one status
 * meaning "already gone" was the one that brought it back.
 *
 * These run on `main`: the dev stack shares one board namespace across the whole
 * suite and the top bar only renders TOPBAR_BOARD_SLOTS (5) standard boards, so
 * a freshly-created board has no button to click by the time the suite is deep.
 *
 * Requires the local API stack (`node scripts/dev-api.mjs`).
 */

const BOARD = 'main'

const card = (page: Page, title: string) =>
  page.locator('.task-app__item').filter({ hasText: title })

const undoneToast = (page: Page) =>
  page.locator('.toast, [role="alert"]').filter({ hasText: 'undone' })

const seed = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem('hadoku_session_id', 'dev-uid')
    localStorage.setItem('hadoku_user_type', 'friend')
  })

/** A title unique to this test, so concurrent specs on `main` can't collide. */
const uniqueTitle = (tag: string) => `Stubborn ${tag} ${Date.now().toString(36)}`

test('a second delete of an already-deleted task is accepted, not undone', async ({
  browser,
  request
}) => {
  test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')

  const title = uniqueTitle('loop')
  const taskId = `d404-loop-${Date.now().toString(36)}`
  expect((await request.post(API, { data: { boardId: BOARD, id: taskId, title } })).ok()).toBe(true)

  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  await seed(pageA)
  await seed(pageB)
  for (const p of [pageA, pageB]) {
    await p.goto('/')
    await expect(card(p, title)).toHaveCount(1, { timeout: 20000 })
  }

  // Tab A deletes it for real.
  const okDelete = pageA.waitForResponse(
    r => r.request().method() === 'DELETE' && r.url().includes(taskId)
  )
  await card(pageA, title).getByRole('button', { name: '×' }).click()
  expect((await okDelete).status()).toBe(200)
  await expect.poll(() => card(pageA, title).count(), { timeout: 10000 }).toBe(0)

  // Tab B is stale and still shows the card. Deleting here hits a real 404.
  const staleDelete = pageB.waitForResponse(
    r => r.request().method() === 'DELETE' && r.url().includes(taskId)
  )
  await card(pageB, title).getByRole('button', { name: '×' }).click()
  const res = await staleDelete
  expect(res.status()).toBe(404)
  expect((await res.json()).code).toBe('TASK_NOT_FOUND')

  // Nothing was refused, so nothing is reported or rolled back...
  await expect(undoneToast(pageB)).toHaveCount(0)
  // ...and the card stays gone: the delete reached the state the user asked for.
  await expect.poll(() => card(pageB, title).count(), { timeout: 10000 }).toBe(0)

  await ctxA.close()
  await ctxB.close()
})

/**
 * A delete aimed at the WRONG board is not the idempotent case: it never ran, so
 * the task is still there. It must still be refused, rolled back and reported —
 * and it must blame the BOARD. The 404 and everything after it are the real
 * server and the real client; only the outgoing boardId is rewritten, standing
 * in for the stale `currentBoardId` that produced the original report.
 */
test("Erin's case: a delete aimed at the wrong board is refused as a missing BOARD", async ({
  page,
  request
}) => {
  test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')

  const title = uniqueTitle('erin')
  const taskId = `d404-erin-${Date.now().toString(36)}`
  expect((await request.post(API, { data: { boardId: BOARD, id: taskId, title } })).ok()).toBe(true)

  await seed(page)
  await page.goto('/')
  await expect(card(page, title)).toHaveCount(1, { timeout: 20000 })

  await page.route(/\/task\/api\/[^/?]+\?/, route => {
    const req = route.request()
    if (req.method() !== 'DELETE') return route.continue()
    return route.continue({ url: req.url().replace(/boardId=[^&]*/, 'boardId=no-such-board-here') })
  })

  const res = page.waitForResponse(r => r.request().method() === 'DELETE')
  await card(page, title).getByRole('button', { name: '×' }).click()
  const response = await res
  expect(response.status()).toBe(404)
  expect((await response.json()).code).toBe('BOARD_NOT_FOUND')

  // Surfaced and rolled back, because the task really is still there.
  await expect(undoneToast(page).first()).toBeVisible({ timeout: 10000 })

  const tasks = (await (await request.get(`${API}/tasks?boardId=${BOARD}`)).json()).tasks
  const still = tasks.find((t: { id: string }) => t.id === taskId)
  expect(still).toBeTruthy()
  expect(still.state).toBe('Active')

  await request.delete(`${API}/${taskId}?boardId=${BOARD}`)
})
