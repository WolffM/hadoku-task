import { test, expect, type Page } from '@playwright/test'

/**
 * Calendar view E2E — proves the two wirings that were previously stubbed:
 *   1. Create a task from a time slot persists startTime/endTime (was TODO).
 *   2. Drag-to-reschedule patches startTime/endTime via the API (was console.log).
 *
 * Runs in public mode (localStorage-only, no backend) so it needs no secrets.
 * Assertions read the actual persisted `tasks:*` localStorage blob — not just the
 * DOM — so we prove the data path end-to-end, not merely that a block rendered.
 */

const HOUR_HEIGHT = 60 // must match CalendarDayView

interface StoredTask {
  id: string
  title: string
  startTime?: string | null
  endTime?: string | null
}

/** Read every persisted task across all `{userType}-{sessionId}-{boardId}-tasks` keys. */
async function readStoredTasks(page: Page): Promise<StoredTask[]> {
  return page.evaluate(() => {
    const out: StoredTask[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.endsWith('-tasks')) continue
      try {
        const blob = JSON.parse(localStorage.getItem(key) || '{}')
        if (Array.isArray(blob.tasks)) out.push(...blob.tasks)
      } catch {
        /* ignore corrupt blob */
      }
    }
    return out
  })
}

const hourOf = (iso?: string | null) => (iso ? new Date(iso).getHours() : -1)
const minuteOf = (iso?: string | null) => (iso ? new Date(iso).getMinutes() : -1)

test.describe('Calendar view scheduling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?userType=public')
    // Start from a clean slate so assertions are deterministic.
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    // Switch into the calendar view.
    await page.getByRole('button', { name: 'Calendar', exact: true }).click()
    await expect(page.locator('.calendar-grid')).toBeVisible()
  })

  test('creating a task from a time slot persists startTime/endTime', async ({ page }) => {
    // Slot index 36 = hour 9, quarter 0 (4 slots per hour). Click the 09:00 slot.
    await page.locator('.calendar-slot').nth(36).click()

    const input = page.locator('.calendar-create-input')
    await expect(input).toBeVisible()
    await input.fill('Verify create task')
    await page.locator('.calendar-create-btn--primary').click()

    // DOM: a task block with the title now renders in the calendar.
    const block = page.locator('.calendar-task-block', { hasText: 'Verify create task' })
    await expect(block).toBeVisible()

    // Data: the persisted task carries the slot's start/end times (09:00 -> 09:30).
    await expect
      .poll(async () => {
        const t = (await readStoredTasks(page)).find(t => t.title === 'Verify create task')
        return t
          ? `${hourOf(t.startTime)}:${minuteOf(t.startTime)}-${hourOf(t.endTime)}:${minuteOf(t.endTime)}`
          : 'absent'
      })
      .toBe('9:0-9:30')
  })

  test('dragging a task to a new time reschedules it via the API path', async ({ page }) => {
    // Seed a task at 09:00-09:30 through the UI.
    await page.locator('.calendar-slot').nth(36).click()
    await page.locator('.calendar-create-input').fill('Verify reschedule task')
    await page.locator('.calendar-create-btn--primary').click()

    const block = page.locator('.calendar-task-block', { hasText: 'Verify reschedule task' })
    await expect(block).toBeVisible()

    // Confirm starting position.
    await expect
      .poll(async () =>
        hourOf(
          (await readStoredTasks(page)).find(t => t.title === 'Verify reschedule task')?.startTime
        )
      )
      .toBe(9)

    // HTML5 native drag-and-drop: dispatch the real DragEvents the component
    // listens for, sharing one DataTransfer across them (Playwright's mouse-based
    // dragTo does not populate dataTransfer for native DnD). This fires the actual
    // handleDragStart -> handleDragOver -> handleDrop handlers in CalendarDayView.
    // Drop Y is grid.top + 840px => 840 minutes => 14:00 (1px == 1min at HOUR_HEIGHT=60).
    const targetMinutes = 14 * 60
    await page.evaluate(
      ({ targetMinutes, hourHeight }) => {
        const grid = document.querySelector('.calendar-grid') as HTMLElement
        const blockEl = Array.from(document.querySelectorAll('.calendar-task-block')).find(el =>
          el.textContent?.includes('Verify reschedule task')
        ) as HTMLElement
        const rect = grid.getBoundingClientRect()
        const clientY = rect.top + (targetMinutes / 60) * hourHeight
        const clientX = rect.left + rect.width / 2
        const dt = new DataTransfer()

        const fire = (
          el: Element,
          type: string,
          extra: { clientX?: number; clientY?: number } = {}
        ) => {
          const ev = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
            ...extra
          })
          el.dispatchEvent(ev)
        }

        fire(blockEl, 'dragstart')
        fire(grid, 'dragover', { clientX, clientY })
        fire(grid, 'drop', { clientX, clientY })
        fire(blockEl, 'dragend')
      },
      { targetMinutes, hourHeight: HOUR_HEIGHT }
    )

    // Data: the persisted task moved to 14:00 and kept its 30-minute duration.
    await expect
      .poll(async () => {
        const t = (await readStoredTasks(page)).find(t => t.title === 'Verify reschedule task')
        return t
          ? `${hourOf(t.startTime)}:${minuteOf(t.startTime)}-${hourOf(t.endTime)}:${minuteOf(t.endTime)}`
          : 'absent'
      })
      .toBe('14:0-14:30')
  })
})
