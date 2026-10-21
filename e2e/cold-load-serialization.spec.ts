import { test, expect, type Page } from '@playwright/test'

/**
 * Cold-load critical-path regression test.
 *
 * The session init used to run handshake -> prefs -> boards strictly in series,
 * so first paint was gated on the two slowest network calls and the board sync
 * didn't even *start* until both had landed. Nothing in prefs or the board sync
 * actually depends on the handshake: for an authenticated user the sessionId is
 * known before it runs.
 *
 * This pins that they run concurrently. The stubbed latencies below are the
 * medians measured against prod (hadoku.me), so the shape is realistic.
 *
 * Measured A/B with these latencies:
 *   serial (old):   app mounted +1498ms, server data on screen +1502ms
 *   parallel (new): app mounted  +446ms, server data on screen  +506ms
 */

const HANDSHAKE_MS = 575 // prod median
const PREFS_MS = 170 // prod median
const BOARDS_MS = 400 // prod median

/**
 * How long the handshake may be held open waiting for prefs and boards to be
 * issued. Only a re-serialised chain ever reaches it: those requests are then
 * waiting on the handshake itself, so nothing arrives and the hold times out.
 */
const HANDSHAKE_HOLD_CAP_MS = 15000

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
  handshakeSent?: number
  handshakeDelivered?: number
  prefsSent?: number
  boardsSent?: number
  appMounted?: number
  dataOnScreen?: number
}

async function stubApiWithProdLatency(page: Page, marks: Marks, t0: () => number) {
  await page.route('**/task/api/session/handshake', async route => {
    marks.handshakeSent ??= t0()
    // Prod latency, AND held until prefs and boards have both been issued.
    //
    // A fixed 575ms alone made the ordering assertions below a race against the
    // browser's own speed: on a loaded machine the JS between issuing the
    // handshake and issuing prefs took over a second, the timer fired first, and
    // concurrent code failed as if it were serial. Holding the response makes the
    // check pure causality — concurrent code always gets its requests out while
    // the handshake is open; a serial chain cannot issue them until it closes.
    await delay(HANDSHAKE_MS)
    await until(() => marks.prefsSent != null && marks.boardsSent != null, HANDSHAKE_HOLD_CAP_MS)
    marks.handshakeDelivered ??= t0()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ userType: USER_TYPE, preferences: null })
    })
  })

  await page.route('**/prefs/api/**', async route => {
    marks.prefsSent ??= t0()
    await delay(PREFS_MS)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ preferences: {} })
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
  test('handshake, prefs and board sync run concurrently — not chained', async ({ page }) => {
    await page.addInitScript(
      ({ userType, sessionId }) => {
        localStorage.clear()
        localStorage.setItem('hadoku_user_type', userType)
        localStorage.setItem('hadoku_session_id', sessionId)
      },
      { userType: USER_TYPE, sessionId: SESSION_ID }
    )
    // performance.now(), not Date.now(): the handshake hold releases on the same
    // tick that marks prefs as sent, so at millisecond resolution the two marks
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

    // The whole point of the fix is that data lands BEFORE the handshake comes
    // back — so by now the handshake response usually hasn't been delivered yet.
    // Wait for it, since it's the baseline every assertion below compares against.
    await expect
      .poll(() => marks.handshakeDelivered ?? null, {
        timeout: 20000,
        message: 'handshake response should eventually be delivered'
      })
      .not.toBeNull()

    const { handshakeSent, handshakeDelivered, prefsSent, boardsSent } = marks
    if (
      handshakeSent == null ||
      handshakeDelivered == null ||
      prefsSent == null ||
      boardsSent == null
    ) {
      throw new Error(
        `expected handshake, prefs and boards to all fire — got ${JSON.stringify(marks)}`
      )
    }

    const rel = (v: number) => `+${Math.round(v - handshakeSent)}ms`
    console.log(
      `[cold-load] boot=${Math.round(handshakeSent)}ms | sent: handshake=${rel(handshakeSent)} ` +
        `prefs=${rel(prefsSent)} boards=${rel(boardsSent)}`
    )
    console.log(
      `[cold-load] app mounted=${rel(marks.appMounted ?? 0)} ` +
        `data on screen=${rel(marks.dataOnScreen ?? 0)} ` +
        `| handshake response delivered=${rel(handshakeDelivered)}`
    )

    // Assert on request ORDERING only — pure causality, immune to how loaded the
    // machine is, because the handshake stub holds its response until both have
    // been issued. If the chain re-serialises, neither can be issued until the
    // hold times out and the handshake returns, and both assertions fail.
    //
    // Deliberately NOT asserting on mount/paint times: those also depend on React
    // render speed, so under a loaded parallel suite they cross the handshake
    // deadline for reasons that have nothing to do with this fix. That's a latency
    // budget, not an invariant, and it goes flaky. The numbers are logged above.
    expect(
      boardsSent,
      'board sync must be issued while the handshake is still in flight, not after it returns'
    ).toBeLessThan(handshakeDelivered)

    expect(
      prefsSent,
      'prefs must be issued while the handshake is still in flight, not after it returns'
    ).toBeLessThan(handshakeDelivered)
  })
})
