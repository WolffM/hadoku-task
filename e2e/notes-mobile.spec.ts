import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

/**
 * The notes popout on a phone.
 *
 * Every task on every automation board is reviewed through this panel, and a
 * good share of that reviewing happens on a phone. Two regressions made it
 * unusable there, and both are geometry rather than taste:
 *
 *   - the footer sat flush against the bottom of a `100vh` panel, which on
 *     Android Chrome is the viewport measured with the nav bar RETRACTED — so
 *     Close/Edit rendered underneath the nav bar and could not be tapped
 *   - the 24px desktop dialog title wrapped and pushed the question badge onto
 *     its own row, and the two footer buttons were 26px tall
 *
 * Requires the local API stack (`pnpm run dev:api`), and skips without it so the
 * default `pnpm test:e2e` stays green.
 */

const API = 'http://127.0.0.1:3001/task/api'

/** Below the 640px breakpoint, and the height of a Pixel with its nav bar up. */
const PHONE = { width: 393, height: 727 }

/** Apple's HIG minimum, and the number Material's 48dp rounds toward. */
const MIN_TOUCH_TARGET = 44

const PLAN = `## What I think you want

Ship the review surface so a plan stops being read through a keyhole.

## Plan

1. Move the body out of the card.
2. Make Questions impossible to miss.

## Questions

1. Should the reply append under Questions, or at the end of the doc?

## Blast radius

One component, one stylesheet.
`

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

async function boxOf(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox()
  expect(box, 'element should be visible and measurable').not.toBeNull()
  return box ?? { x: 0, y: 0, width: 0, height: 0 }
}

test.describe('notes popout on a phone', () => {
  test.use({ viewport: PHONE })

  let boardId: string

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (pnpm run dev:api)')
    boardId = `mob${test.info().testId.replace(/[^a-z0-9]/gi, '')}`
    await createAutomationBoard(request, boardId)
    await request.post(API, {
      data: {
        boardId,
        tag: 'plan-review',
        id: `${boardId}-a`,
        title: 'Plan under review',
        notes: PLAN
      }
    })
    await signIn(page)
    await page.goto('/')
    await page.getByRole('button', { name: boardId, exact: true }).click()
    await page.locator('.task-app__item').first().waitFor({ state: 'visible', timeout: 15000 })
    await page
      .locator('.task-app__item')
      .filter({ hasText: 'Plan under review' })
      .getByRole('button', { name: 'Open notes' })
      .click()
    await expect(page.locator('.notes-popout')).toBeVisible()
  })

  test('the footer buttons are reachable and big enough to tap', async ({ page }) => {
    for (const name of ['Close', 'Edit']) {
      const box = await boxOf(page.locator('.notes-popout__footer').getByRole('button', { name }))
      expect(box.height, `${name} is a touch target`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      // Wide, not a 60px sliver crammed against the right edge.
      expect(box.width, `${name} is wide`).toBeGreaterThan(PHONE.width / 4)
    }

    // The panel is sized off the viewport as DISPLAYED, so the footer keeps
    // clearance from the bottom edge instead of resting on it. On Android that
    // gap is what stops the nav bar from swallowing the buttons.
    const footer = await boxOf(page.locator('.notes-popout__footer'))
    const lastButton = await boxOf(
      page.locator('.notes-popout__footer').getByRole('button', { name: 'Edit' })
    )
    expect(footer.y + footer.height - (lastButton.y + lastButton.height)).toBeGreaterThan(0)

    // And they actually take a click at that position.
    await page.locator('.notes-popout__footer').getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('.notes-popout__editor')).toBeVisible()
  })

  test('the panel is measured against the displayed viewport, not the retracted one', async ({
    page
  }) => {
    // `100dvh`, not `100vh`: on Android Chrome the latter is the viewport with
    // the nav bar hidden, which pushes the footer underneath it.
    const overlayHeight = await page
      .locator('.notes-popout__overlay')
      .evaluate(el => getComputedStyle(el).height)
    const dvh = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.cssText = 'position:fixed;height:100dvh'
      document.body.append(probe)
      const h = getComputedStyle(probe).height
      probe.remove()
      return h
    })
    expect(overlayHeight).toBe(dvh)
  })

  test('the header fits on one row and the plan stays the readable size', async ({ page }) => {
    const title = page.locator('.notes-popout__title')
    const badge = page.locator('.notes-popout__question-count')

    // 24px wrapped the heading and bumped the badge to a second row.
    expect(
      await title.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    ).toBeLessThanOrEqual(16)

    const titleBox = await boxOf(title)
    const badgeBox = await boxOf(badge)
    expect(badgeBox.y, 'badge shares the title row').toBeLessThan(titleBox.y + titleBox.height)

    // Headings stay above body text so a plan is scannable while scrolling.
    const heading = await page
      .locator('.notes-popout__section-title')
      .first()
      .evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    const body = await page
      .locator('.plan-md')
      .first()
      .evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(heading).toBeGreaterThan(body)
  })

  test('text inputs are 16px, so focusing one does not zoom the page', async ({ page }) => {
    // Under 16px iOS Safari zooms on focus and does not zoom back out on blur,
    // leaving the board scaled and off-centre.
    const replyFont = await page
      .locator('#notes-popout-reply')
      .evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(replyFont).toBeGreaterThanOrEqual(16)

    await page.locator('.notes-popout__footer').getByRole('button', { name: 'Edit' }).click()
    const editorFont = await page
      .locator('.notes-popout__editor')
      .evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(editorFont).toBeGreaterThanOrEqual(16)
  })

  test('nothing in the panel overflows its width', async ({ page }) => {
    // Scoped to the panel on purpose. The board BEHIND the overlay has its own
    // horizontal overflow on a phone (the automation lane row is several
    // thousand px wide), which is a separate problem — asserting on
    // documentElement here would just re-report that one.
    const overflow = await page.evaluate(() => {
      const panel = document.querySelector('.notes-popout') as HTMLElement
      const body = document.querySelector('.notes-popout__body') as HTMLElement
      const right = panel.getBoundingClientRect().right
      const escapes = [...panel.querySelectorAll('*')]
        .filter(el => el.getBoundingClientRect().right > right + 1)
        .map(el => el.className.toString())
      return { escapes, bodyScrolls: body.scrollWidth > body.clientWidth }
    })
    expect(overflow).toEqual({ escapes: [], bodyScrolls: false })
  })
})
