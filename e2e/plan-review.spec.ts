import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { API, apiUp, signIn } from './helpers/stack'

/**
 * The plan-review surface (§6), end to end in a real browser.
 *
 * An agent parks a task in `plan-review` with a plan in `notes` and stops; a
 * human reads that plan and answers in the same field. Every task on every
 * automation board passes through this, so the geometry is not cosmetic — the
 * regressions this guards are the ones that made review unusable:
 *
 *   - the plan rendered inside the task card, ~10% of it visible at a time
 *   - entering edit mode SHRANK the box you write the answer in
 *   - no affordance saying where, or whether, you are being asked anything
 *
 * Requires the local API stack (`node scripts/dev-api.mjs`), like the automation
 * preset spec; skipped when it isn't up so the default `pnpm test:e2e` stays
 * green.
 */

const PLAN = `## What I think you want

Ship the review surface so a plan stops being read through a keyhole.

## Plan

1. Move the body out of the card.
2. Make Questions impossible to miss.

## Questions

1. Should the reply append under Questions, or at the end of the doc?
2. Is Cmd+Enter the right save key?

## Settled

- Free text anywhere. No structured answer form.

## Blast radius

One component, one stylesheet.
`

/**
 * A board of this test's own, driven through the API rather than the preset
 * picker — activation is permanent, and the dev stack keeps one in-memory DB for
 * the whole run, so a shared board would leave the next test somewhere else.
 */
async function createAutomationBoard(request: APIRequestContext, id: string) {
  await request.post(`${API}/boards`, { data: { id, name: id } })

  const presets = await (await request.get(`${API}/automation/presets`)).json()
  const preset = presets.presets.find((p: { schemaId: string }) => p.schemaId === 'tenhands')
  const input = {
    schemaId: preset.schemaId,
    schemaVersion: preset.schemaVersion,
    lanes: preset.lanes
  }

  // Preview-then-commit: the committing call has to echo the preview's digest.
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

async function createTask(
  request: APIRequestContext,
  boardId: string,
  task: { id: string; title: string; notes: string }
) {
  const res = await request.post(API, { data: { boardId, tag: 'plan-review', ...task } })
  expect(res.ok()).toBe(true)
  // `boardId` is derived from `testId`, which is stable ACROSS runs, and the dev
  // stack's D1 outlives the suite — so a re-run finds these rows already there
  // and the POST above leaves them as they are. Any test that writes to a task
  // (answering one, ticking a box) would then hand its successor a fixture that
  // is already half-answered, and the failure looks exactly like a parser bug.
  // Patching declared state back over the row makes each run start where the
  // fixture says, whatever the last one did to it.
  const reset = await request.patch(`${API}/${task.id}`, { data: { boardId, notes: task.notes } })
  expect(reset.ok()).toBe(true)
}

/** Open the board and wait for its lanes to render. */
async function openBoard(page: Page, boardId: string) {
  await page.goto('/')
  await page.getByRole('button', { name: boardId, exact: true }).click()
  await page.locator('.task-app__item').first().waitFor({ state: 'visible', timeout: 10000 })
}

const card = (page: Page, title: string) =>
  page.locator('.task-app__item').filter({ hasText: title })

/** boundingBox() is nullable for a hidden element; every caller here needs it visible. */
async function boxOf(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox()
  expect(box, 'element should be visible and measurable').not.toBeNull()
  return box ?? { x: 0, y: 0, width: 0, height: 0 }
}

test.describe('plan review', () => {
  let boardId: string

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')
    // Unique per test, not just per run: activation is permanent and the dev
    // stack shares one in-memory DB, so two parallel workers landing on the same
    // millisecond would fight over one board.
    boardId = `plan-${test.info().testId.replace(/[^a-z0-9]/gi, '')}`
    await createAutomationBoard(request, boardId)
    await createTask(request, boardId, {
      id: `${boardId}-a`,
      title: 'Plan under review',
      notes: PLAN
    })
    await createTask(request, boardId, {
      id: `${boardId}-b`,
      title: 'Nothing to answer',
      notes: '## Questions\n\nNo open questions.\n'
    })
    await createTask(request, boardId, { id: `${boardId}-c`, title: 'Nothing written', notes: '' })
    await createTask(request, boardId, {
      id: `${boardId}-d`,
      title: 'Sentinel wrapped in emphasis',
      notes: '## Questions\n\n_No open questions._\n'
    })
    await createTask(request, boardId, {
      id: `${boardId}-e`,
      title: 'Sentinel as a bullet',
      notes: '## Questions\n\n- No open questions.\n'
    })
    // A plan as TenHands actually renders it: their `— pass N` bookkeeping
    // footer on the last line. With no acceptance criteria to propose,
    // `## Questions` IS the last section, so the footer lands in its body.
    await createTask(request, boardId, {
      id: `${boardId}-f`,
      title: 'Footed plan',
      notes: `## Questions\n\n- Which branch should this land on?\n\n— pass 2 · confidence 0.8\n`
    })
    await createTask(request, boardId, {
      id: `${boardId}-g`,
      title: 'Footed sentinel',
      notes: `## Questions\n\n_No open questions._\n\n— pass 1\n`
    })
    await signIn(page)
    await openBoard(page, boardId)
  })

  test('the card says how many questions are waiting, and only when some are', async ({ page }) => {
    await expect(card(page, 'Plan under review').locator('.task-app__item-questions')).toHaveText(
      '2 open questions'
    )
    await expect(card(page, 'Nothing to answer').locator('.task-app__item-questions')).toHaveCount(
      0
    )
    await expect(
      card(page, 'Sentinel wrapped in emphasis').locator('.task-app__item-questions')
    ).toHaveCount(0)
    await expect(
      card(page, 'Sentinel as a bullet').locator('.task-app__item-questions')
    ).toHaveCount(0)
  })

  test('the plan opens outside the card, at a real size', async ({ page }) => {
    await card(page, 'Plan under review').getByRole('button', { name: 'Open notes' }).click()

    const panel = page.locator('.notes-popout')
    await expect(panel).toBeVisible()

    // Outside the task card (which clips and drags) but inside the app root,
    // which is where every theme token is scoped — a panel portalled to <body>
    // keeps the light defaults and burns white into a dark board.
    expect(
      await panel.evaluate(el => ({
        inCard: !!el.closest('.task-app__item'),
        inApp: !!el.closest('.task-app-container')
      }))
    ).toEqual({ inCard: false, inApp: true })

    const box = await boxOf(panel)
    const viewport = page.viewportSize() ?? { width: 0, height: 0 }
    expect(box.width).toBeGreaterThan(viewport.width * 0.5)
    expect(box.height).toBeGreaterThan(viewport.height * 0.6)
  })

  test('the plan renders as sections, with Questions marked out', async ({ page }) => {
    await card(page, 'Plan under review').getByRole('button', { name: 'Open notes' }).click()

    await expect(page.locator('.notes-popout__section-title')).toHaveText([
      'What I think you want',
      'Plan',
      'Questions',
      'Settled',
      'Blast radius'
    ])
    // Exactly one section is singled out, and it's the one that asks something.
    const questions = page.locator('.notes-popout__section--questions')
    await expect(questions).toHaveCount(1)
    await expect(questions.locator('.notes-popout__section-title')).toHaveText('Questions')
    await expect(questions.locator('li')).toHaveCount(2)
    // The answer box sits inside that section, not somewhere you have to find.
    await expect(questions.locator('#notes-popout-reply')).toBeVisible()
  })

  test('edit mode is never smaller than read mode', async ({ page }) => {
    await card(page, 'Plan under review').getByRole('button', { name: 'Open notes' }).click()

    const reading = await boxOf(page.locator('.notes-popout__body'))
    await page.locator('.notes-popout__footer').getByRole('button', { name: 'Edit' }).click()

    const writing = await boxOf(page.locator('.notes-popout__editor'))
    expect(writing.width).toBeGreaterThanOrEqual(reading.width)
    expect(writing.height).toBeGreaterThanOrEqual(reading.height * 0.9)
    // The whole plan, not a six-row window onto it.
    expect(writing.width * writing.height).toBeGreaterThan(200_000)
  })

  test('an answer appends into the notes under Questions, leaving the plan intact', async ({
    page,
    request
  }) => {
    await card(page, 'Plan under review').getByRole('button', { name: 'Open notes' }).click()
    await page.locator('#notes-popout-reply').fill('Under Questions, and yes to Cmd+Enter.')
    await page.getByRole('button', { name: 'Add answer' }).click()

    // The box clears on success, which is what tells the reviewer it landed.
    await expect(page.locator('#notes-popout-reply')).toHaveValue('')

    const board = await (await request.get(`${API}/tasks?boardId=${boardId}`)).json()
    const tasks = board.tasks ?? board
    const notes: string = tasks.find((t: { id: string }) => t.id === `${boardId}-a`).notes

    expect(notes).toContain('Under Questions, and yes to Cmd+Enter.')
    // Placed inside the Questions section...
    expect(notes.indexOf('Under Questions, and yes')).toBeGreaterThan(notes.indexOf('## Questions'))
    expect(notes.indexOf('Under Questions, and yes')).toBeLessThan(notes.indexOf('## Settled'))
    // ...and nothing the agent wrote was disturbed.
    expect(notes).toContain('## Blast radius\n\nOne component, one stylesheet.')
    expect(notes).toContain('1. Should the reply append under Questions, or at the end of the doc?')
  })

  test("a reviewer's own answer switches the badge to answered, not counted back as a question", async ({
    page,
    request
  }) => {
    await card(page, 'Plan under review').getByRole('button', { name: 'Open notes' }).click()
    await page.locator('#notes-popout-reply').fill('Both answered.')
    await page.getByRole('button', { name: 'Add answer' }).click()
    await expect(page.locator('#notes-popout-reply')).toHaveValue('')

    // The popout header goes quiet on "open" and reads "answered" instead —
    // not silence, and not still nagging.
    await expect(page.locator('.notes-popout__question-count')).toHaveText('Answered questions')
    await expect(page.locator('.notes-popout__question-count')).toHaveClass(
      /notes-popout__question-count--answered/
    )
    await page.locator('.notes-popout__close').click()

    // Same tri-state on the card itself.
    await expect(card(page, 'Plan under review').locator('.task-app__item-questions')).toHaveText(
      'Answered questions'
    )
    await expect(card(page, 'Plan under review').locator('.task-app__item-questions')).toHaveClass(
      /task-app__item-questions--answered/
    )

    // A replan rewrites notes wholesale with a fresh, un-replied Questions
    // list — the badge has to flip straight back to "open", not stay stuck on
    // "answered" from the reply that no longer applies to anything.
    const patched = await request.patch(`${API}/${boardId}-a`, {
      data: {
        boardId,
        notes: `## Questions\n\n1. Is the new plan good?\n2. Anything else to settle?\n`
      }
    })
    expect(patched.ok()).toBe(true)
    await openBoard(page, boardId)
    await expect(card(page, 'Plan under review').locator('.task-app__item-questions')).toHaveText(
      '2 open questions'
    )
  })

  test("the emitter's own pass footer is not read back as a reviewer's answer", async ({
    page
  }) => {
    // The footer is an item, a blank line, then prose — byte-for-byte the shape
    // of a human's trailing reply, which is why it read as one. A plan nobody
    // has touched must still be asking.
    await expect(card(page, 'Footed plan').locator('.task-app__item-questions')).toHaveText(
      '1 open question'
    )
    await expect(card(page, 'Footed plan').locator('.task-app__item-questions')).not.toHaveClass(
      /task-app__item-questions--answered/
    )
    // The sentinel asks nothing; footed, it was reading as "answered" instead,
    // which is the opposite meaning rather than a near miss.
    await expect(card(page, 'Footed sentinel').locator('.task-app__item-questions')).toHaveCount(0)

    // And the transition the runner wake hangs on (§5.1) is the REVIEWER's
    // reply — false → true here, not already-true before anyone typed.
    await card(page, 'Footed plan').getByRole('button', { name: 'Open notes' }).click()
    await expect(page.locator('.notes-popout__question-count')).toHaveText('1 open question')
    await page.locator('#notes-popout-reply').fill('Land it on main.')
    await page.getByRole('button', { name: 'Add answer' }).click()
    await expect(page.locator('.notes-popout__question-count')).toHaveText('Answered questions')
    await page.locator('.notes-popout__close').click()
    await expect(card(page, 'Footed plan').locator('.task-app__item-questions')).toHaveText(
      'Answered questions'
    )
  })

  test('Escape backs out of the editor first, then the dialog', async ({ page }) => {
    await card(page, 'Plan under review').getByRole('button', { name: 'Open notes' }).click()
    await page.locator('.notes-popout__footer').getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('.notes-popout__editor')).toBeVisible()

    // Losing a half-written answer to a stray Escape is the one thing this
    // surface can't afford, so the first press only leaves the editor.
    await page.keyboard.press('Escape')
    await expect(page.locator('.notes-popout__editor')).toHaveCount(0)
    await expect(page.locator('.notes-popout')).toBeVisible()

    // Focus has to come back to the panel for this second press to land at all.
    await page.keyboard.press('Escape')
    await expect(page.locator('.notes-popout')).toHaveCount(0)
    // The board scrolls again once the overlay is gone.
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
  })

  test('opening notes on a task with none starts in the editor, focused', async ({ page }) => {
    await card(page, 'Nothing written').getByRole('button', { name: 'Add notes' }).click()
    const editor = page.locator('.notes-popout__editor')
    await expect(editor).toBeFocused()

    // Typing goes into the plan, not nowhere.
    await page.keyboard.type('first line')
    await expect(editor).toHaveValue('first line')
  })

  test('a tall card keeps its controls where a short one has them', async ({ page }) => {
    const item = card(page, 'Plan under review')
    const glyphTop = async () =>
      item.evaluate(el => {
        const btn = el.querySelector('.task-app__notes-toggle')
        if (!btn) return -1
        // Distance from the card's top edge to the top of the glyph's own box.
        const padding = parseFloat(getComputedStyle(btn).paddingTop)
        return btn.getBoundingClientRect().top - el.getBoundingClientRect().top + padding
      })

    const short = await glyphTop()
    // Stretch the card the way a long body used to. Centering the glyph would
    // drag it to the middle of a 400px colour ribbon; pinned, it stays put.
    await item.evaluate(el => ((el as HTMLElement).style.height = '400px'))
    expect(await glyphTop()).toBeCloseTo(short, 0)
  })
})
