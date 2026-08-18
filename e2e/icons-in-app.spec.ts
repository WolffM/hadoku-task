import { test, expect, type Page } from '@playwright/test'
import { pointPrefsAtLocalStack, prefsUp } from './helpers/prefs'
import { mockShellApi } from './helpers/mock-api'

/**
 * The dogfood check: the icons this repo migrated off emoji must actually render as
 * SVG inside the running app, not just in an isolated fixture.
 *
 * A registry that passes its own tests but produces nothing once mounted — because
 * icons.css was never imported, or the glyph inherited a zero font-size, or the
 * portal scoped it away from the theme tokens — is what this catches. Every
 * assertion is measured off the live DOM.
 */

const PUBLIC_USER_TYPE = 'public'
const PUBLIC_SESSION_ID = 'public-icons-session'
const PREFS_KEY = `${PUBLIC_USER_TYPE}-${PUBLIC_SESSION_ID}-preferences`

async function setupRoutes(page: Page) {
  await mockShellApi(page)
  await pointPrefsAtLocalStack(page)
}

async function seedPublicSession(page: Page, prefs: Record<string, unknown>) {
  await page.addInitScript(
    ({ userType, sessionId, prefsKey, prefsJson }) => {
      window.localStorage.setItem('hadoku_user_type', userType)
      window.localStorage.setItem('task_anon_session_id', sessionId)
      window.localStorage.setItem(prefsKey, prefsJson)
    },
    {
      userType: PUBLIC_USER_TYPE,
      sessionId: PUBLIC_SESSION_ID,
      prefsKey: PREFS_KEY,
      prefsJson: JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), ...prefs })
    }
  )
}

/** The settings panel renders a live preview TaskItem — where the migrated icons sit. */
async function openSettings(page: Page) {
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
  await page.locator('.settings-toggle-btn').click()
  await expect(page.locator('.settings-preview-stage')).toBeVisible()
}

test.describe('migrated icons in the running app', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(
      !(await prefsUp(request)),
      'prefs stack not running (node scripts/dev-api.mjs, needs ../hadoku_site)'
    )
    await setupRoutes(page)
    await seedPublicSession(page, { theme: 'light', showNotesButton: true })
  })

  test('the notes glyph renders as a sized SVG, not emoji text', async ({ page }) => {
    await page.goto('/')
    await openSettings(page)

    const chipIcon = page.locator('.settings-toggle-chip-glyph svg.hdk-icon').first()
    await expect(chipIcon).toHaveCount(1)

    const info = await chipIcon.evaluate((el: SVGSVGElement) => {
      const box = el.getBoundingClientRect()
      return {
        w: box.width,
        h: box.height,
        shapes: el.querySelectorAll('path,circle,rect,line,polyline,polygon').length,
        stroke: getComputedStyle(el).stroke,
        hostText: (el.parentElement?.textContent ?? '').trim()
      }
    })

    // icons.css is loaded and applied: a real 1em box, not a collapsed 0x0.
    expect(info.w).toBeGreaterThan(8)
    expect(info.h).toBeGreaterThan(8)
    expect(info.shapes).toBeGreaterThan(0)
    // currentColor resolved to a real paint rather than `none`.
    expect(info.stroke).toMatch(/^rgba?\(/)
    // The emoji it replaced is gone from the DOM.
    expect(info.hostText).toBe('')
  })

  test('the icon retints across themes without any per-theme branching', async ({ page }) => {
    await page.goto('/')
    await openSettings(page)

    const read = () =>
      page
        .locator('.settings-toggle-chip-glyph svg.hdk-icon')
        .first()
        .evaluate(el => ({
          stroke: getComputedStyle(el).stroke,
          text: getComputedStyle(el.parentElement as Element).color
        }))

    const light = await read()
    expect(light.stroke).toBe(light.text)
    // light's --color-text
    expect(light.stroke).toBe('rgb(15, 23, 42)')

    // Switch on the MOUNT CONTAINER only. useTheme mirrors data-theme onto both
    // <html> and the container, but the container is the closer ancestor and also
    // what the app's own theme sync rewrites — poking <html> too makes the app
    // reassert its old theme and the switch silently no-ops.
    await page.evaluate(() =>
      document.querySelector('.task-app-container')!.setAttribute('data-theme', 'ocean-dark')
    )

    // Theme changes animate through a CSS colour transition, so the first frame
    // after the attribute flips is a blend of the two themes, not either one.
    // Poll to the settled value instead of sampling mid-transition.
    await expect
      .poll(async () => (await read()).stroke, { timeout: 5000 })
      .toBe('rgb(224, 242, 254)') // ocean-dark's --color-text

    const dark = await read()
    // The glyph inherits currentColor, so it tracks the theme's text colour with no
    // per-theme branching anywhere in the icon module.
    expect(dark.stroke).toBe(dark.text)
    expect(dark.stroke).not.toBe(light.stroke)
  })

  test('no raw emoji survives anywhere in the rendered settings UI', async ({ page }) => {
    await page.goto('/')
    await openSettings(page)

    const stray = await page.evaluate(() => {
      const EMOJI = /\p{Extended_Pictographic}/u
      const isEmoji = (s: string) =>
        EMOJI.test(s) &&
        [...s].some(c => {
          const p = c.codePointAt(0)!
          return p > 0x2100 && !(p >= 0x2190 && p <= 0x21ff)
        })
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const hits: string[] = []
      let n: Node | null
      while ((n = walker.nextNode())) {
        const t = (n.nodeValue ?? '').trim()
        if (t && isEmoji(t)) {
          const el = n.parentElement
          hits.push(`${el?.tagName.toLowerCase()}.${el?.className || '(none)'}: ${t.slice(0, 40)}`)
        }
      }
      return hits
    })

    expect(stray, `emoji still rendered as text: ${JSON.stringify(stray, null, 2)}`).toEqual([])
  })
})
