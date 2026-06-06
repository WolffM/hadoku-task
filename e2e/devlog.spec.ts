import { test, expect } from '@playwright/test'
import { readFileSync, rmSync, existsSync } from 'fs'
import { resolve } from 'path'

// Playwright runs from the repo root; .dev-logs/ is written there by the vite plugin.

/**
 * Proves the local dev log sink end-to-end: a real task action in the browser
 * flows through the ONE logger (@wolffm/logger) → dev telemetry sink → vite
 * POST /__devlog → .dev-logs/actions.log on disk. Asserts on the file (Node),
 * not the DOM — so it proves the whole pipeline, including the info-level
 * capture that only works with @wolffm/logger@1.2.0's sinkMinLevel.
 */
const LOG = resolve(process.cwd(), '.dev-logs', 'actions.log')

function readLog(): string {
  return existsSync(LOG) ? readFileSync(LOG, 'utf8') : ''
}

test('local task actions are written to .dev-logs/actions.log via the logger sink', async ({
  page
}) => {
  // Start from an empty log so assertions are unambiguous.
  try {
    rmSync(LOG)
  } catch {
    /* first run: file may not exist */
  }

  await page.goto('/?userType=public')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  // Create a task with a unique title via the board input.
  const marker = `devlog-proof-${Date.now()}`
  const input = page.locator('input.task-app__input')
  await input.fill(marker)
  await input.press('Enter')

  // The createTask path logs at info level; the dev sink POSTs it to /__devlog,
  // which the vite plugin appends to the file. fetch is fire-and-forget, so poll.
  await expect
    .poll(() => readLog(), { timeout: 8000, intervals: [100, 200, 400] })
    .toContain('createTask')

  const contents = readLog()

  // Each line is a TelemetryEvent JSON object from @wolffm/logger.
  const lines = contents.trim().split('\n').filter(Boolean)
  const events = lines.map(l => JSON.parse(l))

  // Proves: info-level entries reach the sink (sinkMinLevel:'debug' in 1.2.0),
  // tagged source:'browser', carrying our log shape.
  const infoEvents = events.filter(e => e.level === 'info')
  expect(infoEvents.length).toBeGreaterThan(0)
  expect(events.every(e => e.source === 'browser')).toBe(true)

  // The createTask entry is present and structured.
  const createEvent = events.find(
    e => typeof e.message === 'string' && e.message.includes('createTask')
  )
  expect(createEvent).toBeTruthy()
  expect(createEvent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
})
