/**
 * Dev-only local log sink.
 *
 * Mirrors EVERY @wolffm/logger entry (down to `debug`) to the vite dev server's
 * `/__devlog` endpoint, which appends them to `.dev-logs/actions.log` — so local
 * (public-mode, no edge-router) actions are tail-able:  `tail -f .dev-logs/actions.log`.
 *
 * Stays consistent with the "one logging system" rule: nothing logs directly to
 * a file — this is a sink on the single @wolffm/logger pipeline. `sinkMinLevel:
 * 'debug'` (added in @wolffm/logger@1.2.0) opens the sink to info/debug, which it
 * otherwise drops. The whole module is gated by `import.meta.env.DEV`, so it is
 * tree-shaken out of production bundles.
 */
import { configureLogger } from '@wolffm/logger/client'

export function installDevLogSink(): void {
  if (!import.meta.env.DEV) return

  configureLogger({
    sinkMinLevel: 'debug',
    telemetrySink: {
      push(event) {
        try {
          void fetch('/__devlog', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(event),
            keepalive: true
          })
        } catch {
          /* never let logging break the app */
        }
      }
    }
  })
}
