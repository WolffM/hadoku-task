import { test, expect, type Page } from '@playwright/test'

/**
 * Automation preset picker (§5.4), end to end in a real browser.
 *
 * Converting a board used to mean pasting a provider's lane JSON by hand, which
 * makes the human the sync mechanism — the pasted copy goes stale the moment the
 * provider changes a lane. The picker fetches the provider's CURRENT contract
 * instead. This drives the whole path: browser → worker → provider stub, then
 * activation with the fetched lanes.
 *
 * Requires the local API stack (`node scripts/dev-api.mjs`): the real worker on
 * :3001 with a stub provider on :3002. Skipped when it isn't up, so the default
 * `pnpm test:e2e` (which only runs vite) stays green.
 */

const APP_HEADER = 'h1.app-header__title'

/** Unique per test AND per run — the dev stack's DB outlives a single run. */
const boardName = (slug: string) => `auto-${slug}-${Date.now().toString(36)}`

/** Sign in the way the key-swap flow does: the app reads these on boot. */
async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hadoku_session_id', 'dev-uid')
    localStorage.setItem('hadoku_user_type', 'friend')
  })
}

async function apiUp(page: Page): Promise<boolean> {
  try {
    const res = await page.request.get('http://127.0.0.1:3001/task/api/automation/presets')
    return res.ok()
  } catch {
    return false
  }
}

/**
 * A board of this test's own. The dev stack keeps one in-memory DB for the whole
 * run, and activation is destructive + permanent — a shared board would leave
 * the next test (or the next run) opening an already-automated panel.
 */
async function createBoard(page: Page, name: string) {
  await page.getByRole('button', { name: 'Edit boards' }).click()
  const input = page.locator('.edit-boards__new-input')
  await input.waitFor({ state: 'visible', timeout: 10000 })
  await input.fill(name)
  await page.locator('.edit-boards__create-btn').click()
  await page
    .locator('.edit-boards__row', { hasText: name })
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
}

/** Open the automation (🤖) panel for a board; Edit Boards is already open. */
async function openAutomationPanel(page: Page, boardName: string) {
  await page.getByRole('button', { name: `Automation for ${boardName}` }).click()
  await page.locator('.automation-panel__hint').waitFor({ state: 'visible', timeout: 10000 })
}

test.describe('Automation preset picker', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await apiUp(page)), 'local API stack not running (node scripts/dev-api.mjs)')
    await signIn(page)
  })

  test('offers the provider’s live lane contracts above the paste box', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 15000 })
    const board = boardName('offers')
    await createBoard(page, board)
    await openAutomationPanel(page, board)

    // Both contracts the provider publishes are offered.
    const presets = page.locator('.automation-panel__preset')
    await expect(presets).toHaveCount(2, { timeout: 10000 })
    await expect(presets.first()).toContainText('TenHands OSS Contribution')
    await expect(presets.first()).toContainText('10 lanes')
    // The user/agent split is what makes a lane set safe to hand an agent, so
    // it has to be visible BEFORE the destructive commit.
    await expect(presets.first()).toContainText('3 agent')
    await expect(presets.nth(1)).toContainText('TenHands Simple Work')

    // The picker sits above the paste box, not instead of it.
    const presetBox = await presets.first().boundingBox()
    const jsonBox = await page.locator('.automation-panel__json').boundingBox()
    expect(presetBox).not.toBeNull()
    expect(jsonBox).not.toBeNull()
    expect(presetBox?.y ?? 0).toBeLessThan(jsonBox?.y ?? 0)
  })

  test('choosing a preset fills the payload it commits', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 15000 })
    const board = boardName('fills')
    await createBoard(page, board)
    await openAutomationPanel(page, board)

    const json = page.locator('.automation-panel__json')
    await expect(json).toHaveValue('')

    // Picking a preset applies it immediately — no separate Preview/Activate
    // click — so the payload it filled and committed is only visible for the
    // instant before the panel closes and the boards reload.
    await page.locator('.automation-panel__preset').first().click()
    await expect(page.locator('.automation-panel__hint')).toBeHidden({ timeout: 10000 })

    await page.getByRole('button', { name: `Automation for ${board}` }).click()
    const status = page.locator('.automation-panel__status')
    await expect(status).toBeVisible({ timeout: 10000 })
    await expect(status).toContainText('tenhands v1')
    await expect(page.locator('.automation-panel__lane')).toHaveCount(10)
    await expect(page.locator('.automation-panel__lane-by.is-agent')).toHaveCount(3)
  })

  test('activates immediately from the fetched contract', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 15000 })
    const board = boardName('commit')
    await createBoard(page, board)
    await openAutomationPanel(page, board)

    await page.locator('.automation-panel__preset').nth(1).click() // Simple Work, 3 lanes

    // A successful commit closes the panel and reloads the boards — no
    // separate Preview/Activate click in between.
    await expect(page.locator('.automation-panel__hint')).toBeHidden({ timeout: 10000 })

    // Re-open it: the board is now an automation board carrying the PROVIDER's
    // lanes — nothing was transcribed by hand between fetch and activation.
    await page.getByRole('button', { name: `Automation for ${board}` }).click()
    const status = page.locator('.automation-panel__status')
    await expect(status).toBeVisible({ timeout: 10000 })
    await expect(status).toContainText('Automation active')
    await expect(status).toContainText('tenhands-simple')
    await expect(page.locator('.automation-panel__lane')).toHaveCount(3)
    await expect(page.locator('.automation-panel__lane')).toContainText([
      'To Do',
      'Working',
      'Review'
    ])
    // The agent-owned lane is marked as such — the permission boundary is the
    // whole reason a lane set is worth fetching rather than retyping.
    await expect(page.locator('.automation-panel__lane-by.is-agent')).toHaveCount(1)
  })
})
