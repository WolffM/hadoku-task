import { test, expect, type Page } from '@playwright/test'
import { API } from './helpers/stack'

/**
 * Tracker boards, end to end against the REAL worker and its sqlite D1.
 *
 * Nothing is mocked. The only request rewrite is the dev shim's identity
 * headers: `X-Dev-Tier` stamps the tier the edge would stamp in production
 * (tracker boards are wife tier and up) and `X-Dev-As` gives each test its own
 * user, so boards and trackers from one test can never leak into another.
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
  await page.route('**/task/api/**', route =>
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

async function createTrackerBoard(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create board' }).click()
  await page.getByRole('radio', { name: 'Tracker' }).click()
  await page.getByPlaceholder('Board name').fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByTestId('tracker-board')).toBeVisible()
}

async function addTracker(page: Page, name: string, kind: 'Count' | 'Value', unit = '') {
  const form = page.getByRole('form', { name: 'Add a tracker' })
  await form.getByLabel('New tracker name').fill(name)
  await form.getByRole('radio', { name: kind }).click()
  if (unit) await form.getByLabel('New tracker unit').fill(unit)
  await form.getByRole('button', { name: 'Add tracker' }).click()
  await expect(card(page, name)).toBeVisible()
}

test.describe('tracker boards', () => {
  test('count, set, undo, log a value, and survive a reload', async ({ page }) => {
    const raised = dialogFuse(page)
    await signInAs(page, 'wife', newUser())
    await page.goto('/')

    await createTrackerBoard(page, 'health')
    // The task UI is gone: no capture input on a tracker board.
    await expect(page.locator('.task-app__input')).toHaveCount(0)

    await addTracker(page, 'Pushups', 'Count', 'reps')
    await expect(valueOf(page, 'Pushups')).toHaveText('0reps')

    const plus = card(page, 'Pushups').getByRole('button', { name: 'Add one to Pushups' })
    await plus.click()
    await expect(valueOf(page, 'Pushups')).toHaveText('1reps')
    await plus.click()
    await expect(valueOf(page, 'Pushups')).toHaveText('2reps')
    await plus.click()
    await expect(valueOf(page, 'Pushups')).toHaveText('3reps')
    await card(page, 'Pushups').getByRole('button', { name: 'Subtract one from Pushups' }).click()
    await expect(valueOf(page, 'Pushups')).toHaveText('2reps')
    await expect(card(page, 'Pushups').getByTestId('tracker-today')).toHaveText('Today +2')

    // Set the count outright; history records it, undo takes it back.
    await card(page, 'Pushups').getByRole('button', { name: 'Set', exact: true }).click()
    await card(page, 'Pushups').getByLabel('Set Pushups to').fill('10')
    await card(page, 'Pushups').getByRole('button', { name: 'Set', exact: true }).last().click()
    await expect(valueOf(page, 'Pushups')).toHaveText('10reps')
    const history = page.getByTestId('tracker-history-item')
    await expect(history).toHaveCount(5)
    await expect(history.first()).toContainText('+8 reps')
    await history
      .first()
      .getByRole('button', { name: /^Undo Pushups/ })
      .click()
    await expect(valueOf(page, 'Pushups')).toHaveText('2reps')
    await expect(history).toHaveCount(4)

    // A value tracker records readings.
    await addTracker(page, 'Weight', 'Value', 'kg')
    await card(page, 'Weight').getByLabel('New Weight reading').fill('82.5')
    await card(page, 'Weight').getByRole('button', { name: 'Log' }).click()
    await expect(valueOf(page, 'Weight')).toHaveText('82.5kg')
    await card(page, 'Weight').getByLabel('New Weight reading').fill('81,9')
    await card(page, 'Weight').getByRole('button', { name: 'Log' }).click()
    await expect(valueOf(page, 'Weight')).toHaveText('81.9kg')
    await expect(card(page, 'Weight')).toContainText('7 days −0.6 kg')

    // The server is the store: a reload shows the same numbers and history.
    // (A reload opens `main`, as it does for every board.)
    await page.reload()
    await page.getByRole('button', { name: 'health', exact: true }).click()
    await expect(valueOf(page, 'Pushups')).toHaveText('2reps')
    await expect(valueOf(page, 'Weight')).toHaveText('81.9kg')
    await expect(page.getByTestId('tracker-history-item')).toHaveCount(6)

    expect(raised).toEqual([])
  })

  test('an entry written elsewhere (a button) shows up without a reload', async ({
    page,
    request
  }) => {
    const user = newUser()
    await signInAs(page, 'wife', user)
    await page.goto('/')
    await createTrackerBoard(page, 'water')
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

    // The board re-reads on focus (and every 30s while visible).
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(valueOf(page, 'Glasses')).toHaveText('1')
    await expect(
      page.getByTestId('tracker-history-item').first().getByTitle('From a button')
    ).toBeVisible()
  })

  test('rename and delete go through the app, not native dialogs', async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => false
      window.prompt = () => null
      window.alert = () => {}
    })
    const raised = dialogFuse(page)
    await signInAs(page, 'admin', newUser())
    await page.goto('/')
    await createTrackerBoard(page, 'misc')
    await addTracker(page, 'Coffee', 'Count', 'cups')

    await card(page, 'Coffee').getByRole('button', { name: 'Rename Coffee' }).click()
    await page.getByLabel('Tracker name', { exact: true }).fill('Espresso')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(card(page, 'Espresso')).toBeVisible()

    await card(page, 'Espresso').getByRole('button', { name: 'Delete Espresso' }).click()
    await expect(page.getByText('and its whole history will be deleted')).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(card(page, 'Espresso')).toHaveCount(0)
    expect(raised).toEqual([])
  })

  test('below wife tier the tracker type is not offered', async ({ page }) => {
    await signInAs(page, 'friend', newUser())
    await page.goto('/')
    await page.getByRole('button', { name: 'Create board' }).click()
    await expect(page.getByPlaceholder('Board name')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Tracker' })).toHaveCount(0)
  })

  test('a tracker chunk that will not load offers a reload, not a blank board', async ({
    page
  }) => {
    // The tracker UI is a lazy chunk. A tab left open across a deploy runs the
    // old entry, which names a chunk the deploy deleted; that import fails.
    await signInAs(page, 'wife', newUser())
    await page.route('**/components/trackers/TrackerBoard.tsx*', route => route.abort())
    await page.goto('/')

    await page.getByRole('button', { name: 'Create board' }).click()
    await page.getByRole('radio', { name: 'Tracker' }).click()
    await page.getByPlaceholder('Board name').fill('stale')
    await page.getByRole('button', { name: 'Create', exact: true }).click()

    const alert = page.getByTestId('tracker-board').getByRole('alert')
    await expect(alert).toContainText("Couldn't open stale")
    await expect(alert.getByRole('button', { name: 'Reload' })).toBeVisible()
    // The rest of the app is still standing.
    await expect(page.getByRole('button', { name: 'Create board' })).toBeVisible()
  })
})
