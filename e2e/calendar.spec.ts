import { test, expect, type Page } from '@playwright/test'

/**
 * Calendar day-view E2E (agenda list).
 *
 * Runs in public mode (localStorage-only, no backend) so it needs no secrets.
 * Assertions read the actual persisted `*-tasks` localStorage blob — not just the
 * DOM — so we prove the create data path end-to-end, not merely that a card rendered.
 */

interface StoredTask {
  id: string
  title: string
  state?: string
  date?: string | null
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

const minuteOf = (iso?: string | null) => (iso ? new Date(iso).getMinutes() : -1)
const durationMin = (t?: StoredTask) =>
  t && t.startTime && t.endTime
    ? Math.round((new Date(t.endTime).getTime() - new Date(t.startTime).getTime()) / 60000)
    : -1

test.describe('Calendar day view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?userType=public')
    // Start from a clean slate so assertions are deterministic.
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.getByRole('button', { name: 'Calendar view', exact: true }).click()
    await expect(page.locator('.calendar-day-view')).toBeVisible()
  })

  test('shows an empty state when nothing is scheduled', async ({ page }) => {
    await expect(page.locator('.calendar-agenda--empty')).toBeVisible()
    await expect(page.locator('.calendar-agenda__card')).toHaveCount(0)
  })

  test('creating a task persists startTime/endTime and renders an agenda card', async ({
    page
  }) => {
    await page.getByRole('button', { name: '+ New task' }).click()

    const input = page.locator('.calendar-create-input')
    await expect(input).toBeVisible()
    await input.fill('Verify create task')
    await page.locator('.calendar-create-btn--primary').click()

    // DOM: an agenda card with the title now renders.
    const card = page.locator('.calendar-agenda__card', { hasText: 'Verify create task' })
    await expect(card).toBeVisible()

    // Data: the persisted task carries a valid on-the-hour, 1-hour default slot.
    await expect
      .poll(async () => {
        const t = (await readStoredTasks(page)).find(t => t.title === 'Verify create task')
        if (!t || !t.startTime || !t.endTime) return 'absent'
        return `start-min:${minuteOf(t.startTime)} dur:${durationMin(t)}`
      })
      .toBe('start-min:0 dur:60')
  })

  test('creating an all-day task persists date with no time and groups it', async ({ page }) => {
    await page.getByRole('button', { name: '+ New task' }).click()

    const input = page.locator('.calendar-create-input')
    await expect(input).toBeVisible()
    await input.fill('Pay rent')
    await page.locator('.calendar-create-allday input').check()
    await page.locator('.calendar-create-btn--primary').click()

    // DOM: renders inside the pinned "All day" group.
    const card = page.locator('.calendar-agenda__group .calendar-agenda__card', {
      hasText: 'Pay rent'
    })
    await expect(card).toBeVisible()

    // Data: persisted with a `date` and NO timeslot.
    await expect
      .poll(async () => {
        const t = (await readStoredTasks(page)).find(t => t.title === 'Pay rent')
        if (!t) return 'absent'
        const hasDate = typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)
        return `date:${hasDate} start:${t.startTime ?? null} end:${t.endTime ?? null}`
      })
      .toBe('date:true start:null end:null')
  })

  test('shows a source badge and expandable metadata for ingested events', async ({ page }) => {
    // Create a task so the app materialises its -tasks localStorage key.
    await page.getByRole('button', { name: '+ New task' }).click()
    await page.locator('.calendar-create-input').fill('probe')
    await page.locator('.calendar-create-btn--primary').click()
    await expect(page.locator('.calendar-agenda__card')).toBeVisible()

    // Seed a provider-ingested event (source + metadata) into that key.
    await page.evaluate(() => {
      let key: string | null = null
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.endsWith('-tasks')) {
          key = k
          break
        }
      }
      if (!key) throw new Error('no tasks key')
      const at = (h: number, m: number) => {
        const d = new Date()
        d.setHours(h, m, 0, 0)
        return d.toISOString()
      }
      const blob = JSON.parse(localStorage.getItem(key) || '{}')
      blob.tasks = [
        {
          id: 'contact-appt_e2e',
          title: 'Synced Meeting',
          tag: 'contact',
          state: 'Active',
          createdAt: at(8, 0),
          startTime: at(14, 0),
          endTime: at(14, 30),
          source: 'contact',
          sourceId: 'appt_e2e',
          metadata: { scheduledBy: 'jane@example.com', platform: 'discord' }
        }
      ]
      localStorage.setItem(key, JSON.stringify(blob))
    })
    await page.reload()
    // No re-click: the view choice is persisted, so the reload comes back into
    // the calendar. (See calendar-discoverability.spec.ts.)
    await expect(page.locator('.calendar-day-view')).toBeVisible()

    const card = page.locator('.calendar-agenda__card', { hasText: 'Synced Meeting' })
    await expect(card).toBeVisible()
    await expect(card.locator('.calendar-agenda__source')).toContainText('contact')

    // Metadata is hidden until expanded.
    await expect(card.locator('.calendar-agenda__details')).toHaveCount(0)
    await card.hover()
    await card.getByRole('button', { name: 'Show details' }).click()
    await expect(card.locator('.calendar-agenda__details')).toContainText('Scheduled By')
    await expect(card.locator('.calendar-agenda__details')).toContainText('jane@example.com')
  })

  test('deleting a task removes its card', async ({ page }) => {
    await page.getByRole('button', { name: '+ New task' }).click()
    await page.locator('.calendar-create-input').fill('Verify delete task')
    await page.locator('.calendar-create-btn--primary').click()

    const card = page.locator('.calendar-agenda__card', { hasText: 'Verify delete task' })
    await expect(card).toBeVisible()

    await card.hover()
    await card.getByRole('button', { name: 'Delete task' }).click()

    await expect(card).toHaveCount(0)
    // Data: the task is no longer Active in storage.
    await expect
      .poll(async () => {
        const t = (await readStoredTasks(page)).find(t => t.title === 'Verify delete task')
        return t?.state ?? 'removed'
      })
      .not.toBe('Active')
  })
})
