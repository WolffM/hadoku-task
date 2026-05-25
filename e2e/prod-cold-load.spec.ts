import { test, expect, chromium, type Browser } from '@playwright/test'

/**
 * Production cold-load perf regression test.
 *
 * Runs N fresh-cache navigations against the deployed /task page and asserts
 * that the median time-to-skeleton and time-to-app are below budget. The
 * skeleton number is the load-bearing assertion: it should only pass if
 * the static skeleton is being served inline in the HTML (the Astro fix in
 * hadoku_site, commit 64aaf90 series). If the inline skeleton is reverted,
 * skeleton time will balloon back to whatever JS-mount takes (450ms+ from a
 * warm WSL probe; 2-3s on real cold mobile) and this test will fail.
 *
 * Opt-in: set RUN_PROD_PERF=1 to execute. Skipped otherwise so the standard
 * e2e suite doesn't accidentally beat on prod or fail in PR CI (where the
 * fix may not be deployed yet).
 *
 * Knobs:
 *   RUN_PROD_PERF=1                   — required, enables the suite
 *   TASK_PROD_ORIGIN=https://...      — defaults to https://hadoku.me
 *   TASK_PROD_RUNS=5                  — number of cold-cache runs (default 3)
 *   TASK_SKELETON_BUDGET_MS=400       — median skeleton budget (default 400)
 *   TASK_APP_BUDGET_MS=1500           — median app budget (default 1500)
 */

const ORIGIN = process.env.TASK_PROD_ORIGIN ?? 'https://hadoku.me'
const RUNS = Number(process.env.TASK_PROD_RUNS ?? 3)
const SKELETON_BUDGET_MS = Number(process.env.TASK_SKELETON_BUDGET_MS ?? 400)
const APP_BUDGET_MS = Number(process.env.TASK_APP_BUDGET_MS ?? 1500)
const NAV_TIMEOUT_MS = 30_000

type RunResult = {
  run: number
  skeleton: number | null
  app: number | null
  ttfb: number
  dcl: number
  fcp: number | null
  longest: Array<{ name: string; start: number; end: number; dur: number }>
  inlineSkeletonInHtml: boolean
  vendorReactPresent: boolean
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function measureColdLoad(browser: Browser, run: number): Promise<RunResult> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()

  // Capture raw HTML response to verify the static skeleton ships inline.
  let htmlResponse: string | null = null
  page.on('response', async res => {
    if (htmlResponse !== null) return
    const url = res.url()
    if (url.endsWith('/task/') || url.endsWith('/task')) {
      try {
        htmlResponse = await res.text()
      } catch {
        // ignore — some redirects don't expose body
      }
    }
  })

  // Tight-poll for the skeleton + app in parallel with the navigation. We use
  // polling instead of a page-side MutationObserver (registered via
  // addInitScript) because Playwright's init-script hook runs in a wrapped
  // context where the observer doesn't see DOM mutations from the parser —
  // verified empirically with observerFired=0 over multiple seconds of
  // mutations. Polling is what probe-stall.mjs does and what reliably works.
  //
  // 10ms granularity is fine for our scale (skeleton budget is 400ms).
  const t0 = Date.now()
  let tSkeleton: number | null = null
  let tApp: number | null = null
  const pollDeadline = t0 + NAV_TIMEOUT_MS
  const pollPromise = (async () => {
    while (Date.now() < pollDeadline && tApp === null) {
      try {
        const state = await page.evaluate(() => ({
          skel: !!document.querySelector('.task-app-loading'),
          app: !!document.querySelector('.task-app-container')
        }))
        const now = Date.now()
        if (state.skel && tSkeleton === null) tSkeleton = now - t0
        if (state.app && tApp === null) tApp = now - t0
      } catch {
        // Page may be navigating — retry on next tick.
      }
      if (tApp !== null) break
      await new Promise(r => setTimeout(r, 10))
    }
  })()

  await page.goto(`${ORIGIN}/task/`, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS })
  await pollPromise

  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    const paint = performance.getEntriesByType('paint')
    const fcp = paint.find(p => p.name === 'first-contentful-paint')?.startTime ?? null
    const ttfb = nav ? Math.round(nav.responseStart - nav.requestStart) : 0
    const dcl = nav ? Math.round(nav.domContentLoadedEventEnd) : 0
    const resources = performance
      .getEntriesByType('resource')
      .map(r => ({
        name: r.name.replace(/^https?:\/\//, '').split('?')[0],
        start: Math.round(r.startTime),
        end: Math.round((r as PerformanceResourceTiming).responseEnd),
        dur: Math.round(r.duration)
      }))
      .sort((a, b) => b.end - a.end)
      .slice(0, 6)
    return { ttfb, dcl, fcp, resources }
  })

  await ctx.close()

  return {
    run,
    skeleton: tSkeleton,
    app: tApp,
    ttfb: data.ttfb,
    dcl: data.dcl,
    fcp: data.fcp === null ? null : Math.round(data.fcp),
    longest: data.resources,
    inlineSkeletonInHtml:
      htmlResponse !== null && /class=("|')task-app-loading\b/.test(htmlResponse),
    vendorReactPresent:
      htmlResponse !== null && /\/mf\/vendor\/react(-dom)?\.mjs/.test(htmlResponse)
  }
}

function printRun(r: RunResult): void {
  const fmt = (n: number | null) => (n === null ? 'NEVER' : `${n}ms`)

  console.log(
    `  run ${r.run}: skeleton=${fmt(r.skeleton).padStart(7)}  app=${fmt(r.app).padStart(7)}  ` +
      `ttfb=${r.ttfb}ms  dcl=${r.dcl}ms  fcp=${fmt(r.fcp)}`
  )
  for (const res of r.longest) {
    console.log(
      `     ${String(res.start).padStart(5)}→${String(res.end).padStart(5)}ms  ${res.name}`
    )
  }
}

test.describe('Production cold-load performance', () => {
  // Opt-in only — this test hits prod. Default pnpm test:e2e ignores it.
  test.skip(
    () => !process.env.RUN_PROD_PERF,
    'set RUN_PROD_PERF=1 to run prod cold-load perf checks'
  )

  // Runs must be serial — parallel browser contexts skew TCP/DNS warm state.
  test.describe.configure({ mode: 'serial' })

  let browser: Browser

  test.beforeAll(async () => {
    browser = await chromium.launch()
    // Warm browser process (unmeasured) so we measure cold *page* cache, not
    // cold chromium-process boot.
    const c = await browser.newContext()
    const p = await c.newPage()
    await p.goto('about:blank')
    await c.close()
  })

  test.afterAll(async () => {
    await browser.close()
  })

  test(`cold load: skeleton < ${SKELETON_BUDGET_MS}ms, app < ${APP_BUDGET_MS}ms (median of ${RUNS})`, async () => {
    test.setTimeout((NAV_TIMEOUT_MS + 10_000) * RUNS)

    const results: RunResult[] = []
    for (let i = 1; i <= RUNS; i++) {
      results.push(await measureColdLoad(browser, i))
    }

    console.log(`\n===== ${ORIGIN}/task/  (${RUNS} cold-cache runs) =====`)
    results.forEach(printRun)

    const skeletonValues = results.map(r => r.skeleton).filter((v): v is number => v !== null)
    const appValues = results.map(r => r.app).filter((v): v is number => v !== null)
    const medSkeleton = median(skeletonValues)
    const medApp = median(appValues)
    const inlineSkeletonHits = results.filter(r => r.inlineSkeletonInHtml).length
    const vendorReactHits = results.filter(r => r.vendorReactPresent).length

    console.log(`\n  median skeleton: ${medSkeleton}ms  (budget ${SKELETON_BUDGET_MS}ms)`)
    console.log(`  median app:      ${medApp}ms  (budget ${APP_BUDGET_MS}ms)`)
    console.log(`  HTML carries inline skeleton in ${inlineSkeletonHits}/${results.length} runs`)
    console.log(`  HTML references /mf/vendor/react in ${vendorReactHits}/${results.length} runs`)

    // Structural invariants: these prove the deployed HTML actually contains
    // the fixes, independent of timing variance. If they fail, the timing
    // assertions below will also fail — but the structural failure tells us
    // exactly *why* (deploy hasn't shipped vs. real perf regression).
    expect(
      inlineSkeletonHits,
      'every /task HTML response should contain the inline .task-app-loading skeleton'
    ).toBe(results.length)
    expect(
      vendorReactHits,
      'every /task HTML response should reference /mf/vendor/react*.mjs in the importmap/modulepreload'
    ).toBe(results.length)

    // Timing assertions.
    expect(skeletonValues.length, 'at least one run must produce a skeleton time').toBeGreaterThan(
      0
    )
    expect(appValues.length, 'at least one run must produce an app time').toBeGreaterThan(0)
    expect(medSkeleton).toBeLessThanOrEqual(SKELETON_BUDGET_MS)
    expect(medApp).toBeLessThanOrEqual(APP_BUDGET_MS)
  })
})
