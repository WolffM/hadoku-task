import { test, expect, type Page } from '@playwright/test'
import { apiUp } from './helpers/stack'

/**
 * The hosted theme editor (hadoku.me/task/editor), driven end to end against
 * the REAL worker on the dev stack.
 *
 * Saves go to the dev stack's in-memory GitHub (worker/test/lib/fake-github.ts),
 * never the real repo — the dev server pins the editor's git traffic there even
 * when the real PAT is bound. What a save "committed" is read back from
 * :3001/__dev/github, so these specs assert on the commit itself, not on a
 * banner claiming one happened.
 */

const DEV = `http://127.0.0.1:${process.env.DEV_API_PORT ?? 3001}/__dev/github`

interface DevRepo {
  main: string
  parent: string | null
  message: string
  files: Record<string, string>
}

/** The value a token has in one theme block of a style.css text. */
function tokenIn(css: string, theme: string, token: string): string | undefined {
  const selector = theme === 'light' ? ":root,\r\n[data-theme='light']" : `[data-theme='${theme}']`
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return undefined
  const body = css.slice(start, css.indexOf('}', start))
  return body.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim()
}

async function openEditor(page: Page, query = '') {
  await page.goto(`/editor.html${query}`)
  await expect(page.getByText(/main @ [0-9a-f]{7}/)).toBeVisible({ timeout: 15_000 })
}

/** Expand a token row by its short name (`border`, `text`, `success-bg`...). */
async function openToken(page: Page, group: string, name: string) {
  const row = page
    .locator('.te-group')
    .filter({ has: page.locator('.te-group__head', { hasText: group }) })
    .locator('.te-token__head')
    .filter({ has: page.locator('.te-token__name', { hasText: new RegExp(`^${name}$`) }) })
  await row.click()
  return row.locator('xpath=..')
}

test.describe('Theme editor', () => {
  // One in-memory repo per dev stack: a parallel save or reset would land
  // between another test's before/after reads of it.
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await apiUp(request)), 'needs the dev stack: pnpm run dev:api')
    await request.post(`${DEV}/reset`)
    // The editor must never raise a native dialog (AGENTS.md "Dialogs").
    page.on('dialog', d => {
      throw new Error(`native ${d.type()} dialog raised: ${d.message()}`)
    })
  })

  test('loads main, and a slider recolours the real components live', async ({ page, request }) => {
    const repo = (await (await request.get(DEV)).json()) as DevRepo
    await openEditor(page)
    await expect(page.getByText(`main @ ${repo.main.slice(0, 7)}`)).toBeVisible()
    await expect(page.getByText('Sun passes the contract')).toBeVisible()

    // The preview is the app's real components, not a mock-up.
    const preview = page.locator('.te-preview')
    await expect(preview.locator('.task-app__input')).toBeVisible()
    await expect(preview.getByText('Fix login bug')).toBeVisible()

    const input = preview.locator('.task-app__input')
    const before = await input.evaluate(el => getComputedStyle(el).borderTopColor)

    const token = await openToken(page, 'Surfaces', 'border')
    const brightness = token.getByRole('slider', { name: 'Brightness' })
    await brightness.focus()
    for (let i = 0; i < 20; i++) await brightness.press('ArrowLeft')

    const after = await input.evaluate(el => getComputedStyle(el).borderTopColor)
    expect(after, 'the input border follows the slider').not.toBe(before)
    const shown = await token.locator('.te-token__value').innerText()
    expect(await preview.evaluate(el => el.style.getPropertyValue('--color-border'))).toBe(shown)
    await expect(page.getByRole('button', { name: /^Save 1$/ })).toBeEnabled()
  })

  test('Save commits the edit to main under new versions', async ({ page, request }) => {
    const before = (await (await request.get(DEV)).json()) as DevRepo
    await openEditor(page)

    const token = await openToken(page, 'Surfaces', 'border')
    const value = token.getByRole('textbox', { name: 'Colour value' })
    await value.fill('#B8C2CF')
    await value.press('Enter')
    await page.getByRole('textbox', { name: 'Commit note' }).fill('Visible borders on Sun')

    await page.getByRole('button', { name: /^Save 1$/ }).click()
    await expect(page.getByRole('status')).toContainText('Committed 1 token to main')

    const after = (await (await request.get(DEV)).json()) as DevRepo
    expect(after.parent, 'committed on top of the head it loaded').toBe(before.main)
    expect(tokenIn(after.files['themes/src/style.css'], 'light', '--color-border')).toBe('#b8c2cf')
    expect(after.files['themes/src/style.css']).toContain('\r\n')
    expect(after.message).toMatch(/^style\(themes\): theme editor — light \(1 token\)/)
    expect(after.message).toContain('Visible borders on Sun')

    const v = (f: string, files: Record<string, string>) =>
      (JSON.parse(files[f]) as { version: string }).version
    for (const f of ['themes/package.json', 'task-ui-components/package.json', 'package.json']) {
      expect(v(f, after.files), f).not.toBe(v(f, before.files))
    }
    await expect(page.getByRole('status')).toContainText(
      `@wolffm/themes ${v('themes/package.json', after.files)}`
    )

    // The editor reloads from the new head: nothing pending, new commit shown.
    await expect(page.getByText(`main @ ${after.main.slice(0, 7)}`)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Save$/ })).toBeDisabled()
  })

  test('a contract failure blocks Save and says why', async ({ page, request }) => {
    const before = (await (await request.get(DEV)).json()) as DevRepo
    await openEditor(page)

    const token = await openToken(page, 'Text', 'text')
    const value = token.getByRole('textbox', { name: 'Colour value' })
    await value.fill('#eeeeee')
    await value.press('Enter')

    await expect(page.getByText(/contract failure.*Save is blocked/)).toBeVisible()
    await expect(page.locator('.te-gate__list')).toContainText('text on bg is')
    const save = page.getByRole('button', { name: /^Save 1$/ })
    await expect(save).toBeDisabled()
    await save.click({ force: true })

    const after = (await (await request.get(DEV)).json()) as DevRepo
    expect(after.main, 'nothing was committed').toBe(before.main)
  })

  test('a group slider moves every token in the group, and drafts survive a reload', async ({
    page
  }) => {
    await openEditor(page, '?theme=ocean-light')
    await page.locator('.te-group__head', { hasText: 'Surfaces' }).click()
    const groupBrightness = page
      .locator('.te-group__sliders')
      .getByRole('slider', { name: 'Brightness' })
    await groupBrightness.focus()
    for (let i = 0; i < 6; i++) await groupBrightness.press('ArrowLeft')

    const changed = page.locator('.te-theme-actions span')
    await expect(changed).toContainText('changes in Ocean Light')
    const count = Number((await changed.innerText()).match(/^(\d+)/)?.[1])
    expect(count, 'every surface token moved, not just one').toBeGreaterThanOrEqual(5)
    const saveLabel = await page.locator('.te-btn--primary').innerText()

    await page.reload()
    await expect(page.getByText(/main @ [0-9a-f]{7}/)).toBeVisible()
    await page.getByRole('combobox', { name: 'Theme' }).selectOption('ocean-light')
    await expect(page.locator('.te-btn--primary')).toHaveText(saveLabel)

    await page.getByRole('button', { name: /Discard all/ }).click()
    await expect(page.getByRole('button', { name: /^Save$/ })).toBeDisabled()
  })

  test('below service tier the API refuses, and the editor says so', async ({ page }) => {
    await page.goto('/editor.html?tier=friend')
    await expect(page.getByRole('alert')).toContainText('Service tier required')
  })
})
