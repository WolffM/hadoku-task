import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { PREFS_BASE, pointPrefsAtLocalStack, prefsUp } from './helpers/prefs'
import { mockShellApi } from './helpers/mock-api'

/**
 * Avatar cosmetics in the avatar dialog (AvatarBuilder), against the REAL
 * prefs-api on the dev stack: free items and what the operator grants equip
 * and are stored, an earned item not yet earned can only be tried on, archived
 * items show to nobody, and an overlay's placement is fitted to the allowed
 * area before it is stored.
 *
 * The operator's gift goes through the real admin route, by name, with
 * `X-Dev-Tier: admin` (worker/test/prefs-dev-server.ts). The dev user is
 * shared across the run, so each test starts by taking everything off, and
 * puts back the settings tab it opens: the popout remembers its last tab in
 * the user's `portfolio` row, and later specs expect it to open on App.
 *
 * watchparty's character table is the only stub: it is another app's API.
 */

const AVATAR = `${PREFS_BASE}/api/v1/_avatar`
/** A phone: the dialog stacks, and the tab strip is narrower than its tabs. */
const NARROW = { width: 360, height: 800 }
const PORTFOLIO = `${PREFS_BASE}/api/v1/portfolio`
const CHARACTERS = {
  sets: [
    {
      id: 'fantasy',
      characters: [
        {
          id: 'sage',
          name: 'Frieren',
          color: '#7f7c84',
          portrait: '/media/sprites/square_sage.png'
        },
        { id: 'mage', name: 'Fern', color: '#794983', portrait: '/media/sprites/square_mage.png' }
      ]
    }
  ]
}

async function gift(request: APIRequestContext, items: string[]) {
  const res = await request.post(`${PREFS_BASE}/api/v1/admin/cosmetics/grant`, {
    headers: { 'X-Dev-Tier': 'admin' },
    data: { name: 'dev', items, note: 'e2e' }
  })
  expect(res.ok(), await res.text()).toBe(true)
}

async function stored(request: APIRequestContext) {
  const res = await request.get(AVATAR)
  expect(res.ok()).toBe(true)
  return (await res.json()) as {
    avatar: { source: string }
    cosmetics: {
      owned: string[]
      loadout: {
        equipped: Record<string, string | null>
        placement: Record<string, { x: number; y: number; r: number; s: number }>
      }
    }
  }
}

async function openDialog(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('hadoku_user_type', 'friend')
    localStorage.setItem('hadoku_session_id', 'avatar-cosmetics-session')
  })
  await mockShellApi(page, [{ id: 'main', name: 'Main', tags: [], tasks: [] }])
  await page.route('**/watchparty/api/characters', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CHARACTERS)
    })
  )
  await page.route('**/watchparty/media/**', route => route.fulfill({ status: 404, body: '' }))
  await pointPrefsAtLocalStack(page)
  await page.goto('/?userType=friend')
  await page.waitForSelector('h1.app-header__title', { timeout: 15000 })
  await page.getByRole('button', { name: 'User settings' }).click()
  await page.getByRole('tab', { name: 'Profile' }).click()
  await page.getByRole('button', { name: 'Change' }).click()
  const dialog = page.getByRole('dialog', { name: 'Avatar' })
  await expect(dialog.getByRole('tab', { name: /Overlay/ })).toBeVisible()
  return dialog
}

test.describe('avatar cosmetics', () => {
  // One dev user for the whole run: these tests change the same loadout.
  test.describe.configure({ mode: 'serial' })

  let savedTabs: Record<string, string> = {}

  test.beforeEach(async ({ request }) => {
    test.skip(!(await prefsUp(request)), 'prefs stack not running (playwright.config.ts starts it)')
    const row = (await (await request.get(PORTFOLIO)).json()) as {
      user: { blob: { settingsTabs?: Record<string, string> } } | null
    }
    savedTabs = row.user?.blob.settingsTabs ?? {}
    await gift(request, ['overlay.crown'])
    const res = await request.put(`${AVATAR}/cosmetics`, {
      data: {
        equip: { effect: null, gradient: null, font: null, overlay: null, message: null },
        placement: { 'overlay.crown': { x: 0, y: 0, r: 0, s: 100 } }
      }
    })
    expect(res.ok(), await res.text()).toBe(true)
  })

  test.afterEach(async ({ request }) => {
    const res = await request.put(PORTFOLIO, {
      data: { scope: 'user', patch: { settingsTabs: savedTabs } }
    })
    expect(res.ok(), await res.text()).toBe(true)
  })

  test('a granted item and a free one equip, and are stored', async ({ page, request }) => {
    const dialog = await openDialog(page)
    // The picture tab comes first, as before.
    await expect(dialog.getByRole('radio', { name: 'Fern' })).toBeVisible()

    await dialog.getByRole('tab', { name: /Overlay/ }).click()
    await page.evaluate(() => {
      window.addEventListener('hadoku:avatar', e => {
        ;(window as unknown as { __worn: unknown }).__worn = (
          e as Event & { detail: { avatar: { cosmetics?: unknown } } }
        ).detail.avatar.cosmetics
      })
    })
    const crown = dialog.getByRole('button', { name: 'Crown', exact: true })
    await crown.click()
    await expect(crown).toHaveAttribute('aria-pressed', 'true')
    await expect
      .poll(async () => (await stored(request)).cosmetics.loadout.equipped.overlay)
      .toBe('overlay.crown')
    const preview = dialog.getByRole('group', { name: 'Preview' })
    await expect(preview.locator('img[src="/cosmetics/art/crown.webp"]')).toBeAttached()
    // The page under the dialog hears it, as it hears a character change.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __worn?: unknown }).__worn))
      .toMatchObject({ overlay: 'overlay.crown' })

    await dialog.getByRole('tab', { name: /Effect/ }).click()
    await dialog.getByRole('button', { name: 'Glint', exact: true }).click()
    await expect
      .poll(async () => (await stored(request)).cosmetics.loadout.equipped.effect)
      .toBe('effect.glint')
    await expect(preview.locator('.hc-name.hc-fx-glint')).toBeAttached()
  })

  test('every tab fits at the dialog width, with no scrolling', async ({ page }) => {
    const dialog = await openDialog(page)
    const strip = dialog.getByRole('tablist', { name: 'Avatar' })
    expect(await strip.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  })

  test('on a narrow screen the tab strip drags sideways', async ({ page }) => {
    await page.setViewportSize(NARROW)
    const dialog = await openDialog(page)
    const strip = dialog.getByRole('tablist', { name: 'Avatar' })
    const message = dialog.getByRole('tab', { name: /Message/ })
    const sb = await strip.boundingBox()
    if (!sb) throw new Error('the tab strip has no box')
    // Six tabs are wider than a phone-width dialog.
    expect(await strip.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
    const before = await message.boundingBox()
    expect(before && before.x + before.width > sb.x + sb.width).toBe(true)
    // A drag from right to left scrolls the strip and chooses no tab.
    await page.mouse.move(sb.x + sb.width - 10, sb.y + sb.height / 2)
    await page.mouse.down()
    await page.mouse.move(sb.x + 10, sb.y + sb.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect(dialog.getByRole('tab', { name: 'Picture' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
    await message.click()
    await expect(message).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('button', { name: /^Decode, locked\./ })).toBeVisible()
  })

  test('on a narrow screen, choosing a later tab shifts the strip to show the rest', async ({
    page
  }) => {
    await page.setViewportSize(NARROW)
    const dialog = await openDialog(page)
    const strip = dialog.getByRole('tablist', { name: 'Avatar' })
    const inView = async (name: RegExp) => {
      const s = await strip.boundingBox()
      const t = await dialog.getByRole('tab', { name }).boundingBox()
      return !!s && !!t && t.x >= s.x - 1 && t.x + t.width <= s.x + s.width + 1
    }
    expect(await inView(/Message/)).toBe(false)
    await dialog.getByRole('tab', { name: /Font/ }).click()
    await expect.poll(() => inView(/Message/)).toBe(true)
    // And back: an early tab shifts it to the start.
    await dialog.getByRole('tab', { name: /Effect/ }).click()
    await expect.poll(() => inView(/Picture/)).toBe(true)
  })

  test('an item not yet earned can be tried on, and saves nothing', async ({ page, request }) => {
    const dialog = await openDialog(page)
    await dialog.getByRole('tab', { name: /Effect/ }).click()
    const twinkle = dialog.getByRole('button', { name: /^Twinkle, locked\./ })
    await expect(twinkle).toContainText('Bronze or better in a Major')
    await twinkle.click()
    const preview = dialog.getByRole('group', { name: 'Preview' })
    await expect(preview.getByText(/Trying on Twinkle/)).toBeVisible()
    await expect(preview.locator('.hc-name.hc-fx-twinkle')).toBeAttached()
    expect((await stored(request)).cosmetics.loadout.equipped.effect).toBeNull()

    await dialog.getByRole('button', { name: 'Take off' }).click()
    await expect(preview.getByText(/Trying on Twinkle/)).toHaveCount(0)
    await expect(preview.locator('.hc-name.hc-fx-twinkle')).toHaveCount(0)
  })

  test('upload controls live on the Upload tab only, which opens with nothing uploaded', async ({
    page,
    request
  }) => {
    const res = await request.put(AVATAR, { data: { source: 'sprite' } })
    expect(res.ok(), await res.text()).toBe(true)
    const dialog = await openDialog(page)
    const sources = dialog.getByRole('radiogroup', { name: 'Picture' })
    await expect(sources.getByRole('radio', { name: /Character/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(dialog.getByRole('radiogroup', { name: 'Character' })).toBeVisible()
    await expect(dialog.getByText('Choose image')).toHaveCount(0)

    const upload = sources.getByRole('radio', { name: /Upload/ })
    await expect(upload).toBeEnabled()
    await upload.click()
    await expect(upload).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByText('Choose image')).toBeVisible()
    await expect(dialog.getByRole('radiogroup', { name: 'Character' })).toHaveCount(0)
    // Opening the tab wears nothing: there is no picture to wear yet.
    expect((await stored(request)).avatar.source).toBe('sprite')

    await sources.getByRole('radio', { name: /Character/ }).click()
    await expect(dialog.getByText('Choose image')).toHaveCount(0)
  })

  test('locked items always show, with no toggle to hide them', async ({ page }) => {
    const dialog = await openDialog(page)
    await dialog.getByRole('tab', { name: /Effect/ }).click()
    await expect(dialog.getByRole('button', { name: /^Twinkle, locked\./ })).toBeVisible()
    await expect(dialog.getByText('Show locked')).toHaveCount(0)
  })

  test('archived items show to nobody: five fonts, no Metal', async ({ page }) => {
    const dialog = await openDialog(page)
    await dialog.getByRole('tab', { name: /Font/ }).click()
    for (const label of ['Script', 'Surf', 'Gothic', 'Runic', 'Arcade']) {
      await expect(dialog.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    await expect(dialog.getByRole('button', { name: /Metal/ })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /archived/ })).toHaveCount(0)
  })

  test('placing the crown: down is fine, above its own height is not', async ({
    page,
    request
  }) => {
    const dialog = await openDialog(page)
    await dialog.getByRole('tab', { name: /Overlay/ }).click()
    await dialog.getByRole('button', { name: 'Crown', exact: true }).click()
    const placement = dialog.getByRole('group', { name: 'Placement' })
    await expect(placement).toBeVisible()

    // Drag the crown well above where it sits: the ceiling holds it at its default height.
    const handle = dialog.locator('[data-g="move"]')
    const box = await handle.boundingBox()
    if (!box) throw new Error('the placement handle has no box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 6 })
    await page.mouse.up()
    await expect(placement.locator('output').nth(1)).toHaveText('0%')

    // Down to the bottom of the character is allowed, and stored.
    await placement.getByRole('slider', { name: 'Up/down' }).fill('70')
    await expect
      .poll(async () => (await stored(request)).cosmetics.loadout.placement['overlay.crown']?.y)
      .toBe(70)

    // The server fits what it is sent, whatever the client says.
    const forged = await request.put(`${AVATAR}/cosmetics`, {
      data: { placement: { 'overlay.crown': { x: 0, y: -60, r: 0, s: 100 } } }
    })
    expect(forged.ok()).toBe(true)
    expect((await stored(request)).cosmetics.loadout.placement['overlay.crown']?.y).toBe(0)
  })
})
