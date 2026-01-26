import { test, expect } from '@playwright/test'

/**
 * E2E tests for the key validation and session management flow
 *
 * Tests the complete authentication flow:
 * 1. User enters key in Settings
 * 2. Key is validated via /task/api/validate-key
 * 3. Session is created via /task/api/session/create
 * 4. Session data stored in localStorage
 * 5. Page reloads and uses stored session
 * 6. Subsequent reloads persist the session
 */

// Helper to open settings modal
async function openSettings(page: import('@playwright/test').Page) {
  // Click on the "Tasks" header which opens settings
  const header = page.locator('h1.task-app__header')
  await header.click()

  // Wait for modal to appear (modal uses modal-overlay and modal-card classes)
  await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 5000 })
}

// Helper to find and fill the key input, then submit
async function fillKeyAndSubmit(page: import('@playwright/test').Page, key: string) {
  // The key input has name="key" and placeholder="Enter authentication key"
  const keyInput = page.locator('input[name="key"]')
  await keyInput.waitFor({ state: 'visible', timeout: 5000 })

  // Clear and fill the input
  await keyInput.fill(key)

  // Wait a moment for React to update state
  await page.waitForTimeout(100)

  // Find the submit button WITHIN the same input group as the key input
  // The key input's parent is .settings-field-input-group, and the button is a sibling
  const keyInputGroup = keyInput.locator('..')
  const submitButton = keyInputGroup.locator('button.settings-field-button')
  await submitButton.waitFor({ state: 'visible', timeout: 5000 })

  // Click the button to submit
  await submitButton.click()
}

test.describe('Key Validation Flow', () => {
  // Note: We don't use addInitScript to clear localStorage because it runs
  // on every navigation including reloads, which would clear the session
  // data stored by the auth flow before the reload completes.

  test('should start as public user with no stored session', async ({ page }) => {
    // Clear localStorage on initial load only
    await page.addInitScript(() => localStorage.clear())
    await page.goto('/')

    // Wait for app to load by checking for the header
    await page.waitForSelector('h1.task-app__header', { timeout: 10000 })

    // Check localStorage - either no session or a public session was generated
    const sessionId = await page.evaluate(() => localStorage.getItem('currentSessionId'))
    const userType = await page.evaluate(() => localStorage.getItem('currentUserType'))

    // Either no session, or a public session was generated
    if (sessionId) {
      expect(sessionId).toMatch(/^public-/)
    }
    expect(userType).toBeNull()
  })

  test('should validate key and create session', async ({ page }) => {
    // Mock the API endpoints BEFORE navigation
    await page.route('**/task/api/validate-key', async route => {
      const request = route.request()
      const headers = request.headers()

      if (headers['x-user-key'] === 'test-valid-key') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ valid: true })
        })
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ valid: false })
        })
      }
    })

    await page.route('**/task/api/session/create', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 'test-session-123',
          userType: 'friend'
        })
      })
    })

    // Navigate and clear localStorage manually (not with addInitScript to avoid clearing on reload)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForSelector('h1.task-app__header', { timeout: 10000 })

    // Open settings modal
    await openSettings(page)

    // Fill the key input and submit - this will trigger a page reload
    await fillKeyAndSubmit(page, 'test-valid-key')

    // Wait for the page to reload (the auth flow triggers window.location.href change)
    // After reload, the session data should be in localStorage
    await page.waitForURL('**/*', { timeout: 15000 })
    await page.waitForSelector('h1.task-app__header', { timeout: 10000 })

    // Verify localStorage was updated after the reload
    const sessionId = await page.evaluate(() => localStorage.getItem('currentSessionId'))
    const userType = await page.evaluate(() => localStorage.getItem('currentUserType'))

    expect(sessionId).toBe('test-session-123')
    expect(userType).toBe('friend')
  })

  test('should persist session across page reloads', async ({ page }) => {
    // Pre-populate localStorage with session data
    await page.addInitScript(() => {
      localStorage.setItem('currentSessionId', 'persisted-session-456')
      localStorage.setItem('currentUserType', 'admin')
    })

    // Mock the session handshake endpoint
    await page.route('**/task/api/session/handshake', async route => {
      const request = route.request()
      const headers = request.headers()

      expect(headers['x-session-id']).toBe('persisted-session-456')
      expect(headers['x-user-type']).toBe('admin')

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          preferences: {
            version: 1,
            updatedAt: new Date().toISOString(),
            theme: 'dark'
          }
        })
      })
    })

    // Mock the boards API
    await page.route('**/task/api/boards*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          boards: [
            {
              id: 'main',
              name: 'Main',
              tasks: [],
              tags: []
            }
          ]
        })
      })
    })

    await page.goto('/')
    await page.waitForSelector('h1.task-app__header', { timeout: 10000 })

    // Wait for the handshake to complete
    await page.waitForTimeout(2000)

    // Verify session data persists
    const sessionId = await page.evaluate(() => localStorage.getItem('currentSessionId'))
    const userType = await page.evaluate(() => localStorage.getItem('currentUserType'))

    expect(sessionId).toBe('persisted-session-456')
    expect(userType).toBe('admin')

    // Reload and verify again
    await page.reload()
    await page.waitForSelector('h1.task-app__header', { timeout: 10000 })

    const sessionIdAfterReload = await page.evaluate(() => localStorage.getItem('currentSessionId'))
    const userTypeAfterReload = await page.evaluate(() => localStorage.getItem('currentUserType'))

    expect(sessionIdAfterReload).toBe('persisted-session-456')
    expect(userTypeAfterReload).toBe('admin')
  })

  test('should clear old session data when switching accounts', async ({ page }) => {
    // Mock API endpoints BEFORE navigation
    await page.route('**/task/api/validate-key', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true })
      })
    })

    await page.route('**/task/api/session/create', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 'new-session-222',
          userType: 'admin'
        })
      })
    })

    await page.route('**/task/api/session/handshake', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ preferences: null })
      })
    })

    await page.route('**/task/api/boards*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          boards: []
        })
      })
    })

    // Navigate first, then set up localStorage manually
    await page.goto('/')

    // Pre-populate localStorage with old session data (manually, not with addInitScript)
    await page.evaluate(() => {
      localStorage.setItem('currentSessionId', 'old-session-111')
      localStorage.setItem('currentUserType', 'friend')
      localStorage.setItem(
        'friend-old-session-111-main-tasks',
        JSON.stringify({ version: 1, tasks: [] })
      )
      localStorage.setItem(
        'public-old-session-111-main-tasks',
        JSON.stringify({ version: 1, tasks: [] })
      )
    })

    // Reload to pick up the pre-populated session
    await page.reload()
    await page.waitForSelector('h1.task-app__header', { timeout: 10000 })

    // Open settings and enter new key - this will trigger a page reload
    await openSettings(page)
    await fillKeyAndSubmit(page, 'new-account-key')

    // Wait for the page to reload (the auth flow triggers window.location.href change)
    await page.waitForURL('**/*', { timeout: 15000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('h1.task-app__header', { timeout: 10000 })

    // Verify new session is stored after reload
    const sessionId = await page.evaluate(() => localStorage.getItem('currentSessionId'))
    const userType = await page.evaluate(() => localStorage.getItem('currentUserType'))

    expect(sessionId).toBe('new-session-222')
    expect(userType).toBe('admin')

    // Verify old session storage was cleared
    const oldFriendData = await page.evaluate(() =>
      localStorage.getItem('friend-old-session-111-main-tasks')
    )
    const oldPublicData = await page.evaluate(() =>
      localStorage.getItem('public-old-session-111-main-tasks')
    )

    expect(oldFriendData).toBeNull()
    expect(oldPublicData).toBeNull()
  })

  test('should handle invalid key gracefully', async ({ page }) => {
    await page.route('**/task/api/validate-key', async route => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ valid: false, error: 'Invalid key' })
      })
    })

    await page.route('**/task/api/boards*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          boards: []
        })
      })
    })

    await page.goto('/')
    await page.waitForSelector('h1.task-app__header', { timeout: 10000 })

    // Open settings
    await openSettings(page)

    // Fill invalid key and submit
    await fillKeyAndSubmit(page, 'invalid-key')

    // Wait for error to appear
    await page.waitForSelector('.settings-error', { state: 'visible', timeout: 5000 })

    // Session should NOT be created
    const sessionId = await page.evaluate(() => localStorage.getItem('currentSessionId'))

    // Should still be null or a public session, not a new authenticated session
    if (sessionId) {
      expect(sessionId).not.toBe('test-session-123')
      expect(sessionId).toMatch(/^public-/)
    }

    // Check for error message
    const errorMessage = page.locator('.settings-error')
    await expect(errorMessage).toBeVisible()
  })

  test('should handle session creation failure gracefully', async ({ page }) => {
    await page.route('**/task/api/validate-key', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true })
      })
    })

    await page.route('**/task/api/session/create', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server error' })
      })
    })

    await page.route('**/task/api/boards*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          boards: []
        })
      })
    })

    await page.goto('/')
    await page.waitForSelector('h1.task-app__header', { timeout: 10000 })

    // Open settings
    await openSettings(page)

    // Fill key and submit
    await fillKeyAndSubmit(page, 'valid-key-but-server-fails')

    // Wait for error to appear
    await page.waitForSelector('.settings-error', { state: 'visible', timeout: 5000 })

    // Session should NOT be updated
    const sessionId = await page.evaluate(() => localStorage.getItem('currentSessionId'))

    // Should still be null or a public session
    if (sessionId) {
      expect(sessionId).toMatch(/^public-/)
    }
  })

  test('should handle session expiration gracefully', async ({ page }) => {
    // Mock the handshake endpoint BEFORE navigation
    await page.route('**/task/api/session/handshake', async route => {
      // Server returns 'public' (simulating expired session)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sessionId: 'expired-session-789',
          userType: 'public', // Session expired - server disagrees with client
          migrated: false,
          preferences: null
        })
      })
    })

    // Mock the boards API
    await page.route('**/task/api/boards*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          boards: []
        })
      })
    })

    // Use addInitScript that only sets localStorage if not already set to 'public'
    // This allows the test to set up 'friend' initially, but after our code
    // updates to 'public' and reloads, that value persists
    await page.addInitScript(() => {
      const currentUserType = localStorage.getItem('currentUserType')
      // Only set up 'friend' session if not already set to 'public' (post-expiration)
      if (currentUserType !== 'public') {
        localStorage.setItem('currentSessionId', 'expired-session-789')
        localStorage.setItem('currentUserType', 'friend')
      }
    })

    // Navigate - app will mount with userType='friend' from localStorage
    await page.goto('/')

    // Wait for the session expiration handling to complete and page to reload
    // The flow is: detect mismatch -> show toast -> wait 1.5s -> reload
    // After reload, the app should initialize as 'public' user
    await page.waitForTimeout(3000)

    // Verify localStorage was updated to 'public' after session expiration handling
    const userType = await page.evaluate(() => localStorage.getItem('currentUserType'))
    expect(userType).toBe('public')

    // Verify the app eventually loads (after the reload with correct userType)
    await page.waitForSelector('h1.task-app__header', { timeout: 10000 })
  })
})
