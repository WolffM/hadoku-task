import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEMES } from '../themes/dist/index.js'
import {
  getIconSvg,
  ICON_NAMES,
  ICON_FAMILIES,
  getIconTileClass
} from '../themes/dist/icons/index.js'

/**
 * Runtime verification of the icon module, in a real browser.
 *
 * Building and typechecking prove nothing about whether a glyph actually PAINTS or
 * whether its colour survives 18 themes, so everything here is measured off live
 * layout and computed style:
 *
 *   1. every icon in the registry draws real geometry (non-zero painted bbox)
 *   2. a bare icon inherits currentColor, so it is exactly as legible as its text
 *   3. tint and filled tiles resolve to the intended token pair in all 18 themes
 *   4. the tile treatments clear WCAG 1.4.11's 3:1 non-text minimum in all 18
 *      themes for all 5 families — computed from what the browser actually painted,
 *      not from parsing the stylesheet
 */

const here = dirname(fileURLToPath(import.meta.url))
const styleCss = readFileSync(resolve(here, '../themes/src/style.css'), 'utf8')
const iconsCss = readFileSync(resolve(here, '../themes/src/icons.css'), 'utf8')

async function mount(page: Page, body: string) {
  await page.setContent(
    `<!doctype html><html><head><style>${styleCss}</style><style>${iconsCss}</style>` +
      `<style>body{margin:0;padding:20px;background:var(--color-bg);color:var(--color-text);` +
      `font-family:var(--font-family);font-size:16px}</style></head><body>${body}</body></html>`
  )
}

/** sRGB relative luminance + contrast, per WCAG 2.x, from computed rgb() strings. */
const CONTRAST_HELPERS = `
  function toRgb(s){const m=s.match(/[\\d.]+/g).map(Number);return [m[0],m[1],m[2],m[3]===undefined?1:m[3]]}
  function over(fg,bg){const a=fg[3];return [0,1,2].map(i=>fg[i]*a+bg[i]*(1-a))}
  function lum(c){const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
    return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])}
  function ratio(a,b){const L=lum(a),M=lum(b);return (Math.max(L,M)+0.05)/(Math.min(L,M)+0.05)}
`

test.describe('icon registry', () => {
  test('every icon paints real geometry', async ({ page }) => {
    await mount(
      page,
      ICON_NAMES.map(
        n => `<span data-icon="${n}" style="font-size:48px">${getIconSvg(n)}</span>`
      ).join('')
    )

    const result = await page.evaluate(() => {
      const bad: { name: string; reason: string }[] = []
      for (const host of Array.from(document.querySelectorAll('[data-icon]'))) {
        const name = host.getAttribute('data-icon')!
        const svg = host.querySelector('svg')
        if (!svg) {
          bad.push({ name, reason: 'no <svg> rendered' })
          continue
        }
        const shapes = svg.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse')
        if (shapes.length === 0) {
          bad.push({ name, reason: 'svg has no drawable children' })
          continue
        }
        // The union of what was actually laid out. A glyph whose paths failed to parse
        // still yields an <svg> box, so measure the CHILDREN, not the svg.
        let painted = 0
        for (const s of Array.from(shapes)) {
          const b = (s as SVGGraphicsElement).getBBox()
          if (b.width > 0 || b.height > 0) painted++
        }
        if (painted === 0) bad.push({ name, reason: 'all shapes have empty bbox' })
        const box = svg.getBoundingClientRect()
        if (box.width < 40 || box.height < 40) {
          bad.push({ name, reason: `svg laid out at ${box.width}x${box.height}, expected ~48` })
        }
      }
      return { bad, total: document.querySelectorAll('[data-icon]').length }
    })

    expect(result.total).toBe(ICON_NAMES.length)
    expect(
      result.bad,
      `icons that failed to paint: ${JSON.stringify(result.bad, null, 2)}`
    ).toEqual([])
  })

  test('a bare icon inherits currentColor from its text context', async ({ page }) => {
    await mount(
      page,
      `<div id="ctx" style="color:rgb(255,0,0)">${getIconSvg('check')}</div>` +
        `<div id="ctx2">${getIconSvg('check')}</div>`
    )

    const { forced, inherited, bodyText } = await page.evaluate(() => ({
      forced: getComputedStyle(document.querySelector('#ctx svg')!).stroke,
      inherited: getComputedStyle(document.querySelector('#ctx2 svg')!).stroke,
      bodyText: getComputedStyle(document.body).color
    }))

    // stroke="currentColor" must resolve to the inherited colour, not a baked value.
    expect(forced).toBe('rgb(255, 0, 0)')
    expect(inherited).toBe(bodyText)
  })

  test('sizing is em-relative so icons scale with their text', async ({ page }) => {
    await mount(
      page,
      `<div style="font-size:12px">${getIconSvg('star')}</div>` +
        `<div style="font-size:32px">${getIconSvg('star')}</div>`
    )
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('svg')).map(s => s.getBoundingClientRect().width)
    )
    expect(sizes[0]).toBeCloseTo(12, 0)
    expect(sizes[1]).toBeCloseTo(32, 0)
  })
})

test.describe('consumer-controlled colouring', () => {
  test('variant="accent" paints the glyph from the family token, in every theme', async ({
    page
  }) => {
    const cells = THEMES.flatMap(theme =>
      ICON_FAMILIES.map(
        family =>
          `<div data-theme="${theme}" style="background:var(--color-bg-card)">` +
          `<span data-accent="${theme}|${family}" style="font-size:24px">` +
          `${getIconSvg('warning', { family })}</span>` +
          `<span data-token="${theme}|${family}" ` +
          `style="color:var(--color-${family});display:none"></span></div>`
      )
    ).join('')
    await mount(page, cells)

    const mismatches = await page.evaluate(() => {
      const bad: string[] = []
      for (const host of Array.from(document.querySelectorAll('[data-accent]'))) {
        const key = host.getAttribute('data-accent')!
        const stroke = getComputedStyle(host.querySelector('svg')!).stroke
        // The token's own computed value, read off a sibling — so this asserts the
        // glyph resolves to the TOKEN, not to some colour that merely looks right.
        const ref = document.querySelector(`[data-token="${key}"]`)!
        const expected = getComputedStyle(ref).color
        if (stroke !== expected) bad.push(`${key}: ${stroke} != ${expected}`)
      }
      return bad
    })
    expect(
      mismatches,
      `accent glyphs not matching their token: ${JSON.stringify(mismatches, null, 2)}`
    ).toEqual([])
  })

  test('a bare icon still inherits, so it matches the text it sits in', async ({ page }) => {
    // The two consumer stories side by side: inline in a button (inherit) and as
    // its own element (accent). Both must resolve through tokens.
    await mount(
      page,
      `<button id="btn" style="color:var(--color-on-primary);background:var(--color-primary)">` +
        `${getIconSvg('check')} Save</button>` +
        `<span id="own">${getIconSvg('warning', { family: 'danger' })}</span>` +
        `<span id="ref" style="color:var(--color-danger)"></span>`
    )
    const r = await page.evaluate(() => ({
      inButton: getComputedStyle(document.querySelector('#btn svg')!).stroke,
      buttonText: getComputedStyle(document.querySelector('#btn')!).color,
      own: getComputedStyle(document.querySelector('#own svg')!).stroke,
      danger: getComputedStyle(document.querySelector('#ref')!).color
    }))
    expect(r.inButton).toBe(r.buttonText)
    expect(r.own).toBe(r.danger)
    expect(r.own).not.toBe(r.inButton)
  })
})

test.describe('accent tiles across all 18 themes', () => {
  const variants = ['tint', 'filled'] as const

  test('tile treatments clear 3:1 non-text contrast in every theme and family', async ({
    page
  }) => {
    const cells = THEMES.flatMap(theme =>
      variants.flatMap(variant =>
        ICON_FAMILIES.map(
          family =>
            `<div data-theme="${theme}" style="background:var(--color-bg-card);padding:8px">` +
            `<span data-cell="${theme}|${variant}|${family}" ` +
            `class="${getIconTileClass(family, variant)}" style="font-size:24px">` +
            `${getIconSvg('warning')}</span></div>`
        )
      )
    ).join('')

    await mount(page, cells)

    const failures = await page.evaluate(`(() => {
      ${CONTRAST_HELPERS}
      const out = []
      for (const el of Array.from(document.querySelectorAll('[data-cell]'))) {
        const svg = el.querySelector('svg')
        const tileBg = toRgb(getComputedStyle(el).backgroundColor)
        const surface = toRgb(getComputedStyle(el.parentElement).backgroundColor)
        const ink = toRgb(getComputedStyle(svg).stroke)
        // The -bg tokens are translucent, so flatten the tile over its real surface
        // before measuring — the same thing check-contrast.mjs does.
        const bg = over(tileBg, surface)
        const fg = over(ink, bg)
        const r = ratio(fg, bg)
        if (r < 3) out.push({ cell: el.getAttribute('data-cell'), ratio: Math.round(r*100)/100 })
      }
      return out
    })()`)

    const expected = THEMES.length * variants.length * ICON_FAMILIES.length
    const counted = await page.locator('[data-cell]').count()
    expect(counted).toBe(expected)
    expect(
      failures,
      `tile treatments below 3:1 (WCAG 1.4.11): ${JSON.stringify(failures, null, 2)}`
    ).toEqual([])
  })

  test('a bare accent glyph would fail — the regression this design avoids', async ({ page }) => {
    // Guards the decision recorded in icons.css: if someone "simplifies" the tile away
    // and paints the glyph with --color-warning, this test documents what breaks.
    await mount(
      page,
      THEMES.map(
        theme =>
          `<div data-theme="${theme}" style="background:var(--color-bg-card)">` +
          `<span data-bare="${theme}" style="color:var(--color-warning);font-size:24px">` +
          `${getIconSvg('warning')}</span></div>`
      ).join('')
    )

    const failing = await page.evaluate(`(() => {
      ${CONTRAST_HELPERS}
      const out = []
      for (const el of Array.from(document.querySelectorAll('[data-bare]'))) {
        const ink = toRgb(getComputedStyle(el.querySelector('svg')).stroke)
        const surface = toRgb(getComputedStyle(el.parentElement).backgroundColor)
        const r = ratio(over(ink, surface), surface)
        if (r < 3) out.push(el.getAttribute('data-bare'))
      }
      return out
    })()`)

    // Not an aspiration — a measured fact that justifies the tile. If this ever comes
    // back empty, the palette changed and the bare-accent option deserves a re-look.
    expect(failing.length).toBeGreaterThan(0)
  })
})
