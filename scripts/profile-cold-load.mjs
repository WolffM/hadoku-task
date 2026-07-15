#!/usr/bin/env node
/**
 * Cold-load profiler for the task app (and, with --origin, any hadoku page).
 *
 * Authenticates once through the real key flow so the session cookie is set,
 * then measures N cold-HTTP-cache navigations — the returning-user path, which
 * is where load latency actually lives. For each run it records:
 *
 *   - time to skeleton, app mount, and first task on screen
 *   - the full API waterfall with per-call wall time + cache headers
 *   - duplicate requests (same method+path fetched more than once)
 *   - a per-endpoint call count (so e.g. a double /session/whoami is obvious)
 *
 * Results print as a human summary AND are written as a timestamped JSON log
 * under .profiler/ (gitignored), with .profiler/latest.json always pointing at
 * the most recent run — so runs are diffable over time.
 *
 * Usage:
 *   pnpm run profile                    # 5 runs vs https://hadoku.me
 *   pnpm run profile -- --runs 10
 *   TASK_KEY=friend-... pnpm run profile
 *   pnpm run profile -- --origin http://localhost:5199 --path /task/
 *
 * Env / flags:
 *   TASK_PROD_ORIGIN | --origin   default https://hadoku.me
 *   TASK_KEY         | --key      friend test key (default: the shared e2e key)
 *   TASK_PROD_RUNS   | --runs     cold-cache runs to measure (default 5)
 *                      --path     page path (default /task/)
 *                      --headed   run with a visible browser
 *
 * Docs: docs/PROFILING.md
 */
import pw from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = pw

// ---- args ------------------------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1) return process.argv[i + 1] ?? true
  return fallback
}
const ORIGIN = arg('origin', process.env.TASK_PROD_ORIGIN ?? 'https://hadoku.me')
const KEY = arg('key', process.env.TASK_KEY ?? 'friend-12345678-1234-1234-1234-1234567890ab')
const RUNS = Number(arg('runs', process.env.TASK_PROD_RUNS ?? 5))
const PATH = arg('path', '/task/')
const HEADED = arg('headed', false) === true
const SETTLE_MS = 4000 // let background initialLoad + late calls land

const median = xs => {
  const s = [...xs].filter(x => x != null).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}
const short = u => u.replace(ORIGIN, '').split('?')[0]
const isApi = u => /\/(task|prefs|session)\/|\/whoami/.test(u)

async function authenticate(page) {
  await page.goto(`${ORIGIN}${PATH}`, { waitUntil: 'load' })
  await page.waitForSelector('h1.task-app__header', { timeout: 20000 })
  await page.locator('h1.task-app__header').click()
  await page.waitForSelector('.modal-overlay', { state: 'visible', timeout: 10000 })
  const keyInput = page.locator('input[name="key"]')
  await keyInput.waitFor({ state: 'visible', timeout: 10000 })
  await keyInput.fill(KEY)
  await keyInput.locator('..').locator('button.settings-field-button').click()
  await page.waitForEvent('load', { timeout: 20000 })
  await page.waitForTimeout(2500)
  return page.evaluate(() => ({
    userType: localStorage.getItem('hadoku_user_type'),
    sessionId: localStorage.getItem('hadoku_session_id')
  }))
}

async function measure(page, cdp) {
  await page.goto('about:blank', { waitUntil: 'load' }) // tear down prior DOM
  await cdp.send('Network.clearBrowserCache')

  const reqs = []
  const onFinished = async req => {
    try {
      const res = await req.response()
      if (!res) return
      const t = req.timing()
      const h = await res.allHeaders()
      reqs.push({
        method: req.method(),
        path: short(req.url()),
        status: res.status(),
        wall: Math.round(t.responseEnd - t.requestStart),
        ttfb: Math.round(t.responseStart - t.requestStart),
        cacheControl: h['cache-control'] ?? '',
        cfCache: h['cf-cache-status'] ?? ''
      })
    } catch {
      /* aborted */
    }
  }
  page.on('requestfinished', onFinished)

  const t0 = Date.now()
  const mark = {}
  const poll = (async () => {
    const deadline = t0 + 30000
    while (Date.now() < deadline && mark.tasks == null) {
      try {
        const s = await page.evaluate(() => ({
          skel: !!document.querySelector('.task-app-loading'),
          app: !!document.querySelector('.task-app-container'),
          tasks: document.querySelectorAll('.task-app__item').length > 0
        }))
        const now = Date.now() - t0
        if (s.skel && mark.skeleton == null) mark.skeleton = now
        if (s.app && mark.app == null) mark.app = now
        if (s.tasks && mark.tasks == null) mark.tasks = now
      } catch {
        /* navigating */
      }
      await new Promise(r => setTimeout(r, 10))
    }
  })()

  await page.goto(`${ORIGIN}${PATH}`, { waitUntil: 'load', timeout: 30000 })
  await poll
  await page.waitForTimeout(SETTLE_MS)
  page.off('requestfinished', onFinished)

  // duplicates + per-endpoint counts
  const counts = {}
  for (const r of reqs) {
    const k = `${r.method} ${r.path}`
    counts[k] = (counts[k] ?? 0) + 1
  }
  const duplicates = Object.entries(counts)
    .filter(([, n]) => n > 1)
    .map(([k, n]) => ({ call: k, count: n }))

  return {
    timing: { skeleton: mark.skeleton ?? null, app: mark.app ?? null, tasks: mark.tasks ?? null },
    api: reqs.filter(r => isApi(r.path)),
    duplicates,
    totalApiWireMs: reqs.filter(r => isApi(r.path)).reduce((s, r) => s + r.wall, 0)
  }
}

// ---- run -------------------------------------------------------------------
console.log(`\nCold-load profiler → ${ORIGIN}${PATH}  (${RUNS} runs)\n`)

const browser = await chromium.launch({ headless: !HEADED })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()

console.log('Authenticating…')
const who = await authenticate(page)
if (who.userType !== 'friend') {
  console.error(`❌ authentication failed (userType=${who.userType}). Set TASK_KEY to a valid friend key.`)
  await browser.close()
  process.exit(1)
}
console.log(`  authed as friend (session ${who.sessionId.slice(0, 8)}…)\n`)

const cdp = await ctx.newCDPSession(page)
const runs = []
for (let i = 1; i <= RUNS; i++) {
  const r = await measure(page, cdp)
  runs.push(r)
  console.log(
    `  run ${i}: skeleton=${r.timing.skeleton}ms app=${r.timing.app}ms tasks=${r.timing.tasks}ms ` +
      `(${r.api.length} API calls, ${r.totalApiWireMs}ms on the wire)`
  )
}
await browser.close()

// ---- report ----------------------------------------------------------------
const summary = {
  skeleton: median(runs.map(r => r.timing.skeleton)),
  app: median(runs.map(r => r.timing.app)),
  tasks: median(runs.map(r => r.timing.tasks)),
  totalApiWireMs: median(runs.map(r => r.totalApiWireMs))
}

console.log(`\n================ TIMING (median of ${RUNS}) ================`)
console.log(`  skeleton painted   ${summary.skeleton} ms`)
console.log(`  app mounted        ${summary.app} ms`)
console.log(`  tasks on screen    ${summary.tasks} ms`)
console.log(`  API time on wire   ${summary.totalApiWireMs} ms`)

const last = runs[runs.length - 1]
console.log('\n================ API WATERFALL (last run) ================')
for (const r of last.api) {
  console.log(
    `  ${r.status} ${String(r.wall).padStart(5)}ms  ${r.method.padEnd(5)} ${r.path.padEnd(40)} ` +
      `cc="${r.cacheControl}"${r.cfCache ? ` cf=${r.cfCache}` : ''}`
  )
}

console.log('\n================ DUPLICATE REQUESTS (last run) ================')
if (last.duplicates.length === 0) console.log('  (none)')
else for (const d of last.duplicates) console.log(`  ${d.count}×  ${d.call}`)

// ---- persist log -----------------------------------------------------------
// Timestamp comes from the OS clock via a child date call — Date.now() is fine
// in a plain script (unlike workflow scripts), so use it directly.
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = join(process.cwd(), '.profiler')
mkdirSync(outDir, { recursive: true })
const record = { origin: ORIGIN, path: PATH, runs: RUNS, at: new Date().toISOString(), summary, detail: runs }
const file = join(outDir, `cold-load-${stamp}.json`)
writeFileSync(file, JSON.stringify(record, null, 2))
writeFileSync(join(outDir, 'latest.json'), JSON.stringify(record, null, 2))
console.log(`\n📝 log written: ${file}`)
console.log(`   (also .profiler/latest.json)\n`)
