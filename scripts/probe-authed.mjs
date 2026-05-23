// E2E validation of the AUTHENTICATED startup path against production.
// Mirrors data-sync.spec.ts's real-API approach: establishes a real admin
// session via /session/create (X-User-Key), then times the authed startup
// network waterfall (handshake → prefs → boards) and time-to-interactive.
// ADMIN_TEST_KEY is injected by dev-vault (it's this repo's declared TASK_ADMIN_TEST_KEY).
import { chromium } from '@playwright/test'

const KEY = process.env.ADMIN_TEST_KEY
if (!KEY) throw new Error('ADMIN_TEST_KEY not in env (run via dev-vault wrapper)')
const ORIGIN = 'https://hadoku.me'

const browser = await chromium.launch()
// warm the browser process (unmeasured)
{ const c = await browser.newContext(); const p = await c.newPage(); await p.goto('about:blank'); await c.close() }

async function run(label, authed) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })

  let sessionId = null, userType = 'public'
  if (authed) {
    // Create a real session the same way the app's "enter key" flow does.
    const resp = await ctx.request.post(`${ORIGIN}/session/create`, {
      headers: { 'X-User-Key': KEY },
    })
    if (!resp.ok()) {
      console.log(`[${label}] session/create failed: ${resp.status()} ${await resp.text()}`)
      await ctx.close(); return null
    }
    const data = await resp.json()
    sessionId = data.sessionId
    userType = data.userType || 'admin'
    console.log(`[${label}] session established: userType=${userType} sid=${String(sessionId).slice(0,12)}…`)
    // Seed localStorage like mf-loader does, so the app boots authed.
    await ctx.addInitScript(({ sid, ut }) => {
      localStorage.setItem('hadoku_session_id', sid)
      localStorage.setItem('hadoku_user_type', ut)
    }, { sid: sessionId, ut: userType })
  }

  const page = await ctx.newPage()
  const timings = []
  page.on('requestfinished', async (req) => {
    const u = req.url()
    if (/\/task\/api\/|\/prefs\/api\/|\/session\//.test(u)) {
      const t = req.timing()
      let status
      try { status = (await req.response())?.status() } catch {}
      timings.push({
        path: u.replace(ORIGIN, '').split('?')[0],
        method: req.method(),
        status,
        start: Math.round(t.startTime),
        end: Math.round(t.responseEnd),
        ms: Math.round(t.responseEnd - t.startTime),
      })
    }
  })

  const t0 = Date.now()
  await page.goto(`${ORIGIN}/task`, { waitUntil: 'load' })
  let tSkeleton = null, tApp = null
  const deadline = Date.now() + 30000
  while (Date.now() < deadline && !tApp) {
    const s = await page.evaluate(() => ({
      skel: !!document.querySelector('.task-app-loading'),
      app: !!document.querySelector('.task-app-container'),
    }))
    if (s.skel && !tSkeleton) tSkeleton = Date.now()
    if (s.app && !tApp) tApp = Date.now()
    await page.waitForTimeout(15)
  }
  // let any trailing background sync settle
  await page.waitForTimeout(500)

  console.log(`\n===== ${label} =====`)
  console.log('time→skeleton:', tSkeleton ? (tSkeleton - t0) + 'ms' : 'NEVER',
              '| time→app:', tApp ? (tApp - t0) + 'ms' : 'NEVER')
  console.log('startup API waterfall (relative to navigation start):')
  for (const t of timings.sort((a, b) => a.start - b.start)) {
    console.log(
      '   ', String(t.start).padStart(5) + '→' + String(t.end).padStart(5) + 'ms',
      '(' + String(t.ms).padStart(4) + 'ms)',
      String(t.status).padStart(3),
      t.method.padEnd(5), t.path
    )
  }
  await ctx.close()
  return { skeleton: tSkeleton ? tSkeleton - t0 : null, app: tApp ? tApp - t0 : null, calls: timings.length }
}

const pub = await run('PUBLIC (unauthenticated)', false)
const adm = await run('ADMIN (authenticated)', true)

console.log('\n===== COMPARISON =====')
console.log('public  → app:', pub?.app + 'ms', '| api calls:', pub?.calls)
console.log('admin   → app:', adm?.app + 'ms', '| api calls:', adm?.calls)

await browser.close()
