import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { API, apiUp, signIn } from './helpers/stack'

/**
 * The board bar on a phone.
 *
 * The bar is not scrollable and its pills had no ellipsis, so a pill pushed past
 * the right edge was simply unreachable — and worse, the whole document then
 * scrolled sideways, which drags the layout viewport around underneath every
 * `position: fixed` overlay in the app (the notes popout, modals, the toast
 * container). This was not an edge case: the bar shows up to TOPBAR_BOARD_SLOTS
 * pinned boards plus the active one, and six ordinary names already exceed a
 * 393px phone.
 *
 * Requires the local API stack (`pnpm run dev:api`), and skips without it.
 */

const PHONE = { width: 393, height: 727 }

/** Ordinary names, the length a real person uses. Six of these overflowed. */
const BOARD_NAMES = [
  'Work',
  'Home',
  'Errands',
  'Reading',
  'Groceries',
  'Q3 Planning',
  'Health',
  'Finance admin'
]

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

async function seedBoards(request: APIRequestContext, names: string[]) {
  for (const name of names) {
    await request.post(`${API}/boards`, { data: { id: slug(name), name } })
  }
}

/** Every pill sits inside the viewport horizontally, and none is covered. */
async function pillGeometry(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const pills = [...document.querySelectorAll('.task-app__board-list .pill-btn')]
    return {
      count: pills.length,
      escaping: pills
        .map(p => ({ name: p.textContent?.trim(), r: p.getBoundingClientRect() }))
        .filter(p => p.r.left < -1 || p.r.right > vw + 1)
        .map(p => p.name),
      documentScrollsSideways: document.documentElement.scrollWidth > vw
    }
  })
}

test.describe('board bar on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (pnpm run dev:api)')
    await seedBoards(request, BOARD_NAMES)
    await signIn(page)
    await page.goto('/')
    // Wait for the pills to STOP arriving, not for the first one to appear.
    // The board list paints incrementally, and `.first().waitFor()` is satisfied
    // by a single pill — weaker than what the tests then assert (`count > 1`,
    // and that none of them escapes the viewport). That gap made this spec fail
    // roughly one run in three, on main as well as on a branch.
    await expect
      .poll(() => page.locator('.task-app__board-list .pill-btn').count(), { timeout: 15000 })
      .toBeGreaterThan(1)
  })

  test('every board pill stays on screen and the page does not scroll sideways', async ({
    page
  }) => {
    const geo = await pillGeometry(page)
    expect(geo.count).toBeGreaterThan(1)
    expect(geo).toMatchObject({ escaping: [], documentScrollsSideways: false })
  })

  test('the pills wrap instead of running off the edge', async ({ page }) => {
    const wraps = await page
      .locator('.task-app__board-list')
      .first()
      .evaluate(el => getComputedStyle(el).flexWrap)
    expect(wraps).toBe('wrap')
  })

  test('a long board name is truncated rather than widening the page', async ({
    page,
    request
  }) => {
    await request.post(`${API}/boards`, {
      data: {
        id: 'verylongboard',
        name: 'Quarterly planning, hiring and budget review board'
      }
    })
    await page.reload()
    // Wait for the pills to STOP arriving, not for the first one to appear.
    // The board list paints incrementally, and `.first().waitFor()` is satisfied
    // by a single pill — weaker than what the tests then assert (`count > 1`,
    // and that none of them escapes the viewport). That gap made this spec fail
    // roughly one run in three, on main as well as on a branch.
    await expect
      .poll(() => page.locator('.task-app__board-list .pill-btn').count(), { timeout: 15000 })
      .toBeGreaterThan(1)

    // Whether or not it lands in the pinned set, nothing may leave the viewport.
    const geo = await pillGeometry(page)
    expect(geo).toMatchObject({ escaping: [], documentScrollsSideways: false })
  })

  test('a fixed overlay is not dragged off-centre by a sideways-scrolled page', async ({
    page
  }) => {
    // The failure this pins down: horizontal document scroll displaces
    // `position: fixed` children, so the notes popout and every modal open
    // partly off-screen. With the bar wrapped there is nowhere to scroll to.
    await page.evaluate(() => window.scrollTo(500, 0))
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => window.scrollX)).toBe(0)
  })
})
