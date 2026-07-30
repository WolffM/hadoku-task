import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

/**
 * A drag the server refuses must be undone, and must say why.
 *
 * Lane writes go out through `backgroundSync` — optimistic, fire-and-forget — so
 * before this the refusal was invisible where it mattered: the card sat in the
 * lane it never reached, localStorage disagreed with the server, and the only
 * signal was a toast reading "Server rejected batchUpdateTags — changes may not
 * persist". It had in fact definitely not persisted, and the card would snap back
 * at the next full sync, which reads as data loss.
 *
 * The rule now: a DEFINITIVE refusal (4xx, excluding the retryable 408/429) rolls
 * the optimistic write back and shows the server's own words. A transient failure
 * (5xx, network) still keeps the local edit, because there the server may yet
 * have it and discarding the user's work would be the worse guess.
 *
 * The 403 case is driven against the REAL worker, not a mocked response — that is
 * the one that must not regress. Requires `node scripts/dev-api.mjs`.
 */

const API = 'http://127.0.0.1:3001/task/api'

async function apiUp(request: APIRequestContext): Promise<boolean> {
  try {
    return (await request.get(`${API}/automation/presets`)).ok()
  } catch {
    return false
  }
}

/** An automation board on the tenhands-simple preset: `todo`/`review` user, `working` agent. */
async function createBoard(request: APIRequestContext, id: string) {
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

/**
 * Drive the app's OWN drag protocol: one DataTransfer carried from `dragstart` on
 * the card through to `drop` on the lane chip.
 *
 * Playwright's `locator.dragTo()` hangs indefinitely on these chips — it never
 * returns even with its own timeout set — so synthesising the events the handlers
 * actually read (`application/x-hadoku-task-ids`) is what makes this testable.
 */
async function dropOnLaneChip(page: Page, title: string, lane: string) {
  const result = await page.evaluate(
    ({ title, lane }) => {
      const card = [...document.querySelectorAll('.task-app__item')].find(el =>
        el.textContent?.includes(title)
      ) as HTMLElement | undefined
      const chip = [...document.querySelectorAll('button')].find(
        el => el.textContent?.trim() === `#${lane}`
      ) as HTMLElement | undefined
      if (!card || !chip) return { ok: false, foundCard: !!card, foundChip: !!chip }
      const dt = new DataTransfer()
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      chip.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }))
      chip.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
      return { ok: true, types: [...dt.types] }
    },
    { title, lane }
  )
  expect(result.ok, `card "${title}" and chip "#${lane}" should both exist`).toBe(true)
  // If the app ever stops writing its own type, the drop silently moves nothing.
  expect(result.types).toContain('application/x-hadoku-task-ids')
}

const cardTags = (page: Page, title: string) =>
  page
    .locator('.task-app__item')
    .filter({ hasText: title })
    .locator('.task-app__item-tag')
    .allTextContents()

const serverTag = async (request: APIRequestContext, boardId: string, taskId: string) => {
  const body = await (await request.get(`${API}/tasks?boardId=${boardId}`)).json()
  return body.tasks.find((t: { id: string }) => t.id === taskId)?.tag ?? null
}

test.describe('a refused lane drag', () => {
  let boardId: string
  let taskId: string

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')
    // Unique per RUN: the dev stack's in-memory DB outlives a playwright invocation.
    boardId = `refuse-${Date.now().toString(36)}${test
      .info()
      .testId.replace(/[^a-z0-9]/gi, '')
      .slice(0, 6)}`
    taskId = `${boardId}-t`
    await createBoard(request, boardId)
    expect(
      (await request.post(API, { data: { boardId, id: taskId, title: 'Refused move' } })).ok()
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

  test('into an agent lane: the real worker refuses, the card comes back, the toast says why', async ({
    page,
    request
  }) => {
    const refusal = page.waitForResponse(r => /batch-tag|update-tags/.test(r.url()))
    await dropOnLaneChip(page, 'Refused move', 'working')
    expect((await refusal).status()).toBe(403)

    // The server's own words, not an internal operation name — and it states the
    // move was undone rather than hedging that it "may not persist".
    const toast = page.locator('.toast, [role="alert"]').filter({ hasText: 'agent-owned' })
    await expect(toast.first()).toBeVisible({ timeout: 5000 })
    await expect(toast.first()).toContainText('move undone')

    // The optimistic move is rolled back, so the UI agrees with the server again.
    await expect.poll(() => cardTags(page, 'Refused move'), { timeout: 5000 }).toEqual([])
    expect(await serverTag(request, boardId, taskId)).toBeNull()
  })

  test('into a user lane: the move sticks, with no toast and no revert', async ({
    page,
    request
  }) => {
    const ok = page.waitForResponse(r => /batch-tag|update-tags/.test(r.url()))
    await dropOnLaneChip(page, 'Refused move', 'todo')
    expect((await ok).status()).toBe(200)

    await expect.poll(() => cardTags(page, 'Refused move'), { timeout: 5000 }).toEqual(['#todo'])
    await expect.poll(() => serverTag(request, boardId, taskId), { timeout: 5000 }).toBe('todo')
    // A successful write must not trip the refusal path.
    await expect(page.locator('.toast, [role="alert"]').filter({ hasText: 'undone' })).toHaveCount(
      0
    )
  })

  test('on a 5xx: the local edit is KEPT, because the server may still have it', async ({
    page
  }) => {
    await page.route(/batch-tag|update-tags/, route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    )
    await dropOnLaneChip(page, 'Refused move', 'todo')

    // Generic message (the server offered no reason) and, critically, no revert:
    // discarding a user's edit over a transient failure is the worse guess.
    const toast = page.locator('.toast, [role="alert"]').filter({ hasText: 'Server rejected' })
    await expect(toast.first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.toast, [role="alert"]').filter({ hasText: 'undone' })).toHaveCount(
      0
    )
    expect(await cardTags(page, 'Refused move')).toEqual(['#todo'])
  })
})
