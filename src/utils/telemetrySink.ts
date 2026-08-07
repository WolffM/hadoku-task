/**
 * Production telemetry sink.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two bugs shipped and survived for months without anyone noticing, and they
 * shared a signature: a value was RESOLVED AND THEN SILENTLY DISCARDED for a
 * default. A theme inherited from the host page was dropped because a bare
 * family token no longer normalized; a prefs migration never ran because an
 * empty row was mistaken for an unresolved one. Nothing threw. Nothing 500'd.
 * The app just quietly used the wrong value, and the only way to find either
 * was for a human to go looking.
 *
 * That class is hard to test — you have to imagine the failure before you can
 * write the assertion — and easy to observe, IF anything is listening. Until
 * now nothing was: `devLogSink` posts to the vite dev server and is gated on
 * `import.meta.env.DEV`, so production client logs went to `console` and died
 * there.
 *
 * DELIBERATELY NARROW
 * -------------------
 * `sinkMinLevel: 'warn'` — the logger's default. Degradation events are
 * authored as warns precisely so they land here; info/debug never leave the
 * browser. Expect a handful of events per session, not a stream.
 *
 * WHERE IT GOES
 * -------------
 * `/task/api/telemetry`, this app's own worker, NOT the monitoring ingest
 * directly: a browser is `friend` at best and often anonymous, and both are
 * 403 there. The worker relays with a service credential it never exposes.
 * See worker/src/routes/telemetry.ts.
 *
 * IT MUST NEVER BREAK THE APP
 * ---------------------------
 * Every failure path is swallowed. A telemetry pipeline that can take down the
 * thing it reports on is worse than no pipeline. The endpoint always answers
 * 204, so there is nothing to react to anyway.
 */
import { configureLogger } from '@wolffm/logger/client'

/** Same-origin, so the session cookie rides along and edge-router stamps the
 *  identity. Relative on purpose — never a *.hadoku.me subdomain. */
const RELAY_PATH = '/task/api/telemetry'

/** Matches the relay's own cap; batching past it would just be trimmed. */
const MAX_BATCH = 20
/** Coalesce bursts (a degrading boot can emit several at once) into one POST. */
const FLUSH_DELAY_MS = 2000

type SinkEvent = {
  level?: string
  type?: string
  message?: string
  context?: Record<string, unknown>
}

let queue: SinkEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null

function post(events: SinkEvent[], useBeacon: boolean): void {
  if (events.length === 0) return
  const payload = JSON.stringify({
    events: events.slice(0, MAX_BATCH).map(e => ({
      level: e.level === 'error' ? 'error' : 'warn',
      type: e.type,
      message: String(e.message ?? '').slice(0, 300),
      context: e.context
    }))
  })

  try {
    // On pagehide a normal fetch is cancelled mid-flight, which loses exactly
    // the events most worth having (the ones emitted as the tab dies).
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(RELAY_PATH, new Blob([payload], { type: 'application/json' }))
      return
    }
    void fetch(RELAY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      credentials: 'include',
      keepalive: true
    }).catch(() => {
      /* never let telemetry surface as an app error */
    })
  } catch {
    /* sendBeacon can throw on some payload types; losing an event is fine */
  }
}

function flush(useBeacon = false): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const batch = queue
  queue = []
  post(batch, useBeacon)
}

export function installTelemetrySink(): void {
  // Dev already has devLogSink pointed at the vite server; two sinks would
  // double-report and the relay has nowhere to forward locally anyway.
  if (import.meta.env.DEV) return
  if (typeof window === 'undefined') return

  configureLogger({
    sinkMinLevel: 'warn',
    telemetrySink: {
      push(event: SinkEvent) {
        try {
          // Bound the queue: a component erroring in a render loop must not
          // grow an unbounded array in the user's tab.
          if (queue.length >= MAX_BATCH) return
          queue.push(event)
          if (!timer) timer = setTimeout(() => flush(), FLUSH_DELAY_MS)
        } catch {
          /* logging must never throw */
        }
      }
    }
  })

  // pagehide, not unload: unload is unreliable on mobile Safari and blocks
  // bfcache. visibilitychange covers the tab-switch-then-never-return case.
  window.addEventListener('pagehide', () => flush(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true)
  })
}
