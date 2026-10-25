import { test, expect, type Page } from '@playwright/test'

/**
 * Cold-load critical-path regression test.
 *
 * The session init used to run handshake -> prefs -> boards strictly in series,
 * so first paint was gated on the slowest network calls and the board sync
 * didn't even *start* until the others had landed. The handshake is gone
 * (identity is the edge's), which leaves one chain that could re-form: the
 * board sync waiting on prefs. Nothing in it depends on prefs — for an
 * authenticated user the sessionId is known before either runs.
 *
 * This pins that they run concurrently, and that no handshake is sent at all.
 * The stubbed latencies are the medians measured against prod (hadoku.me).
 */

const PREFS_MS = 170 // prod median
const BOARDS_MS = 400 // prod median

/**
 * How long the prefs response may be held open waiting for the board sync to
 * be issued. Only a re-serialised chain ever reaches it: the board sync is then
 * waiting on prefs itself, so it never arrives and the hold times out.
 */
const PREFS_HOLD_CAP_MS = 15000

const SESSION_ID = 'perf-test-session'
const USER_TYPE = 'friend'
const TASK_TITLE = 'SERVER-TASK'

function boardsPayload() {
  const now = new Date().toISOString()
  return {
    version: 1,
    updatedAt: now,
    boards: [
      {
        id: 'main',
        name: 'main',
        tags: [],
        tasks: [{ id: 'srv-1', title: TASK_TITLE, state: 'Active', createdAt: now, tag: null }]
      }
    ]
  }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Resolves once `ready()` holds, or after `capMs` — whichever comes first. */
async function until(ready: () => boolean, capMs: number) {
  const deadline = Date.now() + capMs
  while (!ready() && Date.now() < deadline) await delay(10)
}

/** Ordered log of observable events, so assertions are about causality, not wall-clock. */
type Marks = {
  prefsSent?: number
  prefsDelivered?: number
  boardsSent?: number
  appMounted?: number
  dataOnScreen?: number
}

async function stubApiWithProdLatency(page: Page, marks: Marks, t0: () => number) {
  // The prefs identity lookup is the first call the prefs SDK makes; every
  // prefs read waits on it. Prod latency, AND held until the board sync has
  // been issued — which makes the check pure causality: concurrent code always
  // gets the board sync out while prefs are open; a serial chain cannot.
  await page.route('**/session/whoami', async route => {
    marks.prefsSent ??= t0()
    await delay(PREFS_MS)
    await until(() => marks.boardsSent != null, PREFS_HOLD_CAP_MS)
    marks.prefsDelivered ??= t0()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: false })
    })
  })

  await page.route('**/task/api/boards**', async route => {
    marks.boardsSent ??= t0()
    await delay(BOARDS_MS)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(boardsPayload())
    })
  })
}

test.describe('Cold-load critical path', () => {
  test('prefs and board sync run concurrently, with no session handshake', async ({ page }) => {
    await page.addInitScript(
      ({ userType, sessionId }) => {
        localStorage.clear()
        localStorage.setItem('hadoku_user_type', userType)
        localStorage.setItem('hadoku_session_id', sessionId)
      },
      { userType: USER_TYPE, sessionId: SESSION_ID }
    )
    const handshakes: string[] = []
    page.on('request', r => {
      if (r.url().includes('/session/handshake')) handshakes.push(r.url())
    })
    // performance.now(), not Date.now(): the prefs hold releases on the same
    // tick that marks boards as sent, so at millisecond resolution the two marks
    // can tie and a strict `<` reads a correct order as a failure.
    const start = performance.now()
    const t0 = () => performance.now() - start
    const marks: Marks = {}
    await stubApiWithProdLatency(page, marks, t0)

    await page.goto('/')

    await page.locator('.task-app-container').waitFor({ state: 'attached', timeout: 20000 })
    marks.appMounted = t0()

    await page
      .locator('.task-app__item-title', { hasText: TASK_TITLE })
      .waitFor({ state: 'attached', timeout: 20000 })
    marks.dataOnScreen = t0()

    await expect
      .poll(() => marks.prefsDelivered ?? null, {
        timeout: 20000,
        message: 'prefs identity response should eventually be delivered'
      })
      .not.toBeNull()

    const { prefsSent, prefsDelivered, boardsSent } = marks
    if (prefsSent == null || prefsDelivered == null || boardsSent == null) {
      throw new Error(`expected prefs and boards to both fire — got ${JSON.stringify(marks)}`)
    }

    const rel = (v: number) => `+${Math.round(v - prefsSent)}ms`
    console.log(
      `[cold-load] boot=${Math.round(prefsSent)}ms | sent: prefs=${rel(prefsSent)} ` +
        `boards=${rel(boardsSent)} | app mounted=${rel(marks.appMounted ?? 0)} ` +
        `data on screen=${rel(marks.dataOnScreen ?? 0)} | prefs delivered=${rel(prefsDelivered)}`
    )

    expect(handshakes, 'identity is the edge’s; the app sends no handshake').toEqual([])

    // Request ORDERING only — immune to machine load, because the prefs stub
    // holds its response until the board sync is issued. Deliberately NOT
    // asserting on mount/paint times: those depend on React render speed and go
    // flaky under a loaded parallel suite. The numbers are logged above.
    expect(
      boardsSent,
      'board sync must be issued while prefs are still in flight, not after they return'
    ).toBeLessThan(prefsDelivered)
  })
})
