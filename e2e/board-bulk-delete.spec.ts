import { test, expect, type Page } from '@playwright/test'
import { signIn } from './helpers/stack'

/**
 * Deleting several boards is ONE confirmation, not one per board.
 *
 * This is the other half of the bug that started here. Per-board confirms are
 * what pushed a user into Chrome's "prevent this page from creating additional
 * dialogs" checkbox, which then made every delete a silent no-op
 * (board-delete-confirm.spec.ts pins that). Making the batch a batch removes the
 * reason to reach for that checkbox at all.
 *
 * Runs with native dialogs neutered throughout, and fails if one is raised.
 */

const MAIN = { id: 'main', name: 'Main', tasks: [], tags: [] }
const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta']

/**
 * A boards endpoint that remembers DELETEs, so rows can actually go away.
 *
 * `names` is a knob because the search box only renders above six boards —
 * the spec that filters needs to clear that threshold.
 */
async function statefulBoards(page: Page, names: string[] = NAMES) {
  const deleted: string[] = []

  await page.route('**/task/api/session/handshake', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ preferences: null })
    })
  )

  await page.route('**/task/api/boards**', route => {
    const req = route.request()
    if (req.method() === 'DELETE') {
      const id = decodeURIComponent(new URL(req.url()).pathname.split('/').pop() ?? '')
      deleted.push(id)
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        boards: [
          MAIN,
          ...names.map(n => ({ id: n.toLowerCase(), name: n, tasks: [], tags: [] }))
        ].filter(b => !deleted.includes(b.id))
      })
    })
  })

  return deleted
}

async function suppressNativeDialogs(page: Page) {
  await page.addInitScript(() => {
    window.confirm = () => false
    window.prompt = () => null
    window.alert = () => {}
  })
}

function dialogFuse(page: Page): { raised: string[] } {
  const raised: string[] = []
  page.on('dialog', async d => {
    raised.push(`${d.type()}: ${d.message()}`)
    await d.dismiss()
  })
  return { raised }
}

async function openEditBoards(page: Page) {
  await page.goto('/')
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
  await page.getByRole('button', { name: 'Edit boards' }).click()
  await expect(page.locator('.edit-boards-modal')).toBeVisible()
}

const row = (page: Page, name: string) => page.locator('.edit-boards__row', { hasText: name })
const checkFor = (page: Page, name: string) => row(page, name).getByRole('checkbox')

test.beforeEach(async ({ page }) => {
  await suppressNativeDialogs(page)
  await signIn(page)
})

test('three boards are deleted through a single confirmation', async ({ page }) => {
  const fuse = dialogFuse(page)
  const deleted = await statefulBoards(page)
  await openEditBoards(page)

  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    await checkFor(page, name).check()
  }

  const bar = page.locator('.edit-boards__bulk').first()
  await expect(bar).toContainText('3 selected')

  await bar.getByRole('button', { name: 'Delete 3 boards' }).click()

  // ONE dialog, naming every board — a bulk confirm that only says "3 boards"
  // asks the user to trust a count they cannot check.
  const dialog = page.locator('.confirm-modal')
  await expect(dialog).toHaveCount(1)
  await expect(dialog).toContainText('Alpha')
  await expect(dialog).toContainText('Beta')
  await expect(dialog).toContainText('Gamma')

  await dialog.getByRole('button', { name: 'Delete 3 boards' }).click()

  // And no second dialog behind it.
  await expect(page.locator('.confirm-modal')).toHaveCount(0)
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    await expect(row(page, name)).toHaveCount(0)
  }
  await expect(row(page, 'Delta')).toBeVisible()
  await expect.poll(() => deleted.sort()).toEqual(['alpha', 'beta', 'gamma'])

  expect(fuse.raised, 'the app must not raise native browser dialogs').toEqual([])
})

test('select all takes every board except main', async ({ page }) => {
  const deleted = await statefulBoards(page)
  await openEditBoards(page)

  await page
    .locator('.edit-boards__bulk')
    .first()
    .getByRole('checkbox', { name: /select all/i })
    .check()

  // `main` cannot be deleted, so it is not selectable and must not be counted.
  await expect(page.locator('.edit-boards__bulk').first()).toContainText('4 selected')
  await expect(checkFor(page, 'Main')).toHaveCount(0)

  await page.getByRole('button', { name: 'Delete 4 boards' }).first().click()
  await page.locator('.confirm-modal').getByRole('button', { name: 'Delete 4 boards' }).click()

  await expect(row(page, 'Main')).toBeVisible()
  await expect(page.locator('.edit-boards__row')).toHaveCount(1)
  await expect.poll(() => deleted.length).toBe(4)
})

test('a selection survives filtering, and says how much it is hiding', async ({ page }) => {
  // Seven boards, so the modal renders its search box.
  const deleted = await statefulBoards(page, [...NAMES, 'Epsilon', 'Zeta', 'Eta'])
  await openEditBoards(page)

  await checkFor(page, 'Alpha').check()
  await checkFor(page, 'Beta').check()

  // Narrow the list so one of the two selected rows is off-screen. The count
  // must not silently drop the row the search hid.
  await page.locator('.edit-boards__search').fill('Alpha')
  await expect(row(page, 'Beta')).toHaveCount(0)

  const bar = page.locator('.edit-boards__bulk').first()
  await expect(bar).toContainText('2 selected')
  await expect(bar).toContainText('1 not shown')

  await bar.getByRole('button', { name: 'Delete 2 boards' }).click()
  await page.locator('.confirm-modal').getByRole('button', { name: 'Delete 2 boards' }).click()

  await expect.poll(() => deleted.sort()).toEqual(['alpha', 'beta'])
})

test('cancelling a bulk delete keeps every board and the selection', async ({ page }) => {
  const deleted = await statefulBoards(page)
  await openEditBoards(page)

  await checkFor(page, 'Alpha').check()
  await checkFor(page, 'Beta').check()
  await page.getByRole('button', { name: 'Delete 2 boards' }).first().click()
  await page.locator('.confirm-modal').getByRole('button', { name: 'Cancel' }).click()

  await expect(page.locator('.confirm-modal')).toHaveCount(0)
  await expect(row(page, 'Alpha')).toBeVisible()
  await expect(row(page, 'Beta')).toBeVisible()
  // Still checked: cancelling means "not yet", not "start over".
  await expect(page.locator('.edit-boards__bulk').first()).toContainText('2 selected')
  expect(deleted).toEqual([])
})

test('a single row button still deletes just that board', async ({ page }) => {
  const deleted = await statefulBoards(page)
  await openEditBoards(page)

  await row(page, 'Delta').getByRole('button', { name: 'Delete Delta' }).click()
  const dialog = page.locator('.confirm-modal')
  await expect(dialog).toContainText('Delta')
  await dialog.getByRole('button', { name: 'Delete board' }).click()

  await expect(row(page, 'Delta')).toHaveCount(0)
  await expect(row(page, 'Alpha')).toBeVisible()
  await expect.poll(() => deleted).toEqual(['delta'])
})
