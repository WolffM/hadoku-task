import { test, expect, type Page, type Locator } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { THEMES } from '../themes/dist/index.js'

/**
 * The AppHeader bar's icon buttons are ONE class, and the bar fits at 320px.
 *
 * hadoku_site's request (docs/requests/HADOKU_TASK_HEADER_ICON_BUTTONS.md) is
 * the groundwork for an app adding a link icon — cardtable's Discord — beside
 * the theme picker and the gear. Its "Done when" list, measured on the real
 * components in the controls gallery:
 *
 *   1. the picker trigger and the gear compute to the same box and focus ring
 *   2. an <a class="app-header__icon-btn"> paints like the gear, visited or
 *      not, in every theme
 *   3. at 320px a long title, a status and four icons do not overflow
 *
 * (2) forces :visited over CDP and compares painted pixels, with a control
 * anchor proving the forcing took effect — see the test for why each of
 * those is necessary.
 */

const GALLERY = '/dev/gallery/controls.html'

async function open(page: Page, theme = 'light') {
  await page.addInitScript(t => {
    try {
      sessionStorage.setItem('hadoku-theme', t)
    } catch {
      // Storage blocked — the theme assertion below reports it.
    }
  }, theme)
  await page.goto(GALLERY)
  await page.waitForSelector('[data-testid="header-section"] .settings-toggle-btn')
  await expect(page.locator('.task-app-container')).toHaveAttribute('data-theme', theme)
}

const BOX_PROPS = [
  'width',
  'height',
  'padding',
  'box-sizing',
  'border-radius',
  'border-style',
  'background-color',
  'color',
  'opacity',
  'display',
  'text-decoration-line',
  'cursor'
] as const

// `display` is normalised: a flex item's inline-flex is blockified to flex
// (the gear sits inside `.settings-popout`, an inline-flex wrapper; the picker
// trigger does not), and the two lay out identically.
function computed(el: Locator, props: readonly string[] = BOX_PROPS) {
  return el.evaluate(
    (node, list) => {
      // Read the settled value. The task app's base.css gives every element
      // under .task-app-container a 0.3s box-shadow transition, so a ring read
      // right after focus() is a frame of the fade-in.
      for (const a of node.getAnimations()) a.finish()
      const cs = getComputedStyle(node)
      return Object.fromEntries(
        list.map(p => {
          const v = cs.getPropertyValue(p)
          return [p, p === 'display' ? v.replace(/^inline-/, '') : v]
        })
      )
    },
    [...props]
  )
}

test.describe('AppHeader icon buttons', () => {
  test('picker trigger and gear share one box and one focus ring', async ({ page }) => {
    await open(page)
    const header = page.getByTestId('header-full')
    const picker = header.locator('.theme-toggle-btn')
    const gear = header.locator('.settings-toggle-btn')

    await expect(picker).toHaveClass(/\bapp-header__icon-btn\b/)
    await expect(gear).toHaveClass(/\bapp-header__icon-btn\b/)

    const pickerStyle = await computed(picker)
    expect(pickerStyle).toEqual(await computed(gear))
    expect(pickerStyle.width).toBe('32px')
    expect(pickerStyle.height).toBe('32px')

    // Keyboard focus: the ring appears on :focus-visible and is the same on both.
    await page.keyboard.press('Tab') // establish keyboard modality
    await picker.focus()
    expect(await picker.evaluate(n => n.matches(':focus-visible'))).toBe(true)
    const pickerRing = await computed(picker, ['box-shadow', 'opacity'])
    await gear.focus()
    const gearRing = await computed(gear, ['box-shadow', 'opacity'])
    expect(pickerRing['box-shadow']).not.toBe('none')
    expect(pickerRing).toEqual(gearRing)
  })

  test('a mouse click does not leave a focus ring', async ({ page }) => {
    await open(page)
    const gear = page.getByTestId('header-full').locator('.settings-toggle-btn')
    await gear.click()
    expect(await gear.evaluate(n => n.matches(':focus-visible'))).toBe(false)
    expect((await computed(gear, ['box-shadow']))['box-shadow']).toBe('none')
  })

  for (const theme of THEMES) {
    test(`a link icon paints like the gear, visited or not — ${theme}`, async ({ page }) => {
      await open(page, theme)
      const header = page.getByTestId('header-full')
      const gear = header.locator('.settings-toggle-btn')
      const link = header.getByRole('link', { name: 'Unvisited link', exact: true })

      // A host page's link styles — what a child app inherits from the site it
      // is mounted in. `a:visited` (0,1,1) outranks a lone class (0,1,0), and
      // the UA's own link colours lose to ANY author rule, so this — not the UA
      // stylesheet — is what the class's :link/:visited rule has to beat.
      await page.addStyleTag({
        content:
          'a:link{color:rgb(0,0,238);text-decoration:underline}' +
          'a:visited{color:rgb(85,26,139);text-decoration:underline}'
      })

      // Same computed box and colour as the gear.
      expect(await computed(link)).toEqual(await computed(gear))

      // :visited is compared in PAINTED pixels: getComputedStyle reports a
      // visited link as unvisited, by design. And the state is forced over CDP
      // rather than earned through history — headless Chromium here never
      // marks a link visited, so a "visited" href passed without testing
      // anything. A text glyph goes in the link because Chromium does not
      // carry a :visited colour into an SVG's currentColor: icon alone, the
      // comparison passes even with the :visited rule deleted (mutation-tested).
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('DOM.enable')
      await cdp.send('CSS.enable')
      const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
      const forceVisited = async (selector: string) => {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
        await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['visited'] })
      }

      await header.evaluate(node => {
        const row = node.querySelector('.app-header__actions')
        const a = row?.querySelector('a[aria-label="Unvisited link"]')
        if (!row || !a) throw new Error('no link in the actions row')
        const probe = document.createElement('span')
        probe.textContent = 'M'
        probe.style.font = '700 12px monospace'
        a.append(probe)
        // Control: a plain anchor, to prove forcing :visited changes paint at all.
        const ctl = document.createElement('a')
        ctl.id = 'ctl-plain'
        ctl.href = a.getAttribute('href') ?? ''
        ctl.textContent = 'MMMM'
        row.append(ctl)
      })
      await page.mouse.move(0, 0)

      const ctl = page.locator('#ctl-plain')
      const ctlBefore = await ctl.screenshot({ animations: 'disabled' })
      const before = await link.screenshot({ animations: 'disabled' })
      await forceVisited('#ctl-plain')
      await forceVisited('[data-testid="header-full"] a[aria-label="Unvisited link"]')
      // Settle the 0.3s colour transition base.css puts on every element.
      await page.evaluate(() => document.getAnimations().forEach(a => a.finish()))

      expect(Buffer.compare(ctlBefore, await ctl.screenshot({ animations: 'disabled' }))).not.toBe(
        0
      )
      expect(Buffer.compare(before, await link.screenshot({ animations: 'disabled' }))).toBe(0)
    })
  }
})

test.describe('AppHeader at 320px', () => {
  test('a long title, a status and four icons fit in a 320px bar', async ({ page }) => {
    await open(page)
    const frame = page.getByTestId('header-320')
    const header = frame.locator('.app-header')
    const fit = await header.evaluate(h => ({ scroll: h.scrollWidth, client: h.clientWidth }))
    expect(fit.client).toBeLessThanOrEqual(320)
    expect(fit.scroll).toBeLessThanOrEqual(fit.client)

    // Four icons (picker, gear, two links), each keeping its full 32px target.
    const icons = header.locator('.app-header__icon-btn')
    await expect(icons).toHaveCount(4)
    for (const box of await icons.evaluateAll(els => els.map(e => e.getBoundingClientRect()))) {
      expect(box.width).toBe(32)
      expect(box.height).toBe(32)
    }

    // The title is what gave way: it truncates rather than pushing the row.
    const title = header.locator('.app-header__title')
    const t = await title.evaluate(n => ({
      scroll: n.scrollWidth,
      client: n.clientWidth,
      overflow: getComputedStyle(n).textOverflow
    }))
    expect(t.overflow).toBe('ellipsis')
    expect(t.scroll).toBeGreaterThan(t.client)

    // And the last control stays inside the frame.
    const frameBox = await frame.boundingBox()
    const lastBox = await icons.last().boundingBox()
    expect(frameBox && lastBox && lastBox.x + lastBox.width).toBeLessThanOrEqual(
      (frameBox?.x ?? 0) + (frameBox?.width ?? 0)
    )
  })
})
