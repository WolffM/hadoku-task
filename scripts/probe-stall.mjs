// Hunts the intermittent cold-load stall. Pre-warms the browser process, then
// runs N fresh-cache navigations, capturing full PerformanceResourceTiming +
// navigation phase breakdown. On each run prints time-to-app and the single
// slowest gap so we can see WHICH resource/phase eats the seconds.
import { chromium } from '@playwright/test'

const URL = process.argv[2] || 'https://hadoku.me/task'
const RUNS = Number(process.argv[3] || 5)
const browser = await chromium.launch()
{ const c = await browser.newContext(); const p = await c.newPage(); await p.goto('about:blank'); await c.close() }

async function run(n) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const t0 = Date.now()
  await page.goto(URL, { waitUntil: 'load' })
  let tSkeleton = null, tApp = null
  const deadline = Date.now() + 35000
  while (Date.now() < deadline && !tApp) {
    const s = await page.evaluate(() => ({
      skel: !!document.querySelector('.task-app-loading'),
      app: !!document.querySelector('.task-app-container'),
    }))
    if (s.skel && !tSkeleton) tSkeleton = Date.now()
    if (s.app && !tApp) tApp = Date.now()
    await page.waitForTimeout(15)
  }

  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const phases = nav ? {
      dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
      tcp: Math.round(nav.connectEnd - nav.connectStart),
      tls: nav.secureConnectionStart ? Math.round(nav.connectEnd - nav.secureConnectionStart) : 0,
      ttfb: Math.round(nav.responseStart - nav.requestStart),
      docDownload: Math.round(nav.responseEnd - nav.responseStart),
      dcl: Math.round(nav.domContentLoadedEventEnd),
    } : null
    const res = performance.getEntriesByType('resource').map(r => ({
      n: r.name.replace(/^https?:\/\//, '').split('?')[0],
      start: Math.round(r.startTime),
      end: Math.round(r.responseEnd),
      dur: Math.round(r.duration),
      stall: Math.round(r.requestStart ? r.requestStart - r.startTime : 0), // queue/connect wait
    }))
    return { phases, res }
  })

  console.log(`\n===== RUN ${n} : time→skeleton ${tSkeleton ? (tSkeleton - t0) : 'NEVER'}ms | time→app ${tApp ? (tApp - t0) : 'NEVER'}ms =====`)
  console.log('  doc phases:', JSON.stringify(data.phases))
  // top 8 resources by end time (the long pole tail)
  const tail = [...data.res].sort((a, b) => b.end - a.end).slice(0, 8)
  console.log('  longest-finishing resources:')
  for (const r of tail) {
    console.log('   ', String(r.start).padStart(6) + '→' + String(r.end).padStart(6) + 'ms',
      '(' + String(r.dur).padStart(5) + 'ms)', r.n.slice(0, 58))
  }
  await ctx.close()
  return { skel: tSkeleton ? tSkeleton - t0 : null, app: tApp ? tApp - t0 : null }
}

const xs = []
for (let i = 1; i <= RUNS; i++) xs.push(await run(i))
function summary(label, key) {
  const ok = xs.map(x => x[key]).filter(x => x != null).sort((a, b) => a - b)
  console.log(`\n===== SUMMARY (${label}) =====`)
  console.log('runs:', xs.map(x => x[key] == null ? 'FAIL' : x[key] + 'ms').join(', '))
  if (ok.length) console.log('min/median/max:', ok[0] + 'ms /', ok[Math.floor(ok.length/2)] + 'ms /', ok[ok.length-1] + 'ms')
}
summary('time→skeleton', 'skel')
summary('time→app', 'app')
await browser.close()
