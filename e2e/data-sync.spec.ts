import { test, expect } from '@playwright/test'

/**
 * Sync between localStorage and the boards API, against a mocked API: a newer
 * server copy replaces an older local one.
 *
 * Two production tests used to sit here, signing in on hadoku.me with a key
 * that was never registered. They could not pass anywhere and CI skipped
 * them, so they were deleted on 2026-11-04. A real production sign-in is the
 * opt-in RUN_PROD_SIGNIN probe (prod-inline-sign-in.spec.ts).
 */

test.describe('Data Sync Flow', () => {
  test.describe('Sync Logic with Mocked API', () => {
    test('should update localStorage when API returns newer data', async ({ page }) => {
      const oldTimestamp = '2024-01-01T00:00:00.000Z'
      const newTimestamp = '2024-06-15T12:00:00.000Z'

      // Pre-populate localStorage with OLD data
      await page.addInitScript(
        ({ oldTs }) => {
          localStorage.setItem('hadoku_session_id', 'test-sync-session')
          localStorage.setItem('hadoku_user_type', 'friend')
          localStorage.setItem(
            'friend-test-sync-session-boards',
            JSON.stringify({
              version: 1,
              updatedAt: oldTs,
              boards: [{ id: 'main', name: 'Main', tags: [] }]
            })
          )
          localStorage.setItem(
            'friend-test-sync-session-main-tasks',
            JSON.stringify({
              version: 1,
              updatedAt: oldTs,
              tasks: [{ id: 'old-task', title: 'Old task from localStorage', tag: '' }]
            })
          )
        },
        { oldTs: oldTimestamp }
      )

      // Mock API to return NEWER data
      await page.route('**/task/api/boards*', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            version: 1,
            updatedAt: newTimestamp,
            boards: [
              {
                id: 'main',
                name: 'Main',
                tags: ['work'],
                tasks: [
                  {
                    id: 'new-task-1',
                    title: 'New task from API',
                    tag: 'work',
                    createdAt: newTimestamp
                  },
                  { id: 'new-task-2', title: 'Another new task', tag: '', createdAt: newTimestamp }
                ]
              }
            ]
          })
        })
      })

      await page.goto('/')
      await page.waitForSelector('h1.app-header__title', { timeout: 15000 })

      // Wait for sync to complete
      await page.waitForTimeout(2000)

      // Verify localStorage was updated with API data
      const tasksData = await page.evaluate(() => {
        const data = localStorage.getItem('friend-test-sync-session-main-tasks')
        return data ? JSON.parse(data) : null
      })

      console.log('Tasks after sync:', tasksData)

      // Should have the NEW tasks from API, not the old localStorage tasks
      expect(tasksData).toBeTruthy()
      expect(tasksData.tasks).toHaveLength(2)
      expect(tasksData.tasks[0].title).toBe('New task from API')
      expect(tasksData.updatedAt).toBe(newTimestamp)
    })

    test('should NOT compare timestamps - API always wins (current behavior)', async ({ page }) => {
      // This test documents the CURRENT behavior where API always overwrites localStorage
      // regardless of timestamps. This may or may not be the desired behavior.

      const newerTimestamp = '2025-01-01T00:00:00.000Z' // NEWER than API will return
      const olderApiTimestamp = '2024-01-01T00:00:00.000Z'

      // Pre-populate localStorage with NEWER data
      await page.addInitScript(
        ({ newerTs }) => {
          localStorage.setItem('hadoku_session_id', 'test-overwrite-session')
          localStorage.setItem('hadoku_user_type', 'friend')
          localStorage.setItem(
            'friend-test-overwrite-session-main-tasks',
            JSON.stringify({
              version: 1,
              updatedAt: newerTs,
              tasks: [{ id: 'local-task', title: 'Newer local task', tag: '', createdAt: newerTs }]
            })
          )
        },
        { newerTs: newerTimestamp }
      )

      // Mock API to return OLDER data
      await page.route('**/task/api/boards*', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            version: 1,
            updatedAt: olderApiTimestamp,
            boards: [
              {
                id: 'main',
                name: 'Main',
                tags: [],
                tasks: [
                  {
                    id: 'api-task',
                    title: 'Older API task',
                    tag: '',
                    createdAt: olderApiTimestamp
                  }
                ]
              }
            ]
          })
        })
      })

      await page.goto('/')
      await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
      await page.waitForTimeout(2000)

      const tasksData = await page.evaluate(() => {
        const data = localStorage.getItem('friend-test-overwrite-session-main-tasks')
        return data ? JSON.parse(data) : null
      })

      console.log('Tasks after sync (API should have overwritten newer local):', tasksData)

      // CURRENT BEHAVIOR: API data wins even though it's older
      // This documents the current behavior - API always overwrites
      expect(tasksData.tasks[0].title).toBe('Older API task')
      expect(tasksData.updatedAt).toBe(olderApiTimestamp)
    })
  })
})
