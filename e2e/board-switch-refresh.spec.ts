import { test, expect, type Page } from '@playwright/test'

/**
 * Selecting a board revalidates from the server — but not more often than it needs to.
 *
 * WHY THIS EXISTS
 * ---------------
 * Nothing in this app ever refetched on its own: no interval, no EventSource, no
 * refetch-on-focus. Meanwhile taskauto sweeps every board roughly every 15 minutes
 * (tenhands `taskauto.yml` cron + the host cron backstop) and advances lanes
 * server-side. So a tab left open showed a board that had since moved, indefinitely,
 * and `switchBoard` was pure-local — it sliced the in-memory boards and issued no
 * request at all.
 *
 * A board switch is the right moment to catch up: it is when a stale tab is most
 * likely to be looking at something that has changed, and the paint is instant
 * either way because the revalidate runs behind it.
 *
 * The full `GET /task/api/boards` is deliberate, not lazy. The cheaper
 * `GET /task/api/tasks?board=x` returns only that board's tasks, and a stale
 * session needs to learn that a board was renamed, deleted, shared out, or gained
 * tags — none of which that route carries.
 */

const FRESH_WINDOW_MS = 2 * 60 * 1000

function boardsFile(boardIds: string[]) {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    boards: boardIds.map(id => ({
      id,
      name: id === 'main' ? 'Main' : id.toUpperCase(),
      tasks: [
        {
          id: `${id}-t1`,
          title: `Task on ${id}`,
          state: 'Active',
          createdAt: new Date().toISOString()
        }
      ],
      tags: []
    }))
  }
}

/** Counts only the GET collection reads — `syncFromApi` is the sole caller. */
async function setup(page: Page, opts: { userType: string }) {
  const boardGets: string[] = []

  await page.route('**/task/api/session/handshake', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ preferences: null })
    })
  )
  await page.route('**/task/api/boards*', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    boardGets.push(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...boardsFile(['main', 'alpha', 'beta']), userType: opts.userType })
    })
  })

  await page.addInitScript(t => {
    localStorage.clear()
    if (t === 'public') {
      localStorage.setItem('hadoku_user_type', 'public')
      localStorage.setItem('task_anon_session_id', 'anon-refresh')
    } else {
      localStorage.setItem('hadoku_session_id', 'dev-uid')
      localStorage.setItem('hadoku_user_type', t)
    }
  }, opts.userType)

  return boardGets
}

async function openBoard(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
}

test.describe('board switch revalidates, debounced', () => {
  test('a switch inside the freshness window issues no new board fetch', async ({ page }) => {
    const gets = await setup(page, { userType: 'friend' })
    await page.clock.install()
    await page.goto('/')
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
    await expect.poll(() => gets.length).toBeGreaterThan(0)

    const afterLoad = gets.length
    // The cold load already fetched every board, so switching now is free.
    await openBoard(page, 'ALPHA')
    await openBoard(page, 'BETA')
    await page.waitForTimeout(500)

    expect(gets.length, `switching inside the ${FRESH_WINDOW_MS}ms window should not refetch`).toBe(
      afterLoad
    )
  })

  test('a switch after the window elapses revalidates exactly once', async ({ page }) => {
    const gets = await setup(page, { userType: 'friend' })
    await page.clock.install()
    await page.goto('/')
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
    await expect.poll(() => gets.length).toBeGreaterThan(0)

    const afterLoad = gets.length
    // Past the window: the data on screen is now old enough to be worth checking.
    await page.clock.fastForward(FRESH_WINDOW_MS + 5_000)

    await openBoard(page, 'ALPHA')
    await expect.poll(() => gets.length, { timeout: 10_000 }).toBe(afterLoad + 1)

    // That refresh restamps the window, so the very next switch is free again —
    // this is the guard against a refetch on every click.
    await openBoard(page, 'BETA')
    await page.waitForTimeout(500)
    expect(gets.length, 'the refresh should restart the freshness window').toBe(afterLoad + 1)
  })

  test('a manual refresh ignores the window entirely', async ({ page }) => {
    const gets = await setup(page, { userType: 'friend' })
    await page.clock.install()
    await page.goto('/')
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
    await expect.poll(() => gets.length).toBeGreaterThan(0)

    const afterLoad = gets.length
    // No fast-forward: the data is as fresh as it gets, and the refresh must
    // still go through. Answering an explicit refresh with a no-op is the one
    // response guaranteed to read as broken.
    // The real control (TagFiltersSection) — asserted, never skipped. A spec that
    // silently skips when it cannot find its target proves nothing.
    const refresh = page.getByRole('button', { name: 'Sync from server' })
    await expect(refresh).toBeVisible({ timeout: 10_000 })
    await refresh.click()

    await expect.poll(() => gets.length, { timeout: 10_000 }).toBe(afterLoad + 1)
  })

  test('a public session never revalidates — its local data is the truth', async ({ page }) => {
    const gets = await setup(page, { userType: 'public' })
    await page.clock.install()
    await page.goto('/')
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })

    await page.clock.fastForward(FRESH_WINDOW_MS + 5_000)
    const board = page.getByRole('button', { name: 'ALPHA', exact: true })
    if (await board.count()) await board.click()
    await page.waitForTimeout(500)

    // A public user has no server state to reconcile with; a "refresh" could only
    // overwrite their local board with an empty one.
    expect(gets.length, 'public sessions must not sync').toBe(0)
  })
})
