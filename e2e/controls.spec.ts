import { test, expect, type Page, type Locator } from '@playwright/test'
import { Buffer } from 'node:buffer'

/**
 * The themed controls in @wolffm/task-ui-components — scrollbars, <Select>,
 * <Tooltip> — measured on the real components in the controls gallery.
 *
 * Each check is something a build or typecheck cannot see:
 *
 *   1. a scroller paints its thumb in the accent of the theme it SITS in, even
 *      when the `hdk-scroll` root is outside that theme scope (a custom
 *      property inherits its resolved value, which is the bug this pins)
 *   2. <Select> works from the keyboard and its list escapes a clipped box
 *   3. popups portal into the anchor's own theme scope
 *   4. <Tooltip> adds no wrapper element — the child keeps its parent, so
 *      `:last-child` / `+` selectors aimed at it still match
 *   5. a tooltip shows on a DISABLED button (the share panel's "pick a name
 *      first" hint exists only in that state)
 */

const GALLERY = '/dev/gallery/controls.html'

// Headless Chromium hides scrollbars by default, which would make (1) vacuous.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

async function open(page: Page) {
  await page.goto(GALLERY)
  await page.waitForSelector('[data-testid="compare"] .controls__scroll-box')
}

/** The rgb() a CSS colour expression resolves to inside `scope`. */
function resolveColor(scope: Locator, expr: string) {
  return scope.evaluate((node, value) => {
    const probe = document.createElement('span')
    probe.style.color = value
    node.append(probe)
    const rgb = getComputedStyle(probe).color
    probe.remove()
    return rgb
  }, expr)
}

/** Pixel [r,g,b] at (x,y) of an element screenshot, decoded by the browser. */
async function pixelAt(page: Page, shot: Buffer, x: number, y: number) {
  return page.evaluate(
    async ({ b64, x, y }) => {
      const img = document.createElement('img')
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.drawImage(img, 0, 0)
      return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3))
    },
    { b64: shot.toString('base64'), x, y }
  )
}

const rgbOf = (s: string) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number)

test.describe('themed scrollbars', () => {
  test('each nested theme scope scrolls in its own accent', async ({ page }) => {
    await open(page)
    const cells = page.locator('[data-testid="compare"] .controls__compare-cell')
    const n = await cells.count()
    expect(n).toBeGreaterThanOrEqual(4)

    const seen = new Set<string>()
    for (let i = 0; i < n; i++) {
      const cell = cells.nth(i)
      const box = cell.locator('.controls__scroll-box')
      const primary = await resolveColor(cell, 'var(--color-primary)')
      // The box's own custom property resolves against THIS cell's tokens.
      expect(await resolveColor(box, 'var(--hdk-scrollbar-thumb)')).toBe(primary)
      seen.add(primary)

      // And that is what paints: sample the vertical thumb, which sits at the
      // top of a 10px gutter on the right edge, inset 2px.
      const shot = await box.screenshot()
      const { width } = (await box.boundingBox()) ?? { width: 0 }
      const px = await pixelAt(page, shot, Math.round(width) - 1 - 5, 20)
      const want = rgbOf(primary)
      for (let c = 0; c < 3; c++) expect(Math.abs(px[c] - want[c])).toBeLessThanOrEqual(6)
    }
    // Not vacuous: the cells really are different themes with different accents.
    expect(seen.size).toBeGreaterThan(1)
  })
})

test.describe('<Select>', () => {
  test('opens, moves and chooses from the keyboard', async ({ page }) => {
    await open(page)
    const trigger = page.locator('.controls__select-grid .hdk-select__trigger').first()
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    const list = page.getByRole('listbox')
    await expect(list).toBeVisible()
    await expect(list).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(list).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveText('Done')

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
  })

  test('the list escapes an overflow: hidden box and opens in its theme scope', async ({
    page
  }) => {
    await open(page)
    const clip = page.locator('.controls__clip')
    await clip.locator('.hdk-select__trigger').click()
    const list = page.getByRole('listbox')
    await expect(list).toBeVisible()
    const listBox = await list.boundingBox()
    const clipBox = await clip.boundingBox()
    // Taller than the clip box can show — so it is not being clipped by it.
    expect(listBox?.height ?? 0).toBeGreaterThan(clipBox?.height ?? 0)
    expect(await list.evaluate(n => n.closest('[data-theme]')?.className)).toContain(
      'task-app-container'
    )
  })

  test('a select inside a nested theme opens its list in that theme', async ({ page }) => {
    await open(page)
    const cell = page.locator('[data-testid="compare"] .controls__compare-cell').nth(1)
    const theme = await cell.getAttribute('data-theme')
    await cell.locator('.hdk-select__trigger').click()
    const list = page.getByRole('listbox')
    await expect(list).toBeVisible()
    expect(await list.evaluate(n => n.closest('[data-theme]')?.getAttribute('data-theme'))).toBe(
      theme
    )
  })
})

test.describe('<Tooltip>', () => {
  test('a card tooltip on hover, with no wrapper around the anchor', async ({ page }) => {
    await open(page)
    const btn = page.locator('.controls__toolbar').getByRole('button', { name: 'Notes' })
    // No wrapper: the button is still a direct child of the toolbar.
    expect(await btn.evaluate(n => n.parentElement?.className)).toBe('controls__toolbar')

    await btn.hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toHaveText('Notes')
    await expect(tip).toHaveClass(/hdk-tooltip--card/)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)

    // A press dismisses it too, like a native title — the click usually opens
    // something the bubble would otherwise cover.
    await page.mouse.move(0, 0)
    await btn.hover()
    await expect(page.getByRole('tooltip')).toHaveText('Notes')
    await page.mouse.down()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await page.mouse.up()
  })

  test('shows on keyboard focus, not on a mouse click', async ({ page }) => {
    await open(page)
    const btn = page.locator('.controls__toolbar').getByRole('button', { name: 'Edit tags' })
    await btn.click()
    await page.mouse.move(0, 0)
    await expect(page.getByRole('tooltip')).toHaveCount(0)

    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(btn).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveText('Edit tags')
  })

  test('shows on a disabled button', async ({ page }) => {
    await open(page)
    const btn = page.locator('button.hdk-btn', { hasText: /^Disabled$/ })
    await expect(btn).toBeDisabled()
    await btn.hover({ force: true })
    await expect(page.getByRole('tooltip')).toHaveText('Nothing to save yet')
  })

  test('opens inside the nested theme it was hovered in', async ({ page }) => {
    await open(page)
    const cell = page.locator('[data-testid="compare"] .controls__compare-cell').nth(1)
    const theme = await cell.getAttribute('data-theme')
    await cell.getByRole('button', { name: 'Info' }).hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toBeVisible()
    expect(await tip.evaluate(n => n.closest('[data-theme]')?.getAttribute('data-theme'))).toBe(
      theme
    )
  })
})
