import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { pointPrefsAtLocalStack } from './helpers/prefs'
import { API, apiUp, signIn } from './helpers/stack'

/**
 * A completed task stays in ITS OWN lane until its grace window closes.
 *
 * Lane presence used to be computed from ACTIVE tasks while the board rendered
 * active-plus-recently-completed. A lane whose tasks were all completed
 * therefore disappeared, and its tasks fell through to the untagged block —
 * "Other Tasks" on a standard board, "Inbox" on an automation one. That block
 * means "this has no tag", so three struck-through `#landed` tasks sitting in
 * the Inbox was the board lying about them.
 *
 * Public mode: no backend, no secrets.
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

const column = (page: Page, tag: string) =>
  page.locator('.task-app__tag-column').filter({ has: page.locator(`h3:text-is("#${tag}")`) })

/** Which section a task's card is rendered under. */
async function sectionOf(page: Page, title: string): Promise<string> {
  return card(page, title).evaluate(el => {
    const section = el.closest('.task-app__tag-column, .task-app__remaining')
    return section?.querySelector('h3')?.textContent ?? 'no section'
  })
}

/**
 * Send prefs traffic to the local stack.
 *
 * Not because these specs assert on prefs — they don't — but because
 * @wolffm/prefs-client defaults to https://hadoku.me/prefs and derives its
 * whoami URL from it, so an unpointed page fires `https://hadoku.me/session/whoami`
 * at PRODUCTION on every load. In a sandboxed run that request never settles, and
 * a single never-settling request is enough to make `waitForLoadState('networkidle')`
 * hang until the 60s hook timeout — which is exactly how these specs sat red on
 * main. Nothing polls; one hung request is the whole story.
 */
test.describe('Completed tasks keep their lane', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?userType=public')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.locator('.task-app__input')).toBeVisible()
  })

  test('a lane whose tasks are all completed keeps its column', async ({ page }) => {
    await addTask(page, 'Merged the PR #landed')
    await addTask(page, 'Still working #wip')

    await expect(await sectionOf(page, 'Merged the PR')).toBe('#landed')

    await card(page, 'Merged the PR').locator('.task-app__complete-btn').click()
    await expect(card(page, 'Merged the PR')).toHaveClass(/is-completed/)

    // The column survives its last active task, and the task stays inside it —
    // NOT in the untagged block, which is for tasks with no tag.
    await expect(column(page, 'landed')).toBeVisible()
    await expect.poll(() => sectionOf(page, 'Merged the PR')).toBe('#landed')
    await expect(
      page.locator('.task-app__remaining .task-app__item', { hasText: 'Merged the PR' })
    ).toHaveCount(0)
  })

  test('lanes with live work still rank above a fully-completed lane', async ({ page }) => {
    await addTask(page, 'Done one #landed')
    await addTask(page, 'Done two #landed')
    await addTask(page, 'Active work #wip')

    for (const title of ['Done one', 'Done two']) {
      await card(page, title).locator('.task-app__complete-btn').click()
      await expect(card(page, title)).toHaveClass(/is-completed/)
    }

    // #landed had the higher task count, but ranking reads live work, so #wip
    // leads and #landed rides along at the tail rather than being dropped.
    const headings = await page.locator('.task-app__tag-column h3').allTextContents()
    expect(headings).toEqual(['#wip', '#landed'])
  })

  test('a genuinely untagged task still lands in the untagged block', async ({ page }) => {
    await addTask(page, 'Anchor lane #wip')
    await addTask(page, 'No tag at all')

    expect(await sectionOf(page, 'No tag at all')).toBe('Other Tasks')
  })
})

/**
 * The same rule on an automation board, which is where it was reported: those
 * boards hide empty lanes, so a `landed` lane holding only struck-through tasks
 * collapsed and dropped them into the Inbox.
 *
 * Needs the local API stack (`node scripts/dev-api.mjs`) for a real activated
 * board, and skips itself when that isn't up — same contract as
 * plan-review.spec.ts.
 */

/** Activate a board of this test's own — activation is permanent and the dev DB is shared. */
async function createAutomationBoard(request: APIRequestContext, id: string): Promise<string[]> {
  await request.post(`${API}/boards`, { data: { id, name: id } })

  const presets = await (await request.get(`${API}/automation/presets`)).json()
  const preset = presets.presets.find((p: { schemaId: string }) => p.schemaId === 'tenhands')
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
    data: { ...input, digest: preview.preview.digest }
  })
  expect(applied.ok()).toBe(true)

  return (preset.lanes as Array<{ tag: string }>).map(l => l.tag)
}

test.describe('Completed tasks keep their lane: automation board', () => {
  let boardId: string
  let laneTag: string

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')
    // Unique per RUN, not just per test. testId alone is stable across runs, and
    // the dev stack keeps its DB for the life of the process — a re-run would
    // reuse the board AND the task, so the ✓ (a toggle) would REOPEN yesterday's
    // completed task instead of completing a fresh one.
    boardId = `lane-${test.info().testId.replace(/[^a-z0-9]/gi, '')}-${Date.now().toString(36)}`
    const lanes = await createAutomationBoard(request, boardId)
    // The board's last declared lane — a terminal one, where finished work sits
    // and where the report came from. Read from the contract rather than named
    // here, so a preset change can't quietly point this at nothing.
    laneTag = lanes[lanes.length - 1]

    await request.post(API, {
      data: { boardId, id: `${boardId}-done`, title: 'Landed work', tag: laneTag }
    })
    await pointPrefsAtLocalStack(page)
    await signIn(page)
    await page.goto('/')
    await page.getByRole('button', { name: boardId, exact: true }).click()

    // Wait for the board to SETTLE, not merely to paint: the load is cache-first
    // with a network revalidate behind it, and a click landing in that gap gets
    // its optimistic update overwritten by the in-flight response.
    await expect(card(page, 'Landed work')).toBeVisible({ timeout: 10000 })
    await expect(column(page, laneTag)).toBeVisible()
    await page.waitForLoadState('networkidle')
  })

  test('completing the last task in a lane does not move it to the Inbox', async ({ page }) => {
    expect(await sectionOf(page, 'Landed work')).toBe(`#${laneTag}`)

    await card(page, 'Landed work').locator('.task-app__complete-btn').click()
    await expect(card(page, 'Landed work')).toHaveClass(/is-completed/)

    await expect.poll(() => sectionOf(page, 'Landed work')).toBe(`#${laneTag}`)
    await expect(
      page.locator('.task-app__remaining .task-app__item', { hasText: 'Landed work' })
    ).toHaveCount(0)
  })
})
