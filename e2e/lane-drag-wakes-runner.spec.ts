import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

/**
 * A real lane drag must reach the endpoint that wakes the runner.
 *
 * When a human lands a task in a `user` lane on an automation board wired to a
 * `repo`, the worker fires a `repository_dispatch` so the pipeline starts in
 * seconds instead of waiting out its cron. The worker-side predicate is covered
 * exhaustively by `worker/test/lane-dispatch-verify.ts`. What only a browser can
 * prove is the link that spec cannot see: WHICH endpoint the drop handler calls.
 *
 * That link is easy to get wrong. A lane drop does NOT go through the single-task
 * `PATCH /task/api/:id` — `useDragAndDrop` routes every drop, even of a single
 * card, through `onBulkUpdate` and out to the BATCH endpoint. A refactor that
 * repoints those handlers, or a hook added only to the PATCH path, would leave
 * dragging silently un-dispatched with every worker test still green.
 *
 * There are TWO drop targets a lane can be reached by, on two different handlers,
 * and both are asserted: the lane COLUMN (`onDrop`, which only exists once the
 * lane holds something) and the lane's FILTER CHIP (`onFilterDrop`, which is how
 * you move the first card into an empty lane). Either one must post the lane
 * write to the batch endpoint.
 *
 * Requires the local API stack (`node scripts/dev-api.mjs`); skipped when it
 * isn't up, like the other server-path specs.
 */

const API = 'http://127.0.0.1:3001/task/api'

/** Sign in the way the key-swap flow does: the app reads these on boot. */
async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hadoku_session_id', 'dev-uid')
    localStorage.setItem('hadoku_user_type', 'friend')
  })
}

async function apiUp(request: APIRequestContext): Promise<boolean> {
  try {
    return (await request.get(`${API}/automation/presets`)).ok()
  } catch {
    return false
  }
}

/**
 * An automation board of this test's own, wired to a repo. Driven through the API
 * rather than the picker: activation is permanent and the dev stack shares one
 * in-memory DB for the whole run.
 */
async function createBoard(request: APIRequestContext, id: string) {
  await request.post(`${API}/boards`, { data: { id, name: id } })
  expect(
    (await request.post(`${API}/boards/${id}/repo`, { data: { repo: 'WolffM/tenhands' } })).ok()
  ).toBe(true)

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
  const applied = await request.post(`${API}/boards/${id}/activate-automation`, {
    data: { ...input, expectedDigest: preview.preview.digest }
  })
  expect(applied.ok()).toBe(true)
}

async function openBoard(page: Page, boardId: string) {
  await page.goto('/')
  await page.getByRole('button', { name: boardId, exact: true }).click()
  await page.locator('.task-app__item').first().waitFor({ state: 'visible', timeout: 10000 })
}

test.describe('a lane drag wakes the runner', () => {
  let boardId: string

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')
    // Unique per RUN as well as per test. `testId` alone is deterministic, and the
    // dev stack's in-memory DB outlives a playwright invocation — so a rerun
    // against a still-running `dev-api.mjs` would find this board already there
    // with the task already in the lane, and the drop would correctly decide it
    // has nothing to do. That reads as a broken hook and isn't one.
    const unique = `${Date.now().toString(36)}${test
      .info()
      .testId.replace(/[^a-z0-9]/gi, '')
      .slice(0, 8)}`
    boardId = `drag-${unique}`
    await createBoard(request, boardId)
    // The card under test starts untagged, in the Inbox, so the drop is a real
    // lane change. The seed already sits in `todo` — without it the lane holds
    // nothing and renders no column to drop onto.
    for (const t of [
      { id: `${boardId}-t`, title: 'Drag me into a lane' },
      { id: `${boardId}-seed`, title: 'Already in the lane', tag: 'todo' }
    ]) {
      expect((await request.post(API, { data: { boardId, ...t } })).ok()).toBe(true)
    }
    await signIn(page)
    await openBoard(page, boardId)
  })

  /**
   * The lane write the browser issued, asserted down to the payload.
   *
   * Matches EITHER batch alias. The app currently uses the legacy
   * `PATCH /task/api/batch-tag` (api.batchUpdateTags), not the path-param
   * `POST /boards/:id/tasks/batch/update-tags` — both land on the same worker
   * handler, so either satisfies the wake hook, and pinning only the one the
   * client happens to use today would fail the day it switches for no real reason.
   */
  async function expectLaneWrite(page: Page, drop: () => Promise<void>) {
    // Waiting on the REQUEST rather than the response is deliberate: the assertion
    // is which endpoint the browser chose and what it sent — the contract the
    // worker's dispatch hook hangs off. (The client fires this write through
    // backgroundSync, so there is no response the UI waits on either.)
    const write = page.waitForRequest(
      req => /\/task\/api\/(batch-tag|boards\/[^/]+\/tasks\/batch\/update-tags)$/.test(req.url()),
      { timeout: 10000 }
    )
    await drop()
    const req = await write

    expect(['POST', 'PATCH']).toContain(req.method())
    const body = req.postDataJSON() as {
      boardId?: string
      updates: Array<{ taskId: string; tag: string }>
    }
    // The legacy alias carries the board in the body; the other in the path.
    expect(body.boardId ?? req.url()).toContain(boardId)
    expect(body.updates).toHaveLength(1)
    expect(body.updates[0].taskId).toBe(`${boardId}-t`)
    expect(body.updates[0].tag).toBe('todo')
  }

  /** The PERSISTED tag — the dispatch only fires after the write commits. */
  async function expectLanded(request: APIRequestContext) {
    await expect
      .poll(
        async () => {
          const tasks = await (await request.get(`${API}/tasks?boardId=${boardId}`)).json()
          return tasks.tasks.find((t: { id: string }) => t.id === `${boardId}-t`)?.tag
        },
        { timeout: 10000 }
      )
      .toBe('todo')
  }

  const card = (page: Page) =>
    page.locator('.task-app__item').filter({ hasText: 'Drag me into a lane' })

  /**
   * Pick the card up by its PADDING, not its centre. A card is a drag handle
   * everywhere except on its own text (see card-drag-vs-select.spec.ts), and the
   * centre of this one is the title — pressing there starts a text selection and
   * no drag ever begins.
   */
  const grabByPadding = async (page: Page, target: ReturnType<Page['locator']>) => {
    const box = await card(page).boundingBox()
    expect(box, 'card should be measurable').not.toBeNull()
    await card(page).dragTo(target, {
      sourcePosition: { x: (box?.width ?? 40) / 4, y: 4 }
    })
  }

  test('dropping on the lane column posts the lane write to the batch endpoint', async ({
    page,
    request
  }) => {
    await expect(card(page)).toBeVisible()
    // `todo` is the first `user` lane of the tenhands-simple preset.
    const lane = page.locator('.task-app__tag-column').filter({ hasText: '#todo' })
    await expect(lane).toBeVisible()

    await expectLaneWrite(page, () => grabByPadding(page, lane))
    await expectLanded(request)
  })

  test('dropping on the lane’s filter chip posts the same write', async ({ page, request }) => {
    await expect(card(page)).toBeVisible()
    const chip = page.getByRole('button', { name: '#todo', exact: true })
    await expect(chip).toBeVisible()

    await expectLaneWrite(page, () => grabByPadding(page, chip))
    await expectLanded(request)
  })
})
