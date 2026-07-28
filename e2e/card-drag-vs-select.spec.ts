import { test, expect, type Page } from '@playwright/test'

/**
 * A task card is a drag handle everywhere except on the text itself.
 *
 * Making card text copyable first hung the "don't drag, select" switch off the
 * BLOCKS that lay the text out. A block fills the card's width, so most of the
 * meta row — empty space with no glyph anywhere near it — became a no-drag
 * zone, and the card was effectively impossible to pick up. The switch now
 * hangs off an inline span, whose box IS the text.
 *
 * Each case presses at a point and reports which gesture the browser chose:
 * `dragstart` (the card moves) or `selectstart` (text highlights). The cursor
 * at that same point is asserted too — the affordance has to flip on exactly
 * the pixels the behaviour flips on, which is what made the old build feel
 * broken even where it worked.
 */

type Gesture = 'dragstart' | 'selectstart' | 'none'

async function addTask(page: Page, input: string) {
  const field = page.locator('.task-app__input')
  await field.fill(input)
  await field.press('Enter')
  const title = input.replace(/#\S+/g, '').trim()
  await expect(page.locator('.task-app__item', { hasText: title })).toBeVisible()
}

/** Press at a card-relative point, drag a little, and report what the browser did. */
async function gestureAt(
  page: Page,
  box: { x: number; y: number },
  dx: number,
  dy: number
): Promise<{ gesture: Gesture; cursor: string }> {
  await page.evaluate(() => {
    ;(window as unknown as { __gesture: Gesture }).__gesture = 'none'
    window.getSelection()?.removeAllRanges()
    const record = (g: Gesture) => () => {
      const w = window as unknown as { __gesture: Gesture }
      if (w.__gesture === 'none') w.__gesture = g
    }
    document.addEventListener('dragstart', record('dragstart'), { capture: true, once: true })
    document.addEventListener('selectstart', record('selectstart'), { capture: true, once: true })
  })

  const x = box.x + dx
  const y = box.y + dy
  await page.mouse.move(x, y)
  const cursor = await page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py)
      return el ? getComputedStyle(el).cursor : 'none'
    },
    [x, y]
  )
  await page.mouse.down()
  await page.mouse.move(x + 40, y + 12, { steps: 8 })
  await page.mouse.move(x + 90, y + 24, { steps: 8 })
  const gesture = await page.evaluate(() => (window as unknown as { __gesture: Gesture }).__gesture)
  await page.mouse.up()
  return { gesture, cursor }
}

test.describe('Card: drag vs text selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?userType=public')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.locator('.task-app__input')).toBeVisible()
    await addTask(page, 'Grab me anywhere #alpha')
  })

  test('the empty gap in the meta row drags the card', async ({ page }) => {
    const item = page.locator('.task-app__item', { hasText: 'Grab me anywhere' }).first()
    const metaRow = await item.locator('.task-app__item-meta-row').boundingBox()
    const tag = await item.locator('.task-app__item-tag').boundingBox()
    const age = await item.locator('.task-app__item-age').boundingBox()
    if (!metaRow || !tag || !age) throw new Error('meta row did not render')

    // Dead centre of the gap between the tag and the age — no text here at all.
    const gapX = (tag.x + tag.width + age.x) / 2
    const { gesture, cursor } = await gestureAt(
      page,
      { x: gapX, y: metaRow.y + metaRow.height / 2 },
      0,
      0
    )

    expect(gesture).toBe('dragstart')
    expect(cursor).toBe('grab')
  })

  test('pressing on the tag text selects it instead of dragging', async ({ page }) => {
    const item = page.locator('.task-app__item', { hasText: 'Grab me anywhere' }).first()
    const text = await item.locator('.task-app__item-tag .task-app__item-text').boundingBox()
    if (!text) throw new Error('tag text did not render')

    // Press just inside the left edge: a press at the centre would select from
    // mid-word, which proves the same thing but reads like a typo in the assert.
    const { gesture, cursor } = await gestureAt(
      page,
      { x: text.x + 2, y: text.y + text.height / 2 },
      0,
      0
    )

    expect(gesture).toBe('selectstart')
    expect(cursor).toBe('text')
    const selected = await page.evaluate(() => String(window.getSelection()))
    expect(selected.length).toBeGreaterThan(0)
    expect('#alpha').toContain(selected.trim())
  })

  test('the card padding drags, top and bottom', async ({ page }) => {
    const item = page.locator('.task-app__item', { hasText: 'Grab me anywhere' }).first()
    const box = await item.boundingBox()
    if (!box) throw new Error('card did not render')

    for (const dy of [4, box.height - 4]) {
      const { gesture, cursor } = await gestureAt(page, box, box.width / 4, dy)
      expect(gesture, `press ${dy}px from the card top`).toBe('dragstart')
      expect(cursor, `press ${dy}px from the card top`).toBe('grab')
    }
  })

  test('a selectable text run is no wider than its glyphs', async ({ page }) => {
    const item = page.locator('.task-app__item', { hasText: 'Grab me anywhere' }).first()
    // The span must hug the text; if it ever goes block-level it silently
    // reclaims the whole row as a no-drag zone, which is the original bug.
    const widths = await item.locator('.task-app__item-tag').evaluate(el => {
      const span = el.querySelector('.task-app__item-text') as HTMLElement
      return { span: span.getBoundingClientRect().width, box: el.getBoundingClientRect().width }
    })
    expect(widths.span).toBeLessThanOrEqual(widths.box)
    expect(widths.span).toBeGreaterThan(0)
    expect(
      await item
        .locator('.task-app__item-text')
        .first()
        .evaluate(el => getComputedStyle(el).display)
    ).toBe('inline')
  })
})
