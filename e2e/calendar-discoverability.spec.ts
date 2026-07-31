import { test, expect, type Page } from '@playwright/test'

/**
 * Can a person FIND a scheduled task, and can they tell an empty board from a
 * broken one?
 *
 * Both answers used to be no. The app reset to board view on every reload, the
 * calendar always opened on today, and mirrored events (a booked appointment)
 * are essentially always in the future — so the common case was an empty page
 * with a task one click away and nothing pointing at it. A failed refresh
 * rendered the same empty page.
 *
 * The scheduling half runs in public mode (localStorage only, no backend). The
 * sync half intercepts /task/api/boards so the failure is deterministic instead
 * of depending on whether a dev API happens to be up.
 */

const BOARDS_ROUTE = '**/task/api/boards*'

const calendarButton = (page: Page) =>
  page.getByRole('button', { name: 'Calendar view', exact: true })

/** Fresh public session, parked in calendar view. */
async function openCalendar(page: Page) {
  await page.goto('/?userType=public')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await calendarButton(page).click()
  await expect(page.locator('.calendar-day-view')).toBeVisible()
}

/** Create a timed task on the day the calendar is currently showing. */
async function createTaskOnCurrentDay(page: Page, title: string) {
  await page.getByRole('button', { name: '+ New task' }).click()
  await page.locator('.calendar-create-input').fill(title)
  await page.locator('.calendar-create-btn--primary').click()
  await expect(page.locator('.calendar-agenda__card', { hasText: title })).toBeVisible()
}

test.describe('Finding scheduled work', () => {
  test('the view choice survives a reload', async ({ page }) => {
    await openCalendar(page)

    await page.reload()

    // No click this time — the calendar is where the app opens now.
    await expect(page.locator('.calendar-day-view')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to board', exact: true })).toBeVisible()

    // And switching back is equally sticky, so board users aren't dragged away.
    await page.getByRole('button', { name: 'Back to board', exact: true }).click()
    await page.reload()
    await expect(page.locator('.calendar-day-view')).toHaveCount(0)
    await expect(calendarButton(page)).toBeVisible()
  })

  test('an empty day points at the next day that has something', async ({ page }) => {
    await openCalendar(page)

    // Schedule tomorrow — where a mirrored appointment always lands.
    await page.getByRole('button', { name: 'Next day' }).click()
    const tomorrowLabel = (await page.locator('.calendar-date-label').innerText()).trim()
    await createTaskOnCurrentDay(page, 'Meeting: Calendar Render Check')

    // Back to today: empty, exactly as a person arriving from the board sees it.
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(page.locator('.calendar-agenda--empty')).toBeVisible()

    // The signpost: names the day, and goes there.
    const signpost = page.locator('.calendar-nearest-btn')
    await expect(signpost).toHaveText(`Next scheduled: ${tomorrowLabel}`)

    await signpost.click()
    await expect(page.locator('.calendar-date-label')).toHaveText(tomorrowLabel)
    await expect(
      page.locator('.calendar-agenda__card', { hasText: 'Meeting: Calendar Render Check' })
    ).toBeVisible()
  })

  test('a past-only schedule is signposted as the last one, not the next', async ({ page }) => {
    await openCalendar(page)

    await page.getByRole('button', { name: 'Previous day' }).click()
    const yesterdayLabel = (await page.locator('.calendar-date-label').innerText()).trim()
    await createTaskOnCurrentDay(page, 'Yesterday standup')

    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(page.locator('.calendar-nearest-btn')).toHaveText(
      `Last scheduled: ${yesterdayLabel}`
    )
  })

  test('the board advertises the scheduled work it cannot show', async ({ page }) => {
    await openCalendar(page)

    const badge = page.locator('.task-app__filter-calendar-badge')
    await expect(badge).toHaveCount(0) // nothing scheduled yet

    await page.getByRole('button', { name: 'Next day' }).click()
    await createTaskOnCurrentDay(page, 'Meeting: Calendar Render Check')

    // From the board — the view that renders no calendar affordance at all.
    await page.getByRole('button', { name: 'Back to board', exact: true }).click()
    await expect(badge).toHaveText('1')
    await expect(page.locator('#task-app-scheduled-count')).toHaveText('1 scheduled')

    // The count is a promise the calendar has to keep. Return to today first —
    // the calendar holds the day it was left on, and today is where a reload,
    // and anyone following the badge for the first time, lands.
    await calendarButton(page).click()
    await page.locator('.calendar-today-btn').click()
    await expect(page.locator('.calendar-agenda--empty')).toBeVisible()
    await page.locator('.calendar-nearest-btn').click()
    await expect(
      page.locator('.calendar-agenda__card', { hasText: 'Meeting: Calendar Render Check' })
    ).toBeVisible()
  })
})

test.describe('Telling empty apart from broken', () => {
  test('a failed refresh says so instead of rendering a confident empty page', async ({ page }) => {
    await page.route(BOARDS_ROUTE, route => route.abort('failed'))

    await page.goto('/?userType=friend')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    // The pill is the only on-screen sign that the refresh never landed.
    const stalePill = page.locator('.task-app__filter-stale')
    await expect(stalePill).toBeVisible()

    // ...and the calendar's empty state stops asserting the day is empty.
    await calendarButton(page).click()
    await expect(page.locator('.calendar-agenda__empty-text')).toContainText('may be out of date')

    // Clicking it retries. Let the retry through and the warning clears.
    await page.unroute(BOARDS_ROUTE)
    await page.route(BOARDS_ROUTE, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          boards: [{ id: 'main', name: 'Main', tags: [], tasks: [] }]
        })
      })
    )
    await stalePill.click()
    await expect(stalePill).toHaveCount(0)
    await expect(page.locator('.calendar-agenda__empty-text')).toHaveText(
      'Nothing scheduled for this day.'
    )
  })

  test('a healthy load shows no warning', async ({ page }) => {
    await page.route(BOARDS_ROUTE, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          boards: [{ id: 'main', name: 'Main', tags: [], tasks: [] }]
        })
      })
    )

    await page.goto('/?userType=friend')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    await expect(page.locator('.task-app__filters')).toBeVisible()
    await expect(page.locator('.task-app__filter-stale')).toHaveCount(0)
  })
})
