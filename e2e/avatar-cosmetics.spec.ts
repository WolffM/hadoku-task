import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { PREFS_BASE, pointPrefsAtLocalStack, prefsUp } from './helpers/prefs'
import { mockShellApi } from './helpers/mock-api'

/**
 * Avatar cosmetics in the avatar dialog (AvatarBuilder), against the REAL
 * prefs-api on the dev stack: what the operator gifts shows as earned, an
 * earned item equips and is stored, an unearned one can only be tried on, and
 * an overlay's placement is fitted to the allowed area before it is stored.
 *
 * The operator's gift goes through the real admin route, by name, with
 * `X-Dev-Tier: admin` (worker/test/prefs-dev-server.ts). The dev user is
 * shared across the run, so each test starts by taking everything off.
 *
 * watchparty's character table is the only stub: it is another app's API.
 */

const AVATAR = `${PREFS_BASE}/api/v1/_avatar`
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

  test.beforeEach(async ({ request }) => {
    test.skip(!(await prefsUp(request)), 'prefs stack not running (pnpm run dev:api)')
    await gift(request, ['overlay.crown', 'effect.glint'])
    const res = await request.put(`${AVATAR}/cosmetics`, {
      data: {
        equip: { effect: null, gradient: null, font: null, overlay: null, message: null },
        placement: { 'overlay.crown': { x: 0, y: 0, r: 0, s: 100 } }
      }
    })
    expect(res.ok(), await res.text()).toBe(true)
  })

  test('a gift shows as earned, equips, and is stored', async ({ page, request }) => {
    const dialog = await openDialog(page)
    // The picture tab comes first, as before.
    await expect(dialog.getByRole('radio', { name: 'Fern' })).toBeVisible()

    await dialog.getByRole('tab', { name: /Overlay/ }).click()
    await expect(dialog.getByRole('tab', { name: /Overlay/ })).toContainText('1/9')
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

  test('an item not yet earned can be tried on, and saves nothing', async ({ page, request }) => {
    const dialog = await openDialog(page)
    await dialog.getByRole('tab', { name: /Overlay/ }).click()
    const halo = dialog.getByRole('button', { name: /^Halo, locked\./ })
    await expect(halo).toContainText('Help a new player')
    await halo.click()
    const preview = dialog.getByRole('group', { name: 'Preview' })
    await expect(preview.getByText(/Trying on Halo/)).toBeVisible()
    await expect(preview.locator('img[src="/cosmetics/art/halo.webp"]')).toBeAttached()
    expect((await stored(request)).cosmetics.loadout.equipped.overlay).toBeNull()

    await dialog.getByRole('button', { name: 'Take off' }).click()
    await expect(preview.getByText(/Trying on Halo/)).toHaveCount(0)
    await expect(preview.locator('img[src="/cosmetics/art/halo.webp"]')).toHaveCount(0)
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
