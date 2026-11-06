import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { API, apiUp, signIn } from './helpers/stack'

/**
 * Touch targets in the board bar and the filter bar (#84).
 *
 * The rows are compact by design: 4px vertical padding around a 16px line made
 * every board pill, filter pill and icon button 24px tall. Right for a cursor,
 * too small for a thumb. buttons.css gives them a 44px floor under
 * `@media (pointer: coarse)` — the input device, not the width — so this spec
 * pins the gate both ways: a touch phone gets 44px, a desktop mouse keeps the
 * compact row.
 *
 * Requires the local API stack (`pnpm run dev:api`), and skips without it.
 */

const PHONE = { width: 390, height: 844 }
const FLOOR = 44

const BOARD_NAMES = ['Work', 'Home', 'Errands', 'Q3 Planning']
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Every button a thumb aims at in the two bars, plus the lane's sort toggle. */
const CONTROLS = [
  '.task-app__boards button',
  '.task-app__filters button',
  '.task-app__sort-btn'
].join(', ')

async function seedBoards(request: APIRequestContext) {
  for (const name of BOARD_NAMES) {
    await request.post(`${API}/boards`, { data: { id: slug(name), name } })
  }
}

/** One dev user is shared by parallel specs and by reruns, so each task needs its own title. */
const probeTitle = () => `Touch probe ${test.info().testId} ${Date.now()}`

/**
 * Boot the app with several boards and one tagged task, so the bars render
 * everything they can: board pills, a tag pill, the calendar/sync/share cluster
 * and a lane header with its sort button.
 */
async function openBoard(page: Page, title: string) {
  await signIn(page)
  await page.goto('/')
  await expect
    .poll(() => page.locator('.task-app__board-list .pill-btn').count(), { timeout: 15000 })
    .toBeGreaterThan(BOARD_NAMES.length)
  const field = page.locator('.task-app__input')
  await field.fill(`${title} #errand`)
  await field.press('Enter')
  await expect(page.locator('.task-app__item', { hasText: title })).toBeVisible()
  await expect(page.locator('.task-app__sort-btn').first()).toBeVisible()
}

/** Size of every visible control, labelled so a failure names the culprit. */
async function controlSizes(page: Page) {
  return page.evaluate(selector => {
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .map(el => {
        const r = el.getBoundingClientRect()
        const label = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''
        return { control: `${el.className.trim()} "${label}"`, width: r.width, height: r.height }
      })
      .filter(c => c.width > 0 && c.height > 0)
  }, CONTROLS)
}

test.describe('touch targets on a touch phone', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (pnpm run dev:api)')
    await seedBoards(request)
    await openBoard(page, probeTitle())
  })

  test('the context really is a coarse pointer', async ({ page }) => {
    // The whole fix hangs on this media query; if the emulation stopped
    // producing it, the size assertions below would be testing nothing.
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true)
  })

  test('every board-bar and filter-bar button is at least 44px tall', async ({ page }) => {
    const sizes = await controlSizes(page)
    // Pills for every board, + and edit, the tag pill and +, calendar/sync/share, sort.
    expect(sizes.length).toBeGreaterThanOrEqual(BOARD_NAMES.length + 8)
    expect(sizes.filter(c => c.height < FLOOR - 0.5).map(c => c.control)).toEqual([])
  })

  test('icon-only buttons are at least 44px wide too', async ({ page }) => {
    const iconOnly = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.board-add-btn, .board-edit-btn, .sync-btn, .task-app__filter-add, .task-app__sort-btn'
        )
      ]
        .filter(el => el.getBoundingClientRect().width > 0)
        .map(el => ({ control: el.className.trim(), width: el.getBoundingClientRect().width }))
    )
    expect(iconOnly.length).toBeGreaterThanOrEqual(6)
    expect(iconOnly.filter(c => c.width < FLOOR - 0.5).map(c => c.control)).toEqual([])
  })

  test('the active pill keeps its compact painted shape', async ({ page }) => {
    // The box grows to 44px, the fill does not: a 44px-tall gradient made the
    // active pill a blob. Its paint is clipped inside a transparent border.
    const active = await page
      .locator('.task-app__board-list .pill-btn--active')
      .first()
      .evaluate(el => {
        const cs = getComputedStyle(el)
        return {
          height: el.getBoundingClientRect().height,
          clip: cs.backgroundClip,
          paintedHeight: el.clientHeight
        }
      })
    expect(active.height).toBeGreaterThanOrEqual(FLOOR - 0.5)
    expect(active.clip).toBe('padding-box')
    expect(active.paintedHeight).toBeLessThan(32)
  })

  test('the bigger targets do not push the page sideways or clip anything', async ({ page }) => {
    const layout = await page.evaluate(selector => {
      const vw = document.documentElement.clientWidth
      return {
        documentScrollsSideways: document.documentElement.scrollWidth > vw,
        offscreen: [...document.querySelectorAll<HTMLElement>(selector)]
          .map(el => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.left < -1 || r.right > vw + 1))
          .map(({ el }) => el.className)
      }
    }, CONTROLS)
    expect(layout).toEqual({ documentScrollsSideways: false, offscreen: [] })
  })
})

test.describe('touch targets with a mouse', () => {
  // Desktop Chrome from the project: fine pointer, hover.
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (pnpm run dev:api)')
    await seedBoards(request)
    await openBoard(page, probeTitle())
  })

  test('a fine pointer keeps the compact rows', async ({ page }) => {
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(false)
    const sizes = await controlSizes(page)
    expect(sizes.length).toBeGreaterThanOrEqual(BOARD_NAMES.length + 8)
    // The floor is touch-only: on a mouse every one of these stays under 32px.
    expect(sizes.filter(c => c.height >= 32).map(c => c.control)).toEqual([])
  })
})
