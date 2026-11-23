import { test, expect } from '@wolffm/e2e-harness/playwright'
import type { Page } from '@playwright/test'
import { API } from './helpers/stack'

/**
 * Tracker widgets, end to end against the REAL worker and its sqlite D1.
 *
 * Trackers are a widget on any board: a strip of tiles above the lanes, added
 * from the board toolbar's widget button (icon only, named "Add a widget"). Nothing is mocked. The only request
 * rewrite is the dev shim's identity headers: `X-Dev-Tier` stamps the tier the
 * edge would stamp in production (trackers are wife tier and up) and `X-Dev-As`
 * gives each test its own user, so boards and trackers never leak between tests.
 */

let seq = 0
function newUser(): string {
  return `tracker-e2e-${Date.now()}-${seq++}`
}

async function signInAs(page: Page, tier: string, userId: string) {
  await page.addInitScript(
    ([t]) => {
      localStorage.clear()
      localStorage.setItem('hadoku_session_id', 'dev-uid')
      localStorage.setItem('hadoku_user_type', t)
    },
    [tier]
  )
  // `**/task/api**`, not `**/task/api/**`: a task create posts to `/task/api`
  // itself, which the slash form misses — it then goes out unstamped, as the
  // shim's default user, and the task is never seen again on this user's board.
  await page.route('**/task/api**', route =>
    route.continue({
      headers: { ...route.request().headers(), 'x-dev-tier': tier, 'x-dev-as': userId }
    })
  )
}

/** Fails the test if a native dialog is raised: deletes must go through ConfirmModal. */
function dialogFuse(page: Page): string[] {
  const raised: string[] = []
  page.on('dialog', d => {
    raised.push(d.type())
    void d.dismiss()
  })
  return raised
}

const card = (page: Page, name: string) =>
  page.locator(`[data-testid="tracker-card"][data-tracker="${name}"]`)
const valueOf = (page: Page, name: string) => card(page, name).getByTestId('tracker-value')
const todayOf = (page: Page, name: string) => card(page, name).getByTestId('tracker-today')
const detail = (page: Page, name: string) => page.getByRole('dialog', { name })
const strip = (page: Page) => page.getByTestId('tracker-strip')
const taskCard = (page: Page, title: string) =>
  page.locator('.task-app__item').filter({ hasText: title })

async function addTask(page: Page, title: string) {
  const field = page.locator('.task-app__input')
  await field.fill(title)
  await field.press('Enter')
  await expect(taskCard(page, title)).toBeVisible()
}

async function openBoard(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
}

async function createBoard(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create board' }).click()
  await page.getByPlaceholder('Board name').fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
}

async function addTracker(page: Page, name: string, kind: 'Count' | 'Value', unit = '') {
  await page.getByRole('button', { name: 'Add a widget' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a widget' })
  await dialog.getByLabel('New tracker name').fill(name)
  await dialog.getByRole('radio', { name: kind }).click()
  if (unit) await dialog.getByLabel('New tracker unit').fill(unit)
  await dialog.getByRole('button', { name: 'Add tracker' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(card(page, name)).toBeVisible()
}

test.describe('tracker widgets', () => {
  test('a tracker sits above the lanes of a task board; taps, history and a value survive a reload', async ({
    page
  }) => {
    const raised = dialogFuse(page)
    await signInAs(page, 'wife', newUser())
    await page.goto('/')
    await createBoard(page, 'health')

    // An ordinary board: tasks first, no strip until a tracker is added.
    await addTask(page, 'Book a physio')
    await expect(strip(page)).toHaveCount(0)

    await addTracker(page, 'Pushups', 'Count', 'reps')
    await expect(strip(page)).toBeVisible()
    // The task UI stays: the tracker is a widget beside the tasks.
    await expect(page.locator('.task-app__input')).toBeVisible()
    await expect(taskCard(page, 'Book a physio')).toBeVisible()
    await expect(todayOf(page, 'Pushups')).toHaveText('0today')
    await expect(valueOf(page, 'Pushups')).toHaveText('0 reps total')

    // The tile's own button: +1 with no selecting first.
    const plus = card(page, 'Pushups').getByRole('button', { name: 'Add one to Pushups' })
    await plus.click()
    await expect(valueOf(page, 'Pushups')).toHaveText('1 reps total')
    await plus.click()
    await expect(valueOf(page, 'Pushups')).toHaveText('2 reps total')
    await plus.click()
    await expect(valueOf(page, 'Pushups')).toHaveText('3 reps total')
    await expect(todayOf(page, 'Pushups')).toHaveText('3today')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // The undo bar takes back the last tap.
    const undoBar = page.getByTestId('tracker-undo')
    await expect(undoBar).toContainText('Pushups +1 reps · 3 today')
    await undoBar.getByRole('button', { name: 'Undo' }).click()
    await expect(valueOf(page, 'Pushups')).toHaveText('2 reps total')
    await expect(undoBar).toHaveCount(0)

    // Anywhere else on the tile opens that tracker: −1, set, and its history.
    await card(page, 'Pushups').getByRole('button', { name: 'Open Pushups' }).click()
    const pushups = detail(page, 'Pushups')
    await expect(pushups.getByTestId('tracker-detail-value')).toHaveText('2reps')
    await pushups.getByRole('button', { name: 'Subtract one from Pushups' }).click()
    await expect(pushups.getByTestId('tracker-detail-value')).toHaveText('1reps')
    await pushups.getByLabel('Set Pushups to').fill('10')
    await pushups.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(pushups.getByTestId('tracker-detail-value')).toHaveText('10reps')
    const history = pushups.getByTestId('tracker-history-item')
    await expect(history).toHaveCount(4)
    await expect(history.first()).toContainText('+9 reps')
    await history
      .first()
      .getByRole('button', { name: /^Undo Pushups/ })
      .click()
    await expect(pushups.getByTestId('tracker-detail-value')).toHaveText('1reps')
    await expect(history).toHaveCount(3)
    await pushups.getByRole('button', { name: 'Close' }).click()
    await expect(pushups).toHaveCount(0)
    await expect(valueOf(page, 'Pushups')).toHaveText('1 reps total')

    // A value tracker: the tile's Log button asks for the reading.
    await addTracker(page, 'Weight', 'Value', 'kg')
    const logWeight = async (raw: string) => {
      await card(page, 'Weight').getByRole('button', { name: 'Log Weight' }).click()
      const dialog = page.getByRole('dialog', { name: 'Log Weight' })
      await dialog.getByLabel('New reading (kg)').fill(raw)
      await dialog.getByRole('button', { name: 'Log', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
    await logWeight('82.5')
    await expect(valueOf(page, 'Weight')).toHaveText('82.5kg')
    await logWeight('81,9')
    await expect(valueOf(page, 'Weight')).toHaveText('81.9kg')
    await expect(card(page, 'Weight')).toContainText('−0.6 kg this week')

    // The widgets belong to their board: another board has none.
    await openBoard(page, 'main')
    await expect(page.locator('.task-app__input')).toBeVisible()
    await expect(strip(page)).toHaveCount(0)

    // The server is the store: after a reload the board's list says it has
    // trackers, so the strip comes back with the same numbers, beside the task.
    await page.reload()
    await openBoard(page, 'health')
    await expect(valueOf(page, 'Pushups')).toHaveText('1 reps total')
    await expect(valueOf(page, 'Weight')).toHaveText('81.9kg')
    await expect(taskCard(page, 'Book a physio')).toBeVisible()

    expect(raised).toEqual([])
  })

  test('an entry written elsewhere (a button) shows up without a reload', async ({
    page,
    request
  }) => {
    const user = newUser()
    await signInAs(page, 'wife', user)
    await page.goto('/')
    await createBoard(page, 'water')
    await addTracker(page, 'Glasses', 'Count')

    const headers = { 'X-Dev-Tier': 'wife', 'X-Dev-As': user }
    const list = await request.get(`${API}/boards/water/trackers`, { headers })
    expect(list.ok()).toBe(true)
    const { trackers } = (await list.json()) as { trackers: Array<{ id: string; name: string }> }
    const glasses = trackers.find(t => t.name === 'Glasses')
    expect(glasses).toBeDefined()
    const hit = await request.post(`${API}/boards/water/trackers/${glasses?.id}/entries`, {
      headers,
      data: { source: 'button' }
    })
    expect(hit.ok()).toBe(true)

    // The strip re-reads on focus (and every 30s while visible).
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(valueOf(page, 'Glasses')).toHaveText('1 total')
    await card(page, 'Glasses').getByRole('button', { name: 'Open Glasses' }).click()
    await expect(
      detail(page, 'Glasses')
        .getByTestId('tracker-history-item')
        .first()
        .getByTitle('From a button')
    ).toBeVisible()
  })

  test('rename and delete go through the app; deleting the last tracker removes the strip', async ({
    page
  }) => {
    await page.addInitScript(() => {
      window.confirm = () => false
      window.prompt = () => null
      window.alert = () => {}
    })
    const raised = dialogFuse(page)
    await signInAs(page, 'admin', newUser())
    await page.goto('/')
    await createBoard(page, 'misc')
    await addTask(page, 'Descale the machine')
    await addTracker(page, 'Coffee', 'Count', 'cups')

    await card(page, 'Coffee').getByRole('button', { name: 'Open Coffee' }).click()
    await detail(page, 'Coffee').getByRole('button', { name: 'Rename' }).click()
    await detail(page, 'Coffee').getByLabel('Name', { exact: true }).fill('Espresso')
    await detail(page, 'Coffee').getByRole('button', { name: 'Save' }).click()
    await expect(detail(page, 'Espresso')).toBeVisible()
    await expect(card(page, 'Espresso')).toBeVisible()

    await detail(page, 'Espresso').getByRole('button', { name: 'Delete' }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete tracker?' })
    await expect(confirm.getByText('and its whole history will be deleted')).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(card(page, 'Espresso')).toHaveCount(0)
    await expect(strip(page)).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(taskCard(page, 'Descale the machine')).toBeVisible()
    expect(raised).toEqual([])
  })

  test('a board with no trackers never loads them', async ({ page }) => {
    await signInAs(page, 'wife', newUser())
    const trackerCalls: string[] = []
    page.on('request', r => {
      if (/\/task\/api\/.*\/trackers/.test(r.url())) trackerCalls.push(r.url())
    })
    await page.goto('/')
    await createBoard(page, 'plain')
    await addTask(page, 'Water the plants')
    await openBoard(page, 'main')
    await expect(page.getByRole('button', { name: 'Add a widget' })).toBeVisible()
    expect(trackerCalls).toEqual([])
    // Opening "Add a widget" and cancelling leaves no strip behind.
    await page.getByRole('button', { name: 'Add a widget' }).click()
    await page
      .getByRole('dialog', { name: 'Add a widget' })
      .getByRole('button', { name: 'Cancel' })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(strip(page)).toHaveCount(0)
  })

  test('Add a widget opens at once: the chunk is preloaded and nothing says loading', async ({
    page
  }) => {
    await signInAs(page, 'wife', newUser())
    // The chunk is fetched after the core page is up, without a click.
    const preloaded = page.waitForRequest(r =>
      r.url().includes('/components/trackers/TrackerStrip')
    )
    await page.goto('/')
    await addTask(page, 'Ready')
    await preloaded

    // Hold the board's tracker list: the dialog must not wait on it.
    let release!: () => void
    const held = new Promise<void>(r => (release = r))
    await page.route(/\/task\/api\/.*\/trackers(\?|$)/, async route => {
      await held
      await route.fallback()
    })
    await page.getByRole('button', { name: 'Add a widget' }).click()
    await expect(page.getByRole('dialog', { name: 'Add a widget' })).toBeVisible()
    await expect(page.getByText(/loading/i)).toHaveCount(0)
    await expect(strip(page)).toHaveCount(0)
    release()

    const dialog = page.getByRole('dialog', { name: 'Add a widget' })
    await dialog.getByLabel('New tracker name').fill('Water')
    await dialog.getByRole('button', { name: 'Add tracker' }).click()
    await expect(card(page, 'Water')).toBeVisible()
  })

  test('below wife tier the Widget button offers sequences only, and there is no board type to pick', async ({
    page
  }) => {
    // Trackers are wife tier and up; sequence widgets are member and up
    // (e2e/sequences.spec.ts). So a friend's widget button skips the tracker
    // form and opens the sequence library.
    await signInAs(page, 'friend', newUser())
    await page.goto('/')
    await expect(page.locator('.task-app__input')).toBeVisible()
    await page.getByRole('button', { name: 'Add a widget' }).click()
    const pick = page.getByRole('dialog', { name: 'Add a sequence' })
    await expect(pick).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Add a widget' })).toHaveCount(0)
    await expect(page.getByLabel('New tracker name')).toHaveCount(0)
    await pick.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Create board' }).click()
    await expect(page.getByPlaceholder('Board name')).toBeVisible()
    await expect(page.getByRole('radio')).toHaveCount(0)
  })

  test('a tracker chunk that will not load offers a reload, not a blank strip', async ({
    page
  }) => {
    // The tracker UI is a lazy chunk. A tab left open across a deploy runs the
    // old entry, which names a chunk the deploy deleted; that import fails.
    await signInAs(page, 'wife', newUser())
    await page.route('**/components/trackers/TrackerStrip.tsx*', route => route.abort())
    await page.goto('/')
    await addTask(page, 'Still here')

    await page.getByRole('button', { name: 'Add a widget' }).click()
    const alert = strip(page).getByRole('alert')
    await expect(alert).toContainText("Couldn't load the trackers")
    await expect(alert.getByRole('button', { name: 'Reload' })).toBeVisible()
    // The board itself is still standing.
    await expect(taskCard(page, 'Still here')).toBeVisible()
  })
})
