import { test, expect, type Page } from '@playwright/test'
import { prefsUp, pointPrefsAtLocalStack } from './helpers/prefs'
import { mockShellApi } from './helpers/mock-api'

/**
 * E2E for the task-button preferences block (settings popout → Task buttons).
 *
 * The block replaced a single "Disable Complete Button" checkbox, which left a
 * user whose showDeleteButton had been turned off with no UI to turn it back
 * on. What this asserts:
 *
 *   1. All three card controls (notes / complete / delete) have a checkbox
 *   2. A pref of `false` arrives at the UI as an unchecked box — the recovery
 *      path for the stranded-delete-button bug
 *   3. The preview card under the checkboxes reflects the current prefs and
 *      re-renders the instant a box is toggled
 *   4. Toggling persists to the prefs-client cache AND changes the real board
 */

const PUBLIC_USER_TYPE = 'public'
const PUBLIC_SESSION_ID = 'public-buttons-session'
const PREFS_KEY = `${PUBLIC_USER_TYPE}-${PUBLIC_SESSION_ID}-preferences`
// The local stack's edge-router shim resolves whoami to the dev user it stamps
// on every request, so this is the real resolved identity.
const SDK_CACHE_KEY = 'prefs-cache:dev-uid:task'

const PREVIEW = '.settings-preview-stage'
const CHIP = '.settings-toggle-chip'

function readSdkCacheBlob(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(key => {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw).blob as Record<string, unknown>) : null
  }, SDK_CACHE_KEY)
}

async function setupRoutes(page: Page) {
  await mockShellApi(page)

  // Hermetic prefs backend for @wolffm/prefs-client (see theme-mode.spec.ts for
  // why GET 404s: it keeps the optimistic localStorage cache authoritative).
  // Prefs go to the REAL prefs-api on :3003 (scripts/dev-api.mjs) against a
  // real sqlite D1 — no interception. See helpers/prefs.ts.
  await pointPrefsAtLocalStack(page)
}

/**
 * Seed a public session with a legacy prefs blob the app will actually find —
 * a public sessionId comes from `task_anon_session_id`, not `hadoku_session_id`.
 */
async function seedPublicSession(page: Page, prefs: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ({ userType, sessionId, prefsKey, prefsJson }) => {
      window.localStorage.setItem('hadoku_user_type', userType)
      window.localStorage.setItem('task_anon_session_id', sessionId)
      window.localStorage.setItem(prefsKey, prefsJson)
    },
    {
      userType: PUBLIC_USER_TYPE,
      sessionId: PUBLIC_SESSION_ID,
      prefsKey: PREFS_KEY,
      prefsJson: JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), ...prefs })
    }
  )
}

async function openSettings(page: Page) {
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
  await page.locator('.settings-toggle-btn').click()
  await expect(page.locator(PREVIEW)).toBeVisible()
}

/** The checkbox inside the chip whose text label is `name`. */
function chip(page: Page, name: string) {
  return page.locator(CHIP).filter({ hasText: name }).locator('input[type="checkbox"]')
}

test.describe('Task button preferences', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(
      !(await prefsUp(request)),
      'prefs stack not running (node scripts/dev-api.mjs, needs ../hadoku_site)'
    )
    await setupRoutes(page)
  })

  test('all three card controls have a checkbox', async ({ page }) => {
    await seedPublicSession(page, { theme: 'light' })
    await page.goto('/')
    await openSettings(page)

    await expect(page.locator(CHIP)).toHaveCount(3)
    for (const name of ['Notes', 'Complete', 'Delete']) {
      await expect(chip(page, name)).toBeChecked()
    }
  })

  test('a disabled delete button shows as unchecked and can be re-enabled', async ({ page }) => {
    // The stranded state the old UI could not recover from.
    await seedPublicSession(page, { theme: 'light', showDeleteButton: false })
    await page.goto('/')
    await openSettings(page)

    await expect(chip(page, 'Delete')).not.toBeChecked()
    await expect(page.locator(`${PREVIEW} .task-app__delete-btn`)).toHaveCount(0)

    await chip(page, 'Delete').check()

    await expect(page.locator(`${PREVIEW} .task-app__delete-btn`)).toBeVisible()
    await expect.poll(async () => (await readSdkCacheBlob(page))?.showDeleteButton).toBe(true)
  })

  test('preview reflects each toggle immediately', async ({ page }) => {
    await seedPublicSession(page, { theme: 'light' })
    await page.goto('/')
    await openSettings(page)

    const notes = page.locator(`${PREVIEW} .task-app__notes-toggle`)
    const complete = page.locator(`${PREVIEW} .task-app__complete-btn`)
    const del = page.locator(`${PREVIEW} .task-app__delete-btn`)

    await expect(notes).toBeVisible()
    await expect(complete).toBeVisible()
    await expect(del).toBeVisible()

    await chip(page, 'Notes').uncheck()
    await expect(notes).toHaveCount(0)
    await expect(complete).toBeVisible()
    await expect(del).toBeVisible()

    await chip(page, 'Complete').uncheck()
    await expect(complete).toHaveCount(0)
    await expect(del).toBeVisible()

    await chip(page, 'Delete').uncheck()
    await expect(del).toHaveCount(0)

    await chip(page, 'Notes').check()
    await expect(notes).toBeVisible()
  })

  test('toggling a button pref changes the real board, not just the preview', async ({ page }) => {
    await seedPublicSession(page, { theme: 'light' })
    await page.goto('/')

    // A real card, added through the real input — public mode persists tasks to
    // localStorage, so no board mock can stand in for this.
    const field = page.locator('.task-app__input')
    await field.fill('A real board task')
    await field.press('Enter')

    const boardItem = page.locator('.task-app__item').filter({ hasText: 'A real board task' })
    await expect(boardItem.locator('.task-app__complete-btn')).toBeVisible()

    await openSettings(page)
    await chip(page, 'Complete').uncheck()

    await expect(boardItem.locator('.task-app__complete-btn')).toHaveCount(0)
    await expect.poll(async () => (await readSdkCacheBlob(page))?.showCompleteButton).toBe(false)
  })
})
