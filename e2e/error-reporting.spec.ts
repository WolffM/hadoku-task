import { test, expect, type Page } from '@playwright/test'

/**
 * A failed operation has to SAY so.
 *
 * Every foreground failure in this app used to report through `alert()`. A
 * browser told to "prevent this page from creating additional dialogs" returns
 * from alert() without drawing anything, so on the one setting a frustrated user
 * is most likely to have ticked, a failed create/complete/delete/drop reported
 * itself to nobody at all: the card just didn't appear and nothing explained it.
 *
 * Toasts are the app's own, and nothing in the browser can switch them off.
 *
 * The failure injected here is the one that actually reaches these code paths.
 * Every write is optimistic — it lands in localStorage first and syncs to the
 * server fire-and-forget, so a server refusal is reported by onSyncError (see
 * refused-writes.spec.ts). The foreground catch fires when the LOCAL write
 * fails: a full quota, or site data blocked. That is a real state — Safari
 * private mode, a full origin — and it is the one where the user is most
 * stranded, because nothing reaches the server to report either.
 *
 * Runs in public mode (localStorage-only), so it needs no backend.
 */

const toast = (page: Page) => page.locator('.toast, [role="alert"]')

/**
 * Break the task blob's write the way a full origin does, leaving every other
 * key alone — the app boots through localStorage and would not start otherwise.
 */
async function breakTaskWrites(page: Page) {
  await page.addInitScript(() => {
    const realSetItem = window.localStorage.setItem.bind(window.localStorage)
    window.localStorage.setItem = (key: string, value: string) => {
      if (key.endsWith('-tasks')) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      realSetItem(key, value)
    }
  })
}

/** Neuter native dialogs exactly as the browser setting does. */
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

test('a failed task create is reported, with dialogs switched off', async ({ page }) => {
  const fuse = dialogFuse(page)
  await suppressNativeDialogs(page)
  await breakTaskWrites(page)

  await page.goto('/?userType=public')
  const field = page.locator('.task-app__input')
  await field.waitFor({ timeout: 15000 })

  await field.fill('This will not save')
  await field.press('Enter')

  // Before the fix this was an alert() the browser had been told to swallow:
  // no card, no message, no log the user could see.
  await expect(toast(page).first()).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.task-app__item', { hasText: 'This will not save' })).toHaveCount(0)

  expect(fuse.raised, 'the app must not raise native browser dialogs').toEqual([])
})

test('the toast carries the real reason, not a generic failure', async ({ page }) => {
  await suppressNativeDialogs(page)
  await breakTaskWrites(page)

  await page.goto('/?userType=public')
  const field = page.locator('.task-app__input')
  await field.waitFor({ timeout: 15000 })
  await field.fill('Explain yourself')
  await field.press('Enter')

  // The thrown error's own message, so a user can tell a full disk apart from a
  // refused write. `report()` only falls back to a generic string when the
  // error carries none.
  await expect(toast(page).first()).toContainText(/quota/i, { timeout: 10000 })
})

test('a working board raises no dialogs and no error toasts', async ({ page }) => {
  const fuse = dialogFuse(page)
  await suppressNativeDialogs(page)

  await page.goto('/?userType=public')
  const field = page.locator('.task-app__input')
  await field.waitFor({ timeout: 15000 })

  await field.fill('This one is fine')
  await field.press('Enter')
  await expect(page.locator('.task-app__item', { hasText: 'This one is fine' })).toBeVisible()

  // The complete/delete controls run through the same reporting path; a healthy
  // run must stay silent, or the guard above would pass on a permanently noisy
  // app.
  await expect(toast(page)).toHaveCount(0)
  expect(fuse.raised).toEqual([])
})
