# Profiling the task app

How to measure cold-load performance and catch regressions. This is the
repeatable version of the investigation that produced the [#63 load
parallelisation](https://github.com/WolffM/hadoku-task/pull/63) and the
[#194 whoami dedupe](https://github.com/WolffM/hadoku_site/pull/194).

If the ask is just "profile the task app", run the profiler below and read the
summary — it prints timing, the API waterfall, and any duplicate requests, and
writes a diffable JSON log.

## The profiler

```bash
pnpm run profile                          # 5 cold-cache runs vs https://hadoku.me
pnpm run profile -- --runs 10
pnpm run profile -- --origin http://localhost:5199 --path /task/   # local dev build
TASK_KEY=friend-<uuid> pnpm run profile   # use a specific friend key
```

Source: [`scripts/profile-cold-load.mjs`](../scripts/profile-cold-load.mjs).

It authenticates once through the real key flow (so the `hadoku_session` cookie
is set and the **authenticated** path is exercised — not the anonymous path,
which never fetches boards), then measures N navigations with a **cold HTTP
cache but warm session**. That's the returning-user cold load, where the latency
actually lives.

Per run it captures:

- **time to skeleton / app mount / first task on screen** — `tasks` is the one
  that matters; it's when the user sees real data.
- **the API waterfall** — every `/task`, `/prefs`, `/session` call with wall
  time, TTFB, and cache headers (`Cache-Control`, `cf-cache-status`).
- **duplicate requests** — any `METHOD path` fetched more than once. This is how
  the double `/session/whoami` was found.

### Output

Human summary to stdout, plus a timestamped JSON log under `.profiler/`
(gitignored), with `.profiler/latest.json` always pointing at the newest run.
The logs are structured for diffing across runs — e.g. before/after a deploy:

```bash
pnpm run profile && cp .profiler/latest.json .profiler/before.json
# ... deploy ...
pnpm run profile
node -e "const b=require('./.profiler/before.json').summary, a=require('./.profiler/latest.json').summary; console.table({before:b, after:a})"
```

## Deeper profiling

For questions the standard run doesn't answer, drive Playwright + CDP directly
(the profiler is a plain script — copy and extend it):

- **Where does a request come from?** Capture initiator stacks via CDP
  `Network.requestWillBeSent` → `e.initiator.stack.callFrames`. This is how the
  second whoami was traced to `@wolffm/prefs-client` (vs the shell's `mf-loader`).
- **How many times does a component render?** Temporarily increment a
  `window.__renders` counter at the top of the component, drive the flow, read it
  back with `page.evaluate`. Remove the instrumentation before committing. Cold
  load was 7 App renders, board switch +4, idle +0 — all healthy.
- **Server-side latency** (e.g. the KV round-trips inside the handshake): boot the
  real worker handler against an in-memory KV that simulates CF latency (~40ms
  read / ~150ms write) and record an op timeline. This is how the handshake was
  shown to drop 1180ms → 582ms by parallelising independent KV ops.

## Regression guards (in CI, no prod needed)

Two committed e2e specs pin the wins so they can't silently regress. Both use
stubbed prod-median latencies and run in the normal suite:

- [`e2e/cold-load-serialization.spec.ts`](../e2e/cold-load-serialization.spec.ts)
  — asserts handshake / prefs / boards are issued **concurrently**. It checks
  request _ordering_ (boards and prefs must fire before the handshake response
  arrives), not a latency budget, so it's immune to CI load. Fails on the old
  serial code.
- [`e2e/prod-cold-load.spec.ts`](../e2e/prod-cold-load.spec.ts) — opt-in
  (`RUN_PROD_PERF=1`), asserts median skeleton < 400ms and app < 1500ms against
  live prod, and that the inline skeleton still ships in the HTML.

## Baseline (2026-07, authenticated cold load vs hadoku.me)

| Metric                | Before #63 | After #63  |
| --------------------- | ---------- | ---------- |
| tasks on screen       | 776 ms     | **246 ms** |
| `session/handshake`   | 577 ms     | **304 ms** |
| total API on the wire | 2003 ms    | 998 ms     |

The load chain used to be serial (`handshake → prefs → boards`); #63 made the
three concurrent, and parallelised the handshake's KV ops server-side.

**Known open item:** `GET /session/whoami` is fetched twice on boot — the shell
(`mf-loader`) and `@wolffm/prefs-client` each resolve it. Fixed by
[hadoku_site #194](https://github.com/WolffM/hadoku_site/pull/194); the profiler
flags it under "duplicate requests" until that ships everywhere.
