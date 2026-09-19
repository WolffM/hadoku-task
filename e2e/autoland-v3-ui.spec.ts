import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { API, apiUp, signIn } from './helpers/stack'

/**
 * The autoland v3 card + popout surface, end to end in a real browser.
 *
 * Three things move out of the lane system and onto the card, and each one is
 * only real if the DOM renders it and the write it produces reaches the server:
 *
 *   - `- [ ]` / `- [x]` become tappable checkboxes, and one primary Approve
 *     button. The load-bearing claim is that tapping writes THE SAME BYTES a
 *     human typing `- [x]` would — asserted here against the notes the server
 *     actually stored, not against the rendered markup, because a renderer that
 *     re-emitted the line would look identical and break both repos' parsing.
 *   - `status` renders as a chip, per `kind`, with the agent's label verbatim
 *     and `href` as a real link.
 *   - `claimed` renders at all, which it never has.
 *
 * And the consequence that ties them together: ticking the approval box has to
 * flip the card's question badge to "Answered", because that same predicate is
 * what fires the runner wake. A checkbox that renders but leaves the badge on
 * "1 open question" is an approval the pipeline never hears about.
 *
 * Requires the local API stack (`pnpm run dev:api`); skipped when it isn't up.
 */

const PLAN = `## What I think you want

Cache the lookups.

## Questions

- Should the TTL apply to negative lookups too?
- [ ] Approve this plan
`

async function createAutomationBoard(request: APIRequestContext, id: string) {
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
}

/**
 * Open this test's board and wait for ITS task, addressed by id.
 *
 * Not `.task-app__item` first-visible, and not a title filter. Board selection
 * persists, so `goto('/')` lands on whatever board was last active — which, with
 * user-scoped prefs shared across the whole run, can be another worker's board.
 * Every board here seeds a task with the same title, so a title filter happily
 * matches the WRONG board's card and the spec then asserts against someone
 * else's state. The task id carries the board id, so it cannot collide.
 */
async function openBoard(page: Page, boardId: string) {
  await page.goto('/')
  await page.getByRole('button', { name: boardId, exact: true }).click()
  await planCard(page, boardId).waitFor({ state: 'visible', timeout: 10000 })
}

const planCard = (page: Page, boardId: string) =>
  page.locator(`.task-app__item[data-task-id="${boardId}-plan"]`)

/** The notes as the SERVER holds them — never as the DOM shows them. */
async function storedNotes(
  request: APIRequestContext,
  boardId: string,
  taskId: string
): Promise<string> {
  const board = await (await request.get(`${API}/tasks?boardId=${boardId}`)).json()
  const tasks = board.tasks ?? board
  return tasks.find((t: { id: string }) => t.id === taskId).notes
}

/**
 * A board id nothing else can be holding.
 *
 * NOT derived from `test.info().testId`, which is the obvious choice and is
 * wrong twice over: it is a hash of file+title, so it is identical across
 * repeats AND across separate runs. The dev stack keeps ONE in-memory DB for its
 * whole lifetime, activation is permanent, and re-POSTing an existing task id
 * leaves its notes alone — so a testId-keyed board is good for exactly one
 * invocation, after which these tests re-open the board they already ticked and
 * assert against their own leftovers. Every test here mutates the plan, which is
 * why this spec is the one that trips over it.
 */
const freshBoardId = () => `v3-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

test.describe('autoland v3 card surface', () => {
  let boardId: string

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (pnpm run dev:api)')
    boardId = freshBoardId()
    await createAutomationBoard(request, boardId)
    await request.post(API, {
      data: {
        boardId,
        tag: 'plan-review',
        id: `${boardId}-plan`,
        title: 'Plan with approval',
        notes: PLAN
      }
    })
    await signIn(page)
    await openBoard(page, boardId)
  })

  test('a task-list item renders as a checkbox, and ticking it writes `- [x]`', async ({
    page,
    request
  }) => {
    await planCard(page, boardId).getByRole('button', { name: 'Open notes' }).click()

    const boxes = page.locator('.plan-md__checkbox')
    await expect(boxes).toHaveCount(1)
    await expect(boxes.first()).not.toBeChecked()
    // The prose question beside it is NOT a checkbox — only task-list items are.
    await expect(page.locator('.notes-popout__section--questions li')).toHaveCount(2)

    await boxes.first().check()
    await expect(boxes.first()).toBeChecked()

    // The whole point: the same bytes, and nothing else disturbed.
    const notes = await storedNotes(request, boardId, `${boardId}-plan`)
    expect(notes).toContain('- [x] Approve this plan')
    expect(notes).not.toContain('- [ ] Approve this plan')
    expect(notes).toContain('- Should the TTL apply to negative lookups too?')
    expect(notes).toContain('## What I think you want\n\nCache the lookups.')
  })

  test('the Approve button ticks the box, and only shows while one is unticked', async ({
    page,
    request
  }) => {
    await planCard(page, boardId).getByRole('button', { name: 'Open notes' }).click()

    const approve = page.getByRole('button', { name: 'Approve', exact: true })
    await expect(approve).toBeVisible()
    await approve.click()

    // It writes through the checkbox, not around it.
    await expect(page.locator('.plan-md__checkbox').first()).toBeChecked()
    expect(await storedNotes(request, boardId, `${boardId}-plan`)).toContain(
      '- [x] Approve this plan'
    )

    // Nothing left to approve ⇒ no button. The notes are the only state.
    await expect(approve).toHaveCount(0)
  })

  test('approving flips the card badge to answered — the predicate the wake fires on', async ({
    page
  }) => {
    // Both the prose question and the unticked box are open asks.
    await expect(planCard(page, boardId).locator('.task-app__item-questions')).toHaveText(
      '2 open questions'
    )

    await planCard(page, boardId).getByRole('button', { name: 'Open notes' }).click()
    // Answer the prose question, then approve — the human's full turn.
    await page.locator('#notes-popout-reply').fill('Yes, negative lookups too.')
    await page.getByRole('button', { name: 'Add answer' }).click()
    await expect(page.locator('#notes-popout-reply')).toHaveValue('')

    // The box is still outstanding, so this is "send it back", not approval.
    await expect(page.locator('.notes-popout__question-count')).toHaveText('1 open question')

    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.locator('.notes-popout__question-count')).toHaveText('Answered questions')

    await page.locator('.notes-popout__close').click()
    await expect(planCard(page, boardId).locator('.task-app__item-questions')).toHaveText(
      'Answered questions'
    )
  })

  test('an agent status renders as a chip, per kind, with the label verbatim', async ({
    page,
    request
  }) => {
    // Written the only way it can be: by the claim holder.
    const claim = await (
      await request.post(`${API}/agent/claim`, {
        data: { board: boardId, taskId: `${boardId}-plan`, agentId: 'tenhands' }
      })
    ).json()
    const released = await request.post(`${API}/agent/release`, {
      data: {
        board: boardId,
        taskId: `${boardId}-plan`,
        token: claim.token,
        lane: 'plan-review',
        status: {
          kind: 'blocked',
          label: 'waiting on CI',
          href: 'https://github.com/WolffM/hadoku-conjure/pull/42'
        }
      }
    })
    expect(released.ok()).toBe(true)

    await openBoard(page, boardId)
    const chip = planCard(page, boardId).locator('.task-app__status-chip')
    await expect(chip).toBeVisible()
    await expect(chip).toHaveClass(/task-app__status-chip--blocked/)
    // The agent's free text, rendered and not parsed.
    await expect(chip).toContainText('waiting on CI')
    // `href` makes the whole chip the link.
    await expect(chip).toHaveAttribute('href', 'https://github.com/WolffM/hadoku-conjure/pull/42')
    // A glyph, not an emoji — the registry is the only source of icons here.
    await expect(chip.locator('svg')).toHaveCount(1)
  })

  test('a live claim shows on the card, and goes away when it is released', async ({
    page,
    request
  }) => {
    await expect(planCard(page, boardId).locator('.task-app__item-claimed')).toHaveCount(0)

    const claim = await (
      await request.post(`${API}/agent/claim`, {
        data: { board: boardId, taskId: `${boardId}-plan`, agentId: 'tenhands' }
      })
    ).json()

    await openBoard(page, boardId)
    await expect(planCard(page, boardId).locator('.task-app__item-claimed')).toBeVisible()

    await request.post(`${API}/agent/release`, {
      data: { board: boardId, taskId: `${boardId}-plan`, token: claim.token, lane: 'plan-review' }
    })
    await openBoard(page, boardId)
    await expect(planCard(page, boardId).locator('.task-app__item-claimed')).toHaveCount(0)
  })
})
