import { test, expect, type Page } from '@playwright/test'
import { API } from './helpers/stack'

/**
 * A new board stays in the top bar after you switch away from it.
 *
 * The bug (reported 2026-11-09): the top bar shows the user's explicit
 * favorites, and a new board was never made one. It appeared only while it was
 * the selected board; switching away dropped it from the bar, and creating it
 * again was refused as a duplicate, so the board looked like it had vanished.
 *
 * Real worker + D1. `X-Dev-As` gives the test its own user.
 */

async function signInAs(page: Page, userId: string) {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hadoku_session_id', 'dev-uid')
    localStorage.setItem('hadoku_user_type', 'friend')
  })
  await page.route('**/task/api/**', route =>
    route.continue({ headers: { ...route.request().headers(), 'x-dev-as': userId } })
  )
}

const barButton = (page: Page, name: string) =>
  page.locator('.task-app__board-list').getByRole('button', { name, exact: true })

test('a board created with favorites set stays in the bar after switching away', async ({
  page,
  request
}) => {
  const user = `pin-e2e-${Date.now()}`
  const headers = { 'X-Dev-As': user }
  // The reporter's shape: explicit favorites with room left in the bar.
  expect((await request.get(`${API}/boards`, { headers })).ok()).toBe(true)
  expect(
    (await request.post(`${API}/boards`, { headers, data: { id: 'mine', name: 'mine' } })).ok()
  ).toBe(true)
  expect(
    (await request.put(`${API}/boards/pinned`, { headers, data: { order: ['mine', 'main'] } })).ok()
  ).toBe(true)

  await signInAs(page, user)
  await page.goto('/')
  await expect(barButton(page, 'mine')).toBeVisible()

  await page.getByRole('button', { name: 'Create board' }).click()
  await page.getByPlaceholder('Board name').fill('trackers')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(barButton(page, 'trackers')).toBeVisible()

  // Switch away: the new board must stay in the bar.
  await barButton(page, 'main').click()
  await expect(barButton(page, 'main')).toHaveAttribute('aria-pressed', 'true')
  await expect(barButton(page, 'trackers')).toBeVisible()

  // And the server agrees: a reload (fresh sync) still shows it.
  await expect
    .poll(async () => {
      const res = await request.get(`${API}/boards`, { headers })
      const { boards } = (await res.json()) as { boards: Array<{ id: string; pinned?: boolean }> }
      return boards.find(b => b.id === 'trackers')?.pinned ?? false
    })
    .toBe(true)
  await page.reload()
  await expect(barButton(page, 'trackers')).toBeVisible()
})

test('creating a name that exists says where the board is', async ({ page }) => {
  await signInAs(page, `pin-e2e-dup-${Date.now()}`)
  await page.goto('/')
  await page.getByRole('button', { name: 'Create board' }).click()
  await page.getByPlaceholder('Board name').fill('main')
  await expect(page.getByText('Open it from Edit boards')).toBeVisible()
})
