import { test, expect } from '@playwright/test'
import { KEY_SUBMIT_LABEL } from './helpers/settings'

/**
 * E2E tests for data synchronization between localStorage and API
 *
 * These tests verify:
 * 1. API data is fetched and stored in localStorage on auth
 * 2. localStorage is updated when API has newer data
 * 3. The sync flow works correctly with real production API
 *
 * Uses test keys from .env for authenticated testing
 */

// Test keys - these should be registered on the production server
const FRIEND_TEST_KEY = 'friend-12345678-1234-1234-1234-1234567890ab'

test.describe('Data Sync Flow', () => {
  test.describe('Production API Integration', () => {
    // Skip in CI - these tests hit real production API
    test.skip(() => !!process.env.CI, 'Skipping production tests in CI')

    test('should fetch boards from API after authentication', async ({ page }) => {
      // Clear localStorage before test
      await page.goto('https://hadoku.me/task/')
      await page.evaluate(() => {
        localStorage.clear()
      })
      await page.reload()

      // Wait for app to load
      await page.waitForSelector('h1.app-header__title', { timeout: 15000 })

      // Open the settings gear and swap in the key (shared ConnectedSettings)
      await page.getByRole('button', { name: 'User settings' }).click()
      await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })
      await page.getByRole('button', { name: /change key/i }).click()

      const keyInput = page.locator('.settings-popout__input[placeholder="New access key"]')
      await keyInput.waitFor({ state: 'visible', timeout: 5000 })
      await keyInput.fill(FRIEND_TEST_KEY)
      await page.getByRole('button', { name: KEY_SUBMIT_LABEL }).click()

      // Wait for page reload after auth
      await page.waitForEvent('load', { timeout: 15000 })
      await page.waitForSelector('h1.app-header__title', { timeout: 15000 })

      // Give time for sync to complete
      await page.waitForTimeout(3000)

      // Verify localStorage was updated
      const sessionId = await page.evaluate(() => localStorage.getItem('hadoku_session_id'))
      const userType = await page.evaluate(() => localStorage.getItem('hadoku_user_type'))

      expect(sessionId).toBeTruthy()
      expect(sessionId).not.toMatch(/^public-/)
      expect(userType).toBe('friend')

      // Check that boards data was synced to localStorage
      const localStorageKeys = await page.evaluate(() => {
        const keys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key) keys.push(key)
        }
        return keys
      })

      // Should have boards key like "friend-{sessionId}-boards"
      const hasBoardsKey = localStorageKeys.some(k => k.includes('-boards'))
      expect(hasBoardsKey).toBe(true)

      console.log('localStorage keys after auth:', localStorageKeys)
    })

    test('should show API data after page reload', async ({ page }) => {
      // First, authenticate
      await page.goto('https://hadoku.me/task/')

      // Check if already authenticated
      const userType = await page.evaluate(() => localStorage.getItem('hadoku_user_type'))

      if (userType !== 'friend') {
        // Need to authenticate first (shared ConnectedSettings gear)
        await page.getByRole('button', { name: 'User settings' }).click()
        await page.waitForSelector('.settings-popout__panel', { state: 'visible', timeout: 5000 })
        await page.getByRole('button', { name: /change key/i }).click()

        const keyInput = page.locator('.settings-popout__input[placeholder="New access key"]')
        await keyInput.waitFor({ state: 'visible', timeout: 5000 })
        await keyInput.fill(FRIEND_TEST_KEY)
        await page.getByRole('button', { name: KEY_SUBMIT_LABEL }).click()

        await page.waitForEvent('load', { timeout: 15000 })
      }

      await page.waitForSelector('h1.app-header__title', { timeout: 15000 })

      // Wait for data to load
      await page.waitForTimeout(3000)

      // Get current localStorage state
      const beforeReload = await page.evaluate(() => {
        const sessionId = localStorage.getItem('hadoku_session_id')
        const boardsKey = Object.keys(localStorage).find(k => k.includes('-boards'))
        const boardsData = boardsKey ? localStorage.getItem(boardsKey) : null
        return { sessionId, boardsKey, boardsData }
      })

      console.log('Before reload:', beforeReload)

      // Reload the page
      await page.reload()
      await page.waitForSelector('h1.app-header__title', { timeout: 15000 })

      // Wait for sync
      await page.waitForTimeout(3000)

      // Verify data persists
      const afterReload = await page.evaluate(() => {
        const sessionId = localStorage.getItem('hadoku_session_id')
        const userType = localStorage.getItem('hadoku_user_type')
        const boardsKey = Object.keys(localStorage).find(k => k.includes('-boards'))
        const boardsData = boardsKey ? localStorage.getItem(boardsKey) : null
        return { sessionId, userType, boardsKey, boardsData }
      })

      console.log('After reload:', afterReload)

      expect(afterReload.sessionId).toBe(beforeReload.sessionId)
      expect(afterReload.userType).toBe('friend')
      expect(afterReload.boardsData).toBeTruthy()
    })
  })

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

      // Mock handshake
      await page.route('**/task/api/session/handshake', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            sessionId: 'test-sync-session',
            migrated: false,
            preferences: null
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

      await page.route('**/task/api/session/handshake', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            sessionId: 'test-overwrite-session',
            migrated: false,
            preferences: null
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
