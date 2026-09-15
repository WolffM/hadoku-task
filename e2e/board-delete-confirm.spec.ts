import { test, expect, type Page } from '@playwright/test'
import { signIn } from './helpers/stack'

/**
 * Deleting a board must not depend on window.confirm().
 *
 * The bug: every destructive board action was guarded by `if (confirm(...))`.
 * Chrome's "prevent this page from creating additional dialogs" checkbox — the
 * one offered after a couple of dialogs in a row, which is exactly what a user
 * deleting SEVERAL boards gets shown — makes every later confirm() return
 * `false` without rendering anything. The guard then fails closed forever: the
 * Delete button stays clickable, fires no request, shows no dialog and logs
 * nothing. The only escape was clearing the site's settings in Chrome.
 *
 * So these specs run with confirm/alert/prompt NEUTERED, the same way the
 * browser neuters them, and assert the app still works. `dialogFuse` also fails
 * the test if a native dialog is ever raised, which pins the other half: the
 * app must not go back to asking the browser to draw its dialogs.
 */

const MAIN = { id: 'main', name: 'Main', tasks: [], tags: [] }
const DOOMED = { id: 'doomed', name: 'Doomed Board', tasks: [], tags: [] }
const KEEPER = { id: 'keeper', name: 'Keeper Board', tasks: [], tags: [] }

/** A boards endpoint that actually remembers a DELETE, so the row can go away. */
async function statefulBoards(page: Page) {
  const boards = [MAIN, DOOMED, KEEPER]
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
        boards: boards.filter(b => !deleted.includes(b.id))
      })
    })
  })

  return deleted
}

/**
 * Reproduce the browser's suppressed state: confirm() returns false, alert()
 * and prompt() do nothing. Added as an init script so it is in place before the
 * app's own code runs, which is when the real setting takes effect too.
 */
async function suppressNativeDialogs(page: Page) {
  await page.addInitScript(() => {
    window.confirm = () => false
    window.prompt = () => null
    window.alert = () => {}
  })
}

/** Fails the test if any native dialog is raised at all. */
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

// statefulBoards is called per-test, not here: each test wants its own handle
// on the `deleted` list, and registering the route twice would leave a stale
// handler underneath the live one.
test.beforeEach(async ({ page }) => {
  await suppressNativeDialogs(page)
  await signIn(page)
})

test('a board can be deleted while the browser refuses to show dialogs', async ({ page }) => {
  const fuse = dialogFuse(page)
  const deleted = await statefulBoards(page)
  await openEditBoards(page)

  const row = page.locator('.edit-boards__row', { hasText: 'Doomed Board' })
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: 'Delete Doomed Board' }).click()

  // The app draws its own dialog. Before the fix, nothing at all happened here.
  const confirmDialog = page.locator('.confirm-modal')
  await expect(confirmDialog).toBeVisible()
  await expect(confirmDialog).toContainText('Doomed Board')

  await confirmDialog.getByRole('button', { name: 'Delete board' }).click()

  await expect(page.locator('.edit-boards__row', { hasText: 'Doomed Board' })).toHaveCount(0)
  await expect(page.locator('.edit-boards__row', { hasText: 'Keeper Board' })).toBeVisible()
  await expect.poll(() => deleted).toContain('doomed')

  expect(fuse.raised, 'the app must not raise native browser dialogs').toEqual([])
})

test('several boards can be deleted in a row', async ({ page }) => {
  const fuse = dialogFuse(page)
  await statefulBoards(page)
  await openEditBoards(page)

  for (const name of ['Doomed Board', 'Keeper Board']) {
    await page
      .locator('.edit-boards__row', { hasText: name })
      .getByRole('button', {
        name: `Delete ${name}`
      })
      .click()
    await page.locator('.confirm-modal').getByRole('button', { name: 'Delete board' }).click()
    await expect(page.locator('.edit-boards__row', { hasText: name })).toHaveCount(0)
  }

  // The Edit Boards dialog survives the whole run — deleting is not a one-shot.
  await expect(page.locator('.edit-boards-modal')).toBeVisible()
  expect(fuse.raised).toEqual([])
})

test('cancelling keeps the board', async ({ page }) => {
  const deleted = await statefulBoards(page)
  await openEditBoards(page)

  await page
    .locator('.edit-boards__row', { hasText: 'Doomed Board' })
    .getByRole('button', { name: 'Delete Doomed Board' })
    .click()
  await page.locator('.confirm-modal').getByRole('button', { name: 'Cancel' }).click()

  await expect(page.locator('.confirm-modal')).toHaveCount(0)
  await expect(page.locator('.edit-boards__row', { hasText: 'Doomed Board' })).toBeVisible()
  expect(deleted).toEqual([])
})

test('Escape backs out of the confirm without closing Edit Boards', async ({ page }) => {
  await statefulBoards(page)
  await openEditBoards(page)

  await page
    .locator('.edit-boards__row', { hasText: 'Doomed Board' })
    .getByRole('button', { name: 'Delete Doomed Board' })
    .click()
  await expect(page.locator('.confirm-modal')).toBeVisible()

  await page.keyboard.press('Escape')

  // Only the top-most dialog answers Escape. Both listeners are live, so
  // without the modal stack this one keypress closed the board list too and
  // the user lost their place on every cancelled delete.
  await expect(page.locator('.confirm-modal')).toHaveCount(0)
  await expect(page.locator('.edit-boards-modal')).toBeVisible()
  await expect(page.locator('.edit-boards__row', { hasText: 'Doomed Board' })).toBeVisible()
})

test('the board context menu deletes without a native dialog', async ({ page }) => {
  const fuse = dialogFuse(page)
  const deleted = await statefulBoards(page)

  await page.goto('/')
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })

  const pill = page.locator('.board-btn', { hasText: 'Doomed Board' })
  await expect(pill).toBeVisible()
  await pill.click({ button: 'right' })

  await page.locator('.board-context-menu').getByText('Delete Board').click()

  const confirmDialog = page.locator('.confirm-modal')
  await expect(confirmDialog).toBeVisible()
  await expect(confirmDialog).toContainText('Doomed Board')
  await confirmDialog.getByRole('button', { name: 'Delete board' }).click()

  await expect(page.locator('.board-btn', { hasText: 'Doomed Board' })).toHaveCount(0)
  await expect.poll(() => deleted).toContain('doomed')
  expect(fuse.raised).toEqual([])
})
