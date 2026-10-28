import { test, expect } from '@playwright/test'

/**
 * `/task?board=<id>` opens that board.
 *
 * whattocook writes a shopping list to a board of its own and links here with
 * "Open in Tasks". Without the parameter the app opened on `main`, and the new
 * board — unpinned, so absent from the top bar — looked as if nothing had been
 * written at all (2026-10-28).
 */

const boards = {
  version: 1,
  updatedAt: new Date().toISOString(),
  boards: ['main', 'whattocook-shopping'].map(id => ({
    id,
    name: id === 'main' ? 'Main' : 'Shopping',
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

test('a board named in the URL is the one shown', async ({ page }) => {
  await page.route('**/task/api/boards*', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...boards, userType: 'friend' })
    })
  })
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hadoku_session_id', 'dev-uid')
    localStorage.setItem('hadoku_user_type', 'friend')
  })

  await page.goto('/?board=whattocook-shopping')
  await expect(page.getByText('Task on whattocook-shopping')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Task on main')).toHaveCount(0)
})

test('without the parameter the app opens on main', async ({ page }) => {
  await page.route('**/task/api/boards*', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...boards, userType: 'friend' })
    })
  })
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hadoku_session_id', 'dev-uid')
    localStorage.setItem('hadoku_user_type', 'friend')
  })

  await page.goto('/')
  await expect(page.getByText('Task on main')).toBeVisible({ timeout: 15000 })
})
