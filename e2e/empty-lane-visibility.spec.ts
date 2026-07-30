import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

/**
 * An automation board hides its empty lanes — including AFTER a drag.
 *
 * Those boards declare their whole lane vocabulary up front (`todo`, `working`,
 * `review`, …), so most lanes sit empty most of the time and rendering them all
 * turns the board into a wall of empty columns. They come back for the duration
 * of a drag, because an empty lane is still a drop target and dragging is how a
 * task advances.
 *
 * The regression this pins: drag teardown used to hang off the dragged card's own
 * `dragend`. A drop that moves the card re-renders it into a different column, so
 * the source `<li>` unmounts and `dragend` is never dispatched — the board stayed
 * in "drag in flight" state and every empty lane stayed visible until a reload.
 * Two more leaks rode along on the same handler and are asserted here too: the
 * off-screen drag-image clone left on `document.body`, and the moved card left
 * selected.
 *
 * Needs the local API stack (`node scripts/dev-api.mjs`) for a real activated
 * board; skips itself when that isn't up.
 */

const API = 'http://127.0.0.1:3001/task/api'

async function apiUp(request: APIRequestContext): Promise<boolean> {
  try {
    return (await request.get(`${API}/automation/presets`)).ok()
  } catch {
    return false
  }
}

async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hadoku_session_id', 'dev-uid')
    localStorage.setItem('hadoku_user_type', 'friend')
  })
}

interface Lane {
  tag: string
  editableBy: 'user' | 'agent'
}

/** Activate a board of this test's own — activation is permanent and the dev DB is shared. */
async function createAutomationBoard(request: APIRequestContext, id: string): Promise<Lane[]> {
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
  const applied = await request.post(`${API}/boards/${id}/activate-automation`, {
    data: { ...input, expectedDigest: preview.preview.digest }
  })
  expect(applied.ok()).toBe(true)

  return preset.lanes as Lane[]
}

/**
 * `:not(.drag-image)` matters: the drag image is a full clone of the card parked
 * off-screen on `document.body`, so a leaked one is a second match for every card
 * selector — and having no layout, it turns a clean assertion into a boundingBox
 * timeout.
 */
const card = (page: Page, title: string) =>
  page.locator('.task-app__item:not(.drag-image)', { hasText: title }).first()

const column = (page: Page, tag: string) =>
  page.locator('.task-app__tag-column').filter({ has: page.locator(`h3:text-is("#${tag}")`) })

const laneHeadings = (page: Page) => page.locator('.task-app__tag-column h3')

const laneNames = (tags: string[]) => tags.map(t => `#${t}`)

/** Which section a task's card is rendered under. */
async function sectionOf(page: Page, title: string): Promise<string> {
  return card(page, title).evaluate(el => {
    const section = el.closest('.task-app__tag-column, .task-app__remaining')
    return section?.querySelector('h3')?.textContent ?? 'no section'
  })
}

/**
 * Drag a card into a lane, natively, by its FILTER CHIP.
 *
 * Two constraints pick this target. `dragTo` (rather than a hand-rolled
 * mouse.down/move sequence) because synthesizing the press ourselves promotes
 * mousedown into a real dragstart only sometimes — it is timing-dependent and
 * flakes hard under parallel workers. And the chip rather than the lane column
 * because Chromium stops producing frames while it holds a drag, which starves
 * every Playwright wait (they all poll from requestAnimationFrame): a target that
 * appears only once the drag is under way — an empty lane's column — is one
 * `dragTo` can never resolve. The chip is always on screen, and `onFilterDrop`
 * writes the same lane change as the column's `onDrop`
 * (lane-drag-wakes-runner.spec.ts asserts both).
 *
 * The source position is the card's PADDING: a card is a drag handle everywhere
 * except on its own text (card-drag-vs-select.spec.ts), and its centre is title.
 */
async function dragCardToLane(page: Page, title: string, tag: string) {
  const box = await card(page, title).boundingBox()
  expect(box, 'card should be measurable').not.toBeNull()
  const chip = page.getByRole('button', { name: `#${tag}`, exact: true })
  await expect(chip).toBeVisible()
  await card(page, title).dragTo(chip, { sourcePosition: { x: (box?.width ?? 40) / 4, y: 4 } })
}

/**
 * Start a drag by dispatching the events, and hand back the means to end it the
 * way the browser does. Real DragEvents off a real DataTransfer, so the app's own
 * handlers run unmodified — this is only about being able to observe the board
 * mid-drag at all.
 */
async function syntheticDrag(page: Page, title: string) {
  await card(page, title).evaluate(el => {
    const dt = new DataTransfer()
    ;(window as unknown as { __dt: DataTransfer }).__dt = dt
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  })
  return {
    /**
     * Drop on a lane COLUMN. No `dragend` follows, exactly as in the browser: the
     * card is re-rendered into the target column, so the source node is gone
     * before `dragend` would be dispatched. That absence IS the bug's condition.
     */
    async dropOnColumn(tag: string) {
      await column(page, tag).evaluate(el => {
        const dt = (window as unknown as { __dt: DataTransfer }).__dt
        el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }))
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
      })
    },
    /** The `dragend` the browser fires when a drag is cancelled or dropped on nothing. */
    async cancel() {
      await card(page, title).evaluate(el => {
        const dt = (window as unknown as { __dt: DataTransfer }).__dt
        el.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
      })
    }
  }
}

test.describe('automation board: empty lanes', () => {
  let boardId: string
  let lanes: string[]
  /** The lane the card gets moved into: empty, and one a HUMAN is allowed to write. */
  let target: string

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')
    // Unique per RUN as well as per test: the dev stack's in-memory DB outlives a
    // playwright invocation, so a deterministic id would find the board — and the
    // already-moved task — still there.
    boardId = `lanes-${test.info().testId.replace(/[^a-z0-9]/gi, '')}-${Date.now().toString(36)}`
    const declared = await createAutomationBoard(request, boardId)
    lanes = declared.map(l => l.tag)
    expect(lanes.length).toBeGreaterThan(2)
    // Not just any empty lane: a move into an AGENT lane is refused and rolled
    // back by the worker (refused-lane-drag.spec.ts), so it would never land.
    const userLane = declared.slice(1).find(l => l.editableBy === 'user')
    expect(userLane, 'preset should declare a second user-writable lane').toBeDefined()
    target = userLane?.tag ?? ''

    for (const t of [
      { id: `${boardId}-seed`, title: 'Seeded in lane one', tag: lanes[0] },
      { id: `${boardId}-loose`, title: 'Untriaged capture' }
    ]) {
      expect((await request.post(API, { data: { boardId, ...t } })).ok()).toBe(true)
    }

    await signIn(page)
    await page.goto('/')
    await page.getByRole('button', { name: boardId, exact: true }).click()
    await expect(card(page, 'Seeded in lane one')).toBeVisible({ timeout: 10000 })
    await page.waitForLoadState('networkidle')
  })

  test('only lanes holding tasks are rendered', async ({ page }) => {
    await expect(laneHeadings(page)).toHaveText(laneNames([lanes[0]]))
    expect(await sectionOf(page, 'Untriaged capture')).toBe('Inbox')
  })

  test('the empty lanes come back for the duration of a drag', async ({ page }) => {
    const drag = await syntheticDrag(page, 'Untriaged capture')
    // Every declared lane is on screen, so an empty one can be dropped into at all.
    await expect(laneHeadings(page)).toHaveText(laneNames(lanes))

    await drag.cancel()

    // ...and they go away again when the drag ends having moved nothing.
    await expect(laneHeadings(page)).toHaveText(laneNames([lanes[0]]))
    expect(await sectionOf(page, 'Untriaged capture')).toBe('Inbox')
    await expect(page.locator('.drag-image')).toHaveCount(0)
  })

  test('the empty lanes go away again after a card is dropped into one', async ({ page }) => {
    await dragCardToLane(page, 'Untriaged capture', target)

    await expect.poll(() => sectionOf(page, 'Untriaged capture')).toBe(`#${target}`)
    // The target lane is occupied now and stays; the lanes still empty collapse.
    // Before the fix all three stayed up for the rest of the session.
    await expect(laneHeadings(page)).toHaveText(laneNames([lanes[0], target]))
  })

  test('...and after a drop on the lane COLUMN, which only exists mid-drag', async ({ page }) => {
    // The other drop handler, and the one the report came from: dropping on the
    // column of a lane that the drag itself put on screen.
    const drag = await syntheticDrag(page, 'Untriaged capture')
    await expect(laneHeadings(page)).toHaveText(laneNames(lanes))
    await drag.dropOnColumn(target)

    await expect.poll(() => sectionOf(page, 'Untriaged capture')).toBe(`#${target}`)
    await expect(laneHeadings(page)).toHaveText(laneNames([lanes[0], target]))
  })

  test('a completed drag leaves no drag image, dragging class, or selection behind', async ({
    page
  }) => {
    await dragCardToLane(page, 'Untriaged capture', target)
    await expect.poll(() => sectionOf(page, 'Untriaged capture')).toBe(`#${target}`)

    await expect(page.locator('.drag-image')).toHaveCount(0)
    await expect(page.locator('.task-app__item.dragging')).toHaveCount(0)
    await expect(page.locator('.task-app__item.selected')).toHaveCount(0)
  })
})
