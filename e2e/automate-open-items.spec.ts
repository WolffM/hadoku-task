import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

/**
 * "Automate open items" (§5.6), end to end in a real browser.
 *
 * The worker harness (`worker/test/actionable-verify.ts`) proves the scan; what
 * only a browser can prove is the part that lives in the app: that the button
 * appears on the right board, that clicking it creates ORDINARY Inbox tasks, and
 * that the same board scanned again offers nothing — the dedup that stands in
 * for a lock.
 *
 * The title trap is the reason this exists as a UI spec at all. These titles
 * contain `#42`, and the app's typed-input parser reads a trailing `#word` as a
 * tag — a wiring mistake here files "Address" under a lane called "42", with
 * every worker test still green.
 *
 * Requires the local API stack (`node scripts/dev-api.mjs`): the real worker on
 * :3001 and the provider stub on :3002, which serves the two issues and one PR
 * asserted below. Skipped when it isn't up.
 */

const API = 'http://127.0.0.1:3001/task/api'

/** Sign in the way the key-swap flow does: the app reads these on boot. */
async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hadoku_session_id', 'dev-uid')
    localStorage.setItem('hadoku_user_type', 'friend')
  })
}

async function apiUp(request: APIRequestContext): Promise<boolean> {
  try {
    return (await request.get(`${API}/automation/presets`)).ok()
  } catch {
    return false
  }
}

/**
 * An automation board wired to a repo, built through the API: activation is
 * permanent and the dev stack shares one in-memory DB for the whole run, so a
 * board driven through the picker would be already-activated on the next test.
 */
async function createAutomationBoard(request: APIRequestContext, id: string, repo = 'WolffM/dev') {
  await request.post(`${API}/boards`, { data: { id, name: id } })
  const presets = await (await request.get(`${API}/automation/presets`)).json()
  const preset = presets.presets.find((p: { schemaId: string }) => p.schemaId === 'tenhands-simple')
  const applied = await request.post(`${API}/boards/${id}/activate-automation`, {
    data: { schemaId: preset.schemaId, schemaVersion: preset.schemaVersion, lanes: preset.lanes }
  })
  expect(applied.ok()).toBe(true)
  expect((await request.post(`${API}/boards/${id}/repo`, { data: { repo } })).ok()).toBe(true)
}

async function openBoard(page: Page, boardId: string) {
  await page.goto('/')
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
  await page.getByRole('button', { name: boardId, exact: true }).click()
}

const automateBtn = (page: Page) => page.locator('.task-app__filter-automate')
const cards = (page: Page) => page.locator('.task-app__item')

/** Unique per RUN and per test — the dev stack's DB outlives one invocation. */
const uniqueId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${test
    .info()
    .testId.replace(/[^a-z0-9]/gi, '')
    .slice(0, 6)}`

test.describe('Automate open items', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')
    await signIn(page)
  })

  test('turns the repo’s open issues and PRs into ordinary Inbox tasks', async ({
    page,
    request
  }) => {
    const board = uniqueId('automate')
    await createAutomationBoard(request, board)
    await openBoard(page, board)

    // The stub publishes three actionable items; none has a task yet.
    const button = automateBtn(page)
    await expect(button).toBeVisible({ timeout: 15000 })
    await expect(button).toHaveText('Automate 3 open items')

    await button.click()

    // One task per item, titled as the provider suggested — NOT "Address" with
    // the number peeled off into a tag.
    await expect(cards(page)).toHaveCount(3, { timeout: 15000 })
    const titles = await page.locator('.task-app__item-title').allInnerTexts()
    expect(titles.map(t => t.trim()).sort()).toEqual([
      'Address #42',
      'Address #51',
      'Address PR #17'
    ])

    // Untagged — the Inbox, not a lane. The pipeline picks work up from there;
    // landing in a lane would have been a claim nobody made. On an automation
    // board every lane is empty and `hideEmptyLanes` renders none, so "no lane
    // column holds these cards" is the visible form of untagged.
    await expect(page.locator('.task-app__tag-column')).toHaveCount(0)
    await expect(page.locator('.task-app__list').first().locator('.task-app__item')).toHaveCount(3)

    // Spent: every item now has a task, so the count falls to zero and the
    // button leaves with it. (The hook also latches `disabled` the moment the
    // run starts, which is what covers the gap before the board repaints.)
    await expect(button).toHaveCount(0)

    // And what the server actually stored: untagged rows whose notes carry the
    // link and the kind-specific instruction the runner acts on.
    const stored = await (await request.get(`${API}/boards/${board}`)).json()
    const rows = stored.tasks as Array<{ title: string; tag?: string | null; notes?: string }>
    expect(rows).toHaveLength(3)
    expect(rows.every(r => !r.tag)).toBe(true)
    const prRow = rows.find(r => r.title === 'Address PR #17')
    expect(prRow?.notes).toContain('https://github.com/WolffM/dev-fixture/pull/17')
    expect(prRow?.notes).toContain('Check out branch feature-sync-retry')
    const issueRow = rows.find(r => r.title === 'Address #42')
    expect(issueRow?.notes).toContain('Reproduce if needed, fix it, and open a PR.')
    expect(issueRow?.notes).toContain('Switching boards leaves')
  })

  test('offers nothing on the next load — the dedup that replaces a lock', async ({
    page,
    request
  }) => {
    const board = uniqueId('dedupe')
    await createAutomationBoard(request, board)
    // Two of the three items already have tasks, one of them completed: finished
    // work must not come back round as something still to automate.
    expect(
      (
        await request.post(API, {
          data: { boardId: board, id: `${board}-a`, title: 'Address #42' }
        })
      ).ok()
    ).toBe(true)
    expect(
      (
        await request.post(API, {
          data: { boardId: board, id: `${board}-b`, title: 'Address PR #17' }
        })
      ).ok()
    ).toBe(true)
    expect(
      (await request.post(`${API}/${board}-b/complete?board=${board}`, { data: {} })).ok()
    ).toBe(true)

    await openBoard(page, board)
    const button = automateBtn(page)
    await expect(button).toBeVisible({ timeout: 15000 })
    await expect(button).toHaveText('Automate 1 open item')

    await button.click()
    await expect(page.locator('.task-app__item-title', { hasText: 'Address #51' })).toBeVisible({
      timeout: 15000
    })

    // Reload: every item now has a task, so there is nothing to offer.
    await openBoard(page, board)
    await expect(page.locator('.task-app__item-title', { hasText: 'Address #51' })).toBeVisible({
      timeout: 15000
    })
    await expect(button).toHaveCount(0)
  })

  test('stays hidden on a board with nothing to automate', async ({ page, request }) => {
    // An ordinary board — where most people spend all their time. Nothing about
    // this feature may appear here. (`main` rather than a board of our own: an
    // unpinned standard board isn't in the top bar to click, while the
    // standard-board rule itself is asserted server-side in actionable-verify.)
    await page.goto('/')
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
    await expect(page.locator('.task-app__filters')).toBeVisible({ timeout: 15000 })
    await expect(automateBtn(page)).toHaveCount(0)

    // An automation board with NO repo: nothing to scan.
    const noRepo = uniqueId('norepo')
    await createAutomationBoard(request, noRepo, '')
    await openBoard(page, noRepo)
    await expect(page.locator('.task-app__filters')).toBeVisible({ timeout: 15000 })
    await expect(automateBtn(page)).toHaveCount(0)
  })
})
