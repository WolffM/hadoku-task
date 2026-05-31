// Telemetry probe: confirm the static-skeleton -> blank -> React-skeleton handoff
// on a cold load of /task/. Distinguishes the two skeletons by data-dark-theme:
//   - static (Astro inline): <div class="task-app-loading">  (NO data-dark-theme)
//   - React  (LoadingSkeleton): always has data-dark-theme="true|false"
//   - real app: .task-app-container
//
// Records a per-animation-frame timeline in-page (rAF reads live DOM; this is a
// read, not a MutationObserver, so it works from an init-script context).
//
// Usage: node e2e/probe-double-skeleton.mjs [origin] [runs]
import { chromium } from '@playwright/test'

const ORIGIN = process.argv[2] ?? 'https://hadoku.me'
const RUNS = Number(process.argv[3] ?? 3)

const INIT = `
  window.__frames = [];
  const t0 = performance.now();
  function classify() {
    const app = document.querySelector('.task-app-container');
    if (app) return 'APP';
    const skel = document.querySelector('.task-app-loading');
    if (!skel) return 'BLANK';
    return skel.hasAttribute('data-dark-theme') ? 'REACT_SKEL' : 'STATIC_SKEL';
  }
  function tick() {
    const s = classify();
    const f = window.__frames;
    if (f.length === 0 || f[f.length - 1].state !== s) {
      f.push({ state: s, t: Math.round(performance.now() - t0) });
    }
    if (s !== 'APP') requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
`

function summarize(frames) {
  // collapse to transition list, then look for STATIC -> (BLANK) -> REACT pattern
  const seq = frames.map(f => `${f.state}@${f.t}ms`).join('  ->  ')
  const states = frames.map(f => f.state)
  const sawStatic = states.includes('STATIC_SKEL')
  const sawReact = states.includes('REACT_SKEL')
  // blank that occurs AFTER a skeleton and BEFORE the app = the flash
  let blankFlash = null
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].state === 'BLANK' && frames[i - 1].state.endsWith('SKEL')) {
      const next = frames[i + 1]
      blankFlash = { start: frames[i].t, end: next ? next.t : null, prev: frames[i - 1].state }
      break
    }
  }
  return { seq, sawStatic, sawReact, doubleSkeleton: sawStatic && sawReact, blankFlash }
}

const browser = await chromium.launch()
console.log(`\n===== double-skeleton probe: ${ORIGIN}/task/  (${RUNS} cold runs) =====\n`)
for (let i = 1; i <= RUNS; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(INIT)
  const page = await ctx.newPage()
  await page.goto(`${ORIGIN}/task/`, { waitUntil: 'load', timeout: 30000 })
  // wait until app shows or 8s
  await page
    .waitForFunction(() => window.__frames?.some(f => f.state === 'APP'), { timeout: 8000 })
    .catch(() => {})
  const frames = await page.evaluate(() => window.__frames)
  const r = summarize(frames)
  console.log(`run ${i}:`)
  console.log(`  timeline: ${r.seq}`)
  console.log(
    `  static-skeleton seen: ${r.sawStatic}   react-skeleton seen: ${r.sawReact}   DOUBLE: ${r.doubleSkeleton}`
  )
  if (r.blankFlash) {
    const dur = r.blankFlash.end !== null ? `${r.blankFlash.end - r.blankFlash.start}ms` : '(open)'
    console.log(
      `  BLANK FLASH after ${r.blankFlash.prev}: ${r.blankFlash.start}ms..${r.blankFlash.end}ms  (~${dur})`
    )
  } else {
    console.log(`  BLANK FLASH: none detected`)
  }
  console.log('')
  await ctx.close()
}
await browser.close()
