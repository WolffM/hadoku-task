import { test, expect, type Page, type APIRequestContext, type CDPSession } from '@playwright/test'
import { API, apiUp, signIn } from './helpers/stack'

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

/** Below the 640px breakpoint, and the height of a Pixel with its nav bar up. */
const PHONE = { width: 393, height: 727 }

/** Apple's HIG minimum, and the number Material's 48dp rounds toward. */
const MIN_TOUCH_TARGET = 44

const PLAN = `## What I think you want

Ship the review surface so a plan stops being read through a keyhole.

## Plan

1. Move the body out of the card.
2. Make Questions impossible to miss.

${Array.from({ length: 14 }, (_, i) => `${i + 3}. Step ${i + 3}, so the plan is tall enough to scroll.`).join('\n')}

## Questions

1. Should the reply append under Questions, or at the end of the doc?

## Blast radius

One component, one stylesheet.
`

/**
 * One board for the whole file, not one per test. The dev stack shares a single
 * in-memory DB and automation activation is permanent, so a board per test piles
 * them into the board row — which at 393px wide overflows until the pills
 * overlap each other and the one you want stops being clickable.
 */
const BOARD_ID = 'notesmobile'

async function createAutomationBoard(request: APIRequestContext, id: string) {
  const existing = await (await request.get(`${API}/boards`)).json()
  const boards = existing.boards ?? existing
  if (Array.isArray(boards) && boards.some((b: { id: string }) => b.id === id)) return

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

/**
 * A real finger drag, through the browser's input pipeline, so a non-passive
 * touchmove listener calling preventDefault() actually suppresses it.
 *
 * `Input.synthesizeScrollGesture` with gestureSourceType 'touch' is NOT usable
 * here: it silently no-ops in this headless mode, and reports a dead scroller
 * even for a bare `overflow-y: auto` div with no application code on the page.
 * Verify any change to this helper against such a div before trusting a result.
 */
async function fingerDrag(c: CDPSession, x: number, fromY: number, toY: number) {
  const at = (y: number) => [{ x, y, radiusX: 12, radiusY: 12, force: 1 }]
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(fromY) })
  const step = fromY > toY ? -20 : 20
  for (let y = fromY + step; step < 0 ? y >= toY : y <= toY; y += step) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y) })
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/**
 * Guards the guard. `fingerDrag` is only evidence of anything if it can move a
 * scroller with no application code involved at all — a previous version of this
 * helper reported every scroller dead, which reads exactly like the bug it is
 * supposed to detect.
 */
test.describe('touch harness', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

  test('a finger drag scrolls a plain overflow container', async ({ page }) => {
    await page.setContent(
      `<body style="margin:0"><div id="c" style="position:fixed;inset:0;overflow-y:auto">
         <div style="height:3000px"></div></div></body>`
    )
    await fingerDrag(await page.context().newCDPSession(page), PHONE.width / 2, 500, 200)
    await page.waitForTimeout(400)
    expect(
      await page.evaluate(() => {
        const el = document.getElementById('c')
        return el ? Math.round(el.scrollTop) : -1
      })
    ).toBeGreaterThan(50)
  })
})

test.describe('notes popout on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (pnpm run dev:api)')
    await createAutomationBoard(request, BOARD_ID)
    // One task per test, so a test that edits notes can't disturb another's.
    const taskTitle = `Plan ${test
      .info()
      .testId.replace(/[^a-z0-9]/gi, '')
      .slice(0, 12)}`
    await request.post(API, {
      data: {
        boardId: BOARD_ID,
        tag: 'plan-review',
        id: `${BOARD_ID}-${taskTitle.replace(/\s/g, '')}`,
        title: taskTitle,
        notes: PLAN
      }
    })
    await signIn(page)
    await page.goto('/')
    // dispatchEvent, not click(): the board row overflows horizontally at 393px
    // once the rest of the suite has created its boards, so the pills overlap
    // and actionability never settles. The picker is setup here, not the
    // subject — everything under test lives inside the popout.
    await page.getByRole('button', { name: BOARD_ID, exact: true }).dispatchEvent('click')
    await page.locator('.task-app__item').first().waitFor({ state: 'visible', timeout: 15000 })
    // Park the page at its scroll origin first. The dev stack keeps ONE
    // in-memory DB for the whole run, so by the time the full suite has seeded
    // its boards the lane row is thousands of px wide and the document scrolls
    // sideways — which drags the layout viewport around under a `position:
    // fixed` overlay and makes every click inside it land somewhere else. That
    // width is an artifact of the shared DB, not of a real board.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page
      .locator('.task-app__item')
      .filter({ hasText: taskTitle })
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

    // Nothing is covering them: at its own centre, each button is the topmost
    // element. Asserted by hit-test rather than a real click, because the shared
    // dev DB can leave the page thousands of px wide, and the emulation zoom
    // that provokes desynchronises Playwright's click coordinates from where the
    // button is actually painted — a harness artifact that has nothing to say
    // about whether a finger would land on it.
    const topmost = await page.evaluate(() =>
      [...document.querySelectorAll('.notes-popout__footer button')].map(b => {
        const r = b.getBoundingClientRect()
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return { label: b.textContent?.trim(), coveredBy: hit === b ? null : hit?.className }
      })
    )
    expect(topmost).toEqual([
      { label: 'Close', coveredBy: null },
      { label: 'Edit', coveredBy: null }
    ])

    // And the handler fires.
    await page
      .locator('.notes-popout__footer')
      .getByRole('button', { name: 'Edit' })
      .dispatchEvent('click')
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

    await page
      .locator('.notes-popout__footer')
      .getByRole('button', { name: 'Edit' })
      .dispatchEvent('click')
    const editorFont = await page
      .locator('.notes-popout__editor')
      .evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(editorFont).toBeGreaterThanOrEqual(16)
  })

  test('a finger drag scrolls the plan in both directions', async ({ page }) => {
    const c = await page.context().newCDPSession(page)
    const scrollTop = () =>
      page.evaluate(() =>
        Math.round((document.querySelector('.notes-popout__body') as HTMLElement).scrollTop)
      )

    expect(await scrollTop()).toBe(0)

    // Finger up the screen => document scrolls down.
    await fingerDrag(c, PHONE.width / 2, 560, 220)
    await page.waitForTimeout(500)
    const down = await scrollTop()
    expect(down, 'dragging up scrolls into the plan').toBeGreaterThan(50)

    // Finger down the screen => back up the document. This is the direction the
    // page-level pull-to-refresh competes for.
    await fingerDrag(c, PHONE.width / 2, 220, 560)
    await page.waitForTimeout(500)
    expect(await scrollTop(), 'dragging down scrolls back up').toBeLessThan(down)
  })

  test('pull-to-refresh does not arm inside the dialog', async ({ page }) => {
    // The popout is a modal, so a downward pull inside it is a scroll, never a
    // request to reload the board behind it. Asserted on the mechanism because
    // the failure it guards is silent: the pull is swallowed, the plan appears
    // frozen, and releasing refreshes something the user cannot see.
    const armed = await page.evaluate(() => {
      const el = document.querySelector('#notes-popout-reply') ?? document.querySelector('.plan-md')
      return {
        insideModal: !!el?.closest('[aria-modal="true"]'),
        dialogPresent: !!document.querySelector('[aria-modal="true"]')
      }
    })
    expect(armed).toEqual({ insideModal: true, dialogPresent: true })
  })

  test('the plan does not chain its overscroll out to the page', async ({ page }) => {
    const behavior = await page
      .locator('.notes-popout__body')
      .evaluate(el => getComputedStyle(el).overscrollBehaviorY)
    expect(behavior).toBe('contain')
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

/**
 * A "title" is sometimes a whole paragraph — agents write the entire ask into
 * it. The header does not scroll and is flex-shrink: 0, so an unbounded title
 * took 463px of a 727px panel, squeezed the plan into a 195px slit, and pushed
 * its own opening lines off the top where no drag could reach them. That is the
 * shape of "I can see the questions but cannot scroll up to the rest".
 */
test.describe('a paragraph-length task title', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

  /** Verbatim length of a real one seen in the wild: ~700 characters. */
  const LONG_TITLE =
    'I need the director to respect when the mainline text is edited. Generally, ' +
    "it's been doing a good job, but if the text is manually edited or undo/redo " +
    'then the user is clearly not convinced with the direction and the director ' +
    'needs to pivot. Ideally the direction is recalibrated when this happens. To a ' +
    'lesser degree, this should also happen if the user chooses custom continuation. ' +
    "It's not necessarily that custom continuation means the direction is wrong, but " +
    'that the user has a sharper idea of what happens next. We should generally ' +
    'respect this in a sort of improv "yes, and" way. We still want the director to ' +
    'drive the story forward but with more alteration. There are two distinct asks here.'

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (pnpm run dev:api)')
    await createAutomationBoard(request, BOARD_ID)
    // Unique per test. The dev stack keeps one in-memory DB for the whole run
    // and a POST to an existing id does not rewrite its title, so a fixed id
    // silently measures whatever an earlier run seeded.
    const marker = `LT${test
      .info()
      .testId.replace(/[^a-z0-9]/gi, '')
      .slice(0, 10)}`
    await request.post(API, {
      data: {
        boardId: BOARD_ID,
        tag: 'plan-review',
        id: `${BOARD_ID}-long-${marker}`,
        title: `${marker} ${LONG_TITLE}`,
        notes: '## Questions\n\nNo open questions.\n\n— pass 1\n'
      }
    })
    await signIn(page)
    await page.goto('/')
    await page.getByRole('button', { name: BOARD_ID, exact: true }).dispatchEvent('click')
    await page.locator('.task-app__item').first().waitFor({ state: 'visible', timeout: 15000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page
      .locator('.task-app__item')
      .filter({ hasText: marker })
      .getByRole('button', { name: 'Open notes' })
      .dispatchEvent('click')
    await expect(page.locator('.notes-popout')).toBeVisible()
  })

  test('the title cannot eat the panel', async ({ page }) => {
    const { headerH, bodyH, panelH } = await page.evaluate(() => {
      const h = (s: string) =>
        Math.round((document.querySelector(s) as HTMLElement).getBoundingClientRect().height)
      return {
        headerH: h('.notes-popout__header'),
        bodyH: h('.notes-popout__body'),
        panelH: h('.notes-popout')
      }
    })
    // It took 64% of the panel before; the plan is the point of the surface.
    expect(headerH).toBeLessThan(panelH * 0.45)
    expect(bodyH).toBeGreaterThan(panelH * 0.4)
  })

  test('the title is bounded, and scrolls rather than being clipped', async ({ page }) => {
    const reach = await page.evaluate(() => {
      const heading = document.querySelector('.notes-popout__heading') as HTMLElement
      const panel = document.querySelector('.notes-popout') as HTMLElement
      const close = document.querySelector('.notes-popout__close') as HTMLElement
      const closeBefore = close.getBoundingClientRect().top
      const panelH = panel.getBoundingClientRect().height
      heading.scrollTop = heading.scrollHeight
      return {
        // Bounded: unfixed this grows to whatever the title needs, and the plan
        // below it starves.
        bounded: heading.clientHeight <= panelH * 0.35,
        // And what does not fit is scrollable, so no line is stranded.
        scrolledToEnd: heading.scrollTop >= heading.scrollHeight - heading.clientHeight - 1,
        overflows: heading.scrollHeight > heading.clientHeight,
        closePinned: Math.abs(close.getBoundingClientRect().top - closeBefore) < 1
      }
    })
    expect(reach).toEqual({
      bounded: true,
      scrolledToEnd: true,
      overflows: true,
      closePinned: true
    })
  })
})

/**
 * The Capacitor WebView draws edge-to-edge and `position: fixed` escapes the
 * safe-area padding `.task-app-container` carries, so the panel's top rendered
 * under the status bar — which is where the opening lines of the title went.
 */
test.describe('the popout inside the mobile app shell', () => {
  test.use({
    viewport: PHONE,
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile HadokuTaskApp/3.0'
  })

  test('the header clears the status bar', async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (pnpm run dev:api)')
    await createAutomationBoard(request, BOARD_ID)
    await request.post(API, {
      data: {
        boardId: BOARD_ID,
        tag: 'plan-review',
        id: `${BOARD_ID}-shell`,
        title: 'Shell padding',
        notes: PLAN
      }
    })
    await signIn(page)
    await page.goto('/')
    await page.getByRole('button', { name: BOARD_ID, exact: true }).dispatchEvent('click')
    await page.locator('.task-app__item').first().waitFor({ state: 'visible', timeout: 15000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page
      .locator('.task-app__item')
      .filter({ hasText: 'Shell padding' })
      .getByRole('button', { name: 'Open notes' })
      .dispatchEvent('click')
    await expect(page.locator('.notes-popout')).toBeVisible()

    expect(await page.evaluate(() => !!document.querySelector('[data-mobile-app="true"]'))).toBe(
      true
    )
    // env() is 0 in a desktop browser, so the floor is what is asserted here —
    // it is also what does the work on a WebView that reports 0 after a late
    // viewport-meta patch.
    const padTop = await page
      .locator('.notes-popout__header')
      .evaluate(el => parseFloat(getComputedStyle(el).paddingTop))
    expect(padTop).toBeGreaterThanOrEqual(28)
  })
})
