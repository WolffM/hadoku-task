import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * installTitleTooltips(): plain `title=` markup shown as the card tooltip,
 * with no component. hadoku_site installs it once in the shell, so this is
 * what every app's titles look like — and it touches every app's DOM, which is
 * why most of these checks are about leaving that DOM as the app rendered it.
 *
 * The gallery installs it; the samples are its "Plain title=" row and one
 * `title=` button in each themed compare cell.
 */

const GALLERY = '/dev/gallery/controls.html'

async function open(page: Page) {
  await page.goto(GALLERY)
  await page.waitForSelector('[data-testid="plain-titles"]')
}

const row = (page: Page) => page.getByTestId('plain-titles')
const tip = (page: Page) => page.getByRole('tooltip')

async function boxOf(l: Locator) {
  const b = await l.boundingBox()
  if (!b) throw new Error('element has no box')
  return b
}

async function attr(l: Locator, name: string) {
  const v = await l.getAttribute(name)
  if (v === null) throw new Error(`missing ${name}`)
  return v
}

test('hover shows a card bubble and the title is handed back afterwards', async ({ page }) => {
  await open(page)
  const btn = row(page).getByRole('button', { name: 'Hover me (title=)' })
  await btn.hover()
  await expect(tip(page)).toHaveText('Upgraded from a title attribute')
  await expect(tip(page)).toHaveClass(/hdk-tooltip--card/)
  // Lent to the bubble while it is up, so the browser cannot draw its own.
  await expect(btn).not.toHaveAttribute('title')
  await expect(btn).toHaveAttribute('aria-describedby', 'hdk-title-tooltip')

  await page.mouse.move(0, 0)
  await expect(tip(page)).toHaveCount(0)
  await expect(btn).toHaveAttribute('title', 'Upgraded from a title attribute')
  await expect(btn).not.toHaveAttribute('data-hdk-title')
  await expect(btn).not.toHaveAttribute('aria-describedby')
})

test('keyboard focus shows it at once; Escape dismisses it', async ({ page }) => {
  await open(page)
  const btn = row(page).getByRole('button', { name: 'Line break' })
  await row(page).getByRole('button', { name: 'Hover me (title=)' }).focus()
  await page.keyboard.press('Tab')
  await expect(btn).toBeFocused()
  // A title's line break is kept, as the native tooltip keeps it.
  expect(await tip(page).innerText()).toBe('Two lines\nfrom one title')
  await page.keyboard.press('Escape')
  await expect(tip(page)).toHaveCount(0)
  await expect(btn).toHaveAttribute('title', 'Two lines\nfrom one title')
})

test('Escape keeps it closed until the pointer leaves, then it works again', async ({ page }) => {
  await open(page)
  // The icon inside matters: moving onto it fires a fresh pointerover for the
  // same titled button, which is exactly what must not reopen it.
  const btn = row(page).getByRole('button', { name: 'Delete' })
  await btn.scrollIntoViewIfNeeded()
  const box = await boxOf(btn)
  // Left padding at mid-height: a pill's corner is outside its hit area.
  await page.mouse.move(box.x + 3, box.y + box.height / 2)
  await expect(tip(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tip(page)).toHaveCount(0)
  await btn.locator('svg').hover()
  await page.waitForTimeout(600)
  await expect(tip(page)).toHaveCount(0)

  await page.mouse.move(0, 0)
  await btn.hover()
  await expect(tip(page)).toHaveText('Delete')
})

test('a press closes it', async ({ page }) => {
  await open(page)
  const btn = row(page).getByRole('button', { name: 'Hover me (title=)' })
  await btn.hover()
  await expect(tip(page)).toBeVisible()
  await page.mouse.down()
  await expect(tip(page)).toHaveCount(0)
  await page.mouse.up()
  await expect(btn).toHaveAttribute('title', 'Upgraded from a title attribute')
})

test('the pointer can move onto the bubble without it closing', async ({ page }) => {
  await open(page)
  await row(page).getByRole('button', { name: 'Hover me (title=)' }).hover()
  const bubble = tip(page)
  await expect(bubble).toBeVisible()
  await bubble.hover()
  await page.waitForTimeout(400)
  await expect(bubble).toBeVisible()
})

test('a title that only repeats the aria-label is not announced twice', async ({ page }) => {
  await open(page)
  const btn = row(page).getByRole('button', { name: 'Delete' })
  await btn.hover()
  await expect(tip(page)).toHaveText('Delete')
  await expect(btn).not.toHaveAttribute('aria-describedby')
})

test('shows on a disabled button', async ({ page }) => {
  await open(page)
  const btn = row(page).getByRole('button', { name: 'Disabled' })
  await btn.hover({ force: true })
  await expect(tip(page)).toHaveText('Disabled, still explained')
})

test('data-native-title opts a subtree out', async ({ page }) => {
  await open(page)
  const btn = row(page).getByRole('button', { name: 'Opted out' })
  await btn.hover()
  await page.waitForTimeout(600)
  await expect(tip(page)).toHaveCount(0)
  await expect(btn).toHaveAttribute('title', 'Browser-drawn on purpose')
})

test('a title the app changes mid-hover updates the bubble', async ({ page }) => {
  await open(page)
  const btn = row(page).getByRole('button', { name: 'Hover me (title=)' })
  await btn.hover()
  await expect(tip(page)).toHaveText('Upgraded from a title attribute')
  // What a framework re-render does: set the attribute again.
  await btn.evaluate(n => n.setAttribute('title', 'Changed while open'))
  await expect(tip(page)).toHaveText('Changed while open')
  await expect(btn).not.toHaveAttribute('title')
  await page.mouse.move(0, 0)
  await expect(btn).toHaveAttribute('title', 'Changed while open')
})

test('the bubble opens in the theme of the cell it was hovered in', async ({ page }) => {
  await open(page)
  const cells = page.locator('[data-testid="compare"] .controls__compare-cell')
  const seen = new Set<string>()
  for (let i = 0; i < 2; i++) {
    const cell = cells.nth(i)
    const theme = await attr(cell, 'data-theme')
    await page.mouse.move(0, 0)
    await cell.getByRole('button', { name: 'title=', exact: true }).hover()
    await expect(tip(page)).toHaveText(`title= in ${theme}`)
    const where = await tip(page).evaluate(n => ({
      scope: n.closest('[data-theme]')?.getAttribute('data-theme'),
      bg: getComputedStyle(n).backgroundColor
    }))
    expect(where.scope).toBe(theme)
    const card = await cell.evaluate(n => {
      const p = document.createElement('i')
      p.style.color = 'var(--color-bg-card)'
      n.append(p)
      const c = getComputedStyle(p).color
      p.remove()
      return c
    })
    expect(where.bg).toBe(card)
    seen.add(where.bg)
  }
  expect(seen.size).toBe(2)
})

test('nested titles: the nearest wins, including over the anchor’s own children', async ({
  page
}) => {
  await open(page)
  await page.evaluate(() => {
    const outer = document.createElement('div')
    outer.setAttribute('title', 'outer card')
    outer.setAttribute('data-testid', 'outer')
    outer.style.cssText = 'position:fixed;left:40px;top:200px;padding:30px;z-index:5'
    outer.innerHTML =
      '<button type="button" title="inner button" style="padding:12px"><span data-testid="inner-label">label</span></button>'
    document.querySelector('.task-app-container')?.append(outer)
  })
  const inner = page.getByRole('button', { name: 'label' })
  const box = await boxOf(inner)
  await page.mouse.move(box.x + 3, box.y + box.height / 2)
  await expect(tip(page)).toHaveText('inner button')
  // Onto its child: the button is still the anchor (its title is lent out
  // right now), so this must not jump to the outer card's title.
  await page.getByTestId('inner-label').hover()
  await page.waitForTimeout(500)
  await expect(tip(page)).toHaveText('inner button')

  const outer = await boxOf(page.getByTestId('outer'))
  await page.mouse.move(outer.x + 6, outer.y + 6)
  await expect(tip(page)).toHaveText('outer card')
  await expect(inner).toHaveAttribute('title', 'inner button')
})
