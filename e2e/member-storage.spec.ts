import { test, expect, type Page, type Request } from '@playwright/test'
import { apiUp } from './helpers/stack'

/**
 * The member model's storage (#107): the server stores boards and tasks for a
 * member exactly as for a friend, and for nobody below member
 * (worker/src/storage-access.ts). The edge sends `member` only for an account
 * the operator verified, so a guest is the one signed-in tier refused. The app
 * must run a guest the way it runs a public visitor — on this device only — or
 * every write would be refused, and before the gate they all landed in one
 * shared 'public' bucket.
 */

/** Requests to the task API, as the app makes them — the storage traffic. */
function taskApiCalls(page: Page): Request[] {
  const seen: Request[] = []
  page.on('request', r => {
    if (new URL(r.url()).pathname.startsWith('/task/api/')) seen.push(r)
  })
  return seen
}

async function bootAs(page: Page, tier: 'member' | 'guest') {
  await page.addInitScript(t => {
    localStorage.setItem('hadoku_user_type', t)
    localStorage.setItem('hadoku_session_id', `${t}-session`)
  }, tier)
  await page.goto('/')
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
}

async function addTask(page: Page, title: string) {
  const field = page.locator('.task-app__input')
  await field.fill(title)
  await field.press('Enter')
  await expect(page.getByText(title, { exact: true })).toBeVisible()
}

test.describe('member storage', () => {
  test('a guest stays on this device: no task API calls, and the task survives a reload', async ({
    page
  }) => {
    const calls = taskApiCalls(page)
    await bootAs(page, 'guest')
    await addTask(page, 'Guest kept locally')
    await page.reload()
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
    await expect(page.getByText('Guest kept locally', { exact: true })).toBeVisible()
    expect(calls.map(r => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual([])
  })

  test('a member syncs to the server, as a friend does', async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'local stack not running (playwright.config.ts starts it)')
    const calls = taskApiCalls(page)
    const boards = page.waitForResponse(
      r => new URL(r.url()).pathname === '/task/api/boards' && r.request().method() === 'GET'
    )
    await bootAs(page, 'member')
    expect((await boards).ok()).toBe(true)
    expect(calls.length).toBeGreaterThan(0)
  })
})
