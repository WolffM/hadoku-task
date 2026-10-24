import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * What hadoku_site installs for every app over plain browser controls:
 * installSelectMenus() (the themed list for a native <select>) and
 * controls.css under <html class="hdk-controls">, plus <NumberInput>.
 *
 * The gallery's "Plain HTML controls" section is bare markup with no classes;
 * its Status select is a React-controlled <select>, so choosing from the
 * themed list must reach React's onChange like an OS pick would.
 */

const GALLERY = '/dev/gallery/controls.html'

async function open(page: Page) {
  await page.goto(GALLERY)
  await page.waitForSelector('[data-testid="native"]')
}

const native = (page: Page) => page.getByTestId('native')
const status = (page: Page) => native(page).getByLabel('Status', { exact: true })
const list = (page: Page) => page.getByRole('listbox')

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

test.describe('installSelectMenus', () => {
  test('a click opens the themed list, and a pick reaches React onChange', async ({ page }) => {
    await open(page)
    await status(page).click()
    await expect(list(page)).toBeVisible()
    await expect(list(page)).toHaveClass(/hdk-select__menu/)
    // Built from the select's own optgroups, selection and disabled state.
    await expect(list(page).locator('.hdk-select__group')).toHaveText(['Open', 'Closed'])
    await expect(list(page).getByRole('option', { name: 'Doing' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(list(page).getByRole('option', { name: 'Archived' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )

    await list(page).getByRole('option', { name: 'Done' }).click()
    await expect(list(page)).toHaveCount(0)
    await expect(status(page)).toHaveValue('done')
    await expect(native(page).getByTestId('native-status-out')).toHaveText('done · 1 change')
    await expect(status(page)).toBeFocused()
  })

  test('the keyboard opens, moves past disabled options, and chooses', async ({ page }) => {
    await open(page)
    await status(page).focus()
    await page.keyboard.press('ArrowDown')
    await expect(list(page)).toBeFocused()
    await page.keyboard.press('End')
    // Archived is last but disabled, so End lands on Done.
    await expect(list(page).locator('.hdk-select__option--active')).toHaveText('Done')
    await page.keyboard.press('Enter')
    await expect(status(page)).toHaveValue('done')

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('t')
    await expect(list(page).locator('.hdk-select__option--active')).toHaveText('To do')
    await page.keyboard.press('Escape')
    await expect(list(page)).toHaveCount(0)
    await expect(status(page)).toHaveValue('done')
    await expect(status(page)).toBeFocused()
  })

  test('picking the current value fires no change; a click outside closes', async ({ page }) => {
    await open(page)
    await status(page).click()
    await list(page).getByRole('option', { name: 'Doing' }).click()
    await expect(native(page).getByTestId('native-status-out')).toHaveText('doing · 0 changes')

    await status(page).click()
    await expect(list(page)).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(list(page)).toHaveCount(0)
  })

  test('the list opens in the theme of the cell its select sits in', async ({ page }) => {
    await open(page)
    const cells = page.locator('[data-testid="compare"] .controls__compare-cell')
    const seen = new Set<string>()
    for (let i = 0; i < 2; i++) {
      const cell = cells.nth(i)
      const theme = await cell.getAttribute('data-theme')
      await cell.getByLabel(/^Native select in /).click()
      const where = await list(page).evaluate(n => ({
        scope: n.closest('[data-theme]')?.getAttribute('data-theme'),
        bg: getComputedStyle(n).backgroundColor
      }))
      expect(where.scope).toBe(theme)
      expect(where.bg).toBe(await resolveColor(cell, 'var(--color-bg-card)'))
      seen.add(where.bg)
      await page.keyboard.press('Escape')
    }
    expect(seen.size).toBe(2)
  })

  test('data-native-select keeps the OS list', async ({ page }) => {
    await open(page)
    await native(page).getByLabel('Native list').click()
    await page.waitForTimeout(300)
    await expect(list(page)).toHaveCount(0)
  })

  test.describe('on touch', () => {
    test.use({ hasTouch: true })
    test('a tap leaves the phone’s own picker alone', async ({ page }) => {
      await open(page)
      await status(page).scrollIntoViewIfNeeded()
      await status(page).tap()
      await page.waitForTimeout(300)
      await expect(list(page)).toHaveCount(0)
    })
  })
})

test.describe('controls.css', () => {
  test('a bare button gets the accent focus ring, not the browser’s', async ({ page }) => {
    await open(page)
    const btn = native(page).getByRole('button', { name: 'Bare button' })
    await native(page).getByLabel('File').focus()
    await page.keyboard.press('Tab')
    await expect(btn).toBeFocused()
    const ring = await btn.evaluate(n => {
      const s = getComputedStyle(n)
      return { style: s.outlineStyle, color: s.outlineColor }
    })
    expect(ring.style).toBe('solid')
    expect(ring.color).toBe(await resolveColor(native(page), 'var(--color-primary)'))
  })

  test('an app’s own rule wins, even one inside a Tailwind-style layer', async ({ page }) => {
    await open(page)
    const btn = native(page).getByRole('button', { name: 'Bare button' })
    // Declared after hdk-fallbacks, as every app's sheets are; unlayered, the
    // fallback would beat this whatever its specificity.
    await page.addStyleTag({
      content: '@layer utilities { .app-fill { background-color: rgb(1, 2, 3); } }'
    })
    await btn.evaluate(n => n.classList.add('app-fill'))
    // Polled: the task container eases every background change over 0.3s.
    await expect
      .poll(() => btn.evaluate(n => getComputedStyle(n).backgroundColor))
      .toBe('rgb(1, 2, 3)')
  })

  test('the plain controls take the theme instead of the browser defaults', async ({ page }) => {
    await open(page)
    const n = native(page)
    const primary = await resolveColor(n, 'var(--color-primary)')

    // A link with no colour of its own reads as the text around it, not #0000ee.
    // Outside .task-app-container, whose base.css colours its own links — the
    // gallery's link would pass without the fallback at all.
    const loose = await page.evaluate(() => {
      const a = document.createElement('a')
      a.href = '#loose'
      a.textContent = 'loose link'
      document.body.append(a)
      return { link: getComputedStyle(a).color, around: getComputedStyle(document.body).color }
    })
    expect(loose.link).toBe(loose.around)
    expect(loose.link).not.toBe('rgb(0, 0, 238)')
    expect(await n.getByRole('checkbox').evaluate(el => getComputedStyle(el).accentColor)).toBe(
      primary
    )
    expect(await n.getByLabel('Bare number').evaluate(el => getComputedStyle(el).appearance)).toBe(
      'textfield'
    )
    expect(
      await n
        .getByLabel('File')
        .evaluate(el => getComputedStyle(el, '::file-selector-button').backgroundColor)
    ).toBe(await resolveColor(n, 'var(--color-neutral-bg)'))
    expect(await n.getByLabel('Text').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(
      await resolveColor(n, 'var(--color-bg-card)')
    )
  })

  test('accent-color resolves per nested theme scope', async ({ page }) => {
    await open(page)
    const cells = page.locator('[data-testid="compare"] .controls__compare-cell')
    const a = cells.nth(0)
    const b = cells.nth(1)
    const accentOf = (l: Locator) => l.evaluate(el => getComputedStyle(el).accentColor)
    expect(await accentOf(a)).toBe(await resolveColor(a, 'var(--color-primary)'))
    expect(await accentOf(b)).toBe(await resolveColor(b, 'var(--color-primary)'))
    expect(await accentOf(a)).not.toBe(await accentOf(b))
  })
})

test.describe('<NumberInput>', () => {
  const qty = (page: Page) => native(page).getByLabel('Quantity')
  const out = (page: Page) => native(page).getByTestId('qty-out')

  test('the stepper steps a controlled value and stops at max', async ({ page }) => {
    await open(page)
    const up = native(page).getByRole('button', { name: 'Increase' })
    await up.click()
    await expect(out(page)).toHaveText('4')
    await expect(qty(page)).toHaveValue('4')
    await up.click()
    await expect(out(page)).toHaveText('5')
    await expect(up).toBeDisabled()
    // The field keeps focus, as with the native spinner, and arrows still step.
    await expect(qty(page)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(out(page)).toHaveText('4')
  })

  test('holding a button repeats', async ({ page }) => {
    await open(page)
    await qty(page).fill('0')
    await expect(out(page)).toHaveText('0')
    const up = native(page).getByRole('button', { name: 'Increase' })
    const box = await up.boundingBox()
    if (!box) throw new Error('no box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(800)
    await page.mouse.up()
    // One press steps once; only the repeat gets from 0 to the max of 5.
    await expect(out(page)).toHaveText('5')
  })
})
