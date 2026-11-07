import { test, expect, type Page, type Request } from '@playwright/test'
import { apiUp } from './helpers/stack'

/**
 * The member model's storage (#107): the server stores boards and tasks for a
 * VERIFIED member exactly as for a friend, and for nobody without a verified
 * identity (worker/src/storage-access.ts). So the app must run an unverified
 * member the way it runs a public visitor — on this device only — or every
 * write would be refused, and before the gate they all landed in one shared
 * 'public' bucket.
 *
 * The host passes whoami's `verified` as a prop; the dev harness takes it as
 * `?verified=1` (index.html).
 */

/** Requests to the task API, as the app makes them — the storage traffic. */
function taskApiCalls(page: Page): Request[] {
  const seen: Request[] = []
  page.on('request', r => {
    if (new URL(r.url()).pathname.startsWith('/task/api/')) seen.push(r)
  })
  return seen
}

async function bootAsMember(page: Page, query: string) {
  await page.addInitScript(() => {
    localStorage.setItem('hadoku_user_type', 'member')
    localStorage.setItem('hadoku_session_id', 'member-session')
  })
  await page.goto(`/${query}`)
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
}

async function addTask(page: Page, title: string) {
  const field = page.locator('.task-app__input')
  await field.fill(title)
  await field.press('Enter')
  await expect(page.getByText(title, { exact: true })).toBeVisible()
}

test.describe('member storage', () => {
  test('an unverified member stays on this device: no task API calls, and the task survives a reload', async ({
    page
  }) => {
    const calls = taskApiCalls(page)
    await bootAsMember(page, '')
    await addTask(page, 'Kept locally')
    await page.reload()
    await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
    await expect(page.getByText('Kept locally', { exact: true })).toBeVisible()
    expect(calls.map(r => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual([])
  })

  test('a verified member syncs to the server, as a friend does', async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'local stack not running (playwright.config.ts starts it)')
    const calls = taskApiCalls(page)
    const boards = page.waitForResponse(
      r => new URL(r.url()).pathname === '/task/api/boards' && r.request().method() === 'GET'
    )
    await bootAsMember(page, '?verified=1')
    expect((await boards).ok()).toBe(true)
    expect(calls.length).toBeGreaterThan(0)
  })
})
