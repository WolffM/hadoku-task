/**
 * A board's tracker strip, in its own chunk.
 *
 * Only wife tier and up have trackers, so its code is a separate chunk instead
 * of weight on every /task cold load: hadoku_site's check:bundle-budgets refused
 * the bump that inlined it. It is still never a wait the user sees: App calls
 * `preloadTrackerStrip()` once the core page has rendered (for a tier that can
 * use it), so by the time anyone clicks the Widget button the chunk is in. The
 * Suspense fallback is therefore empty — no inline "loading" row.
 *
 * A chunk is the one thing a stale page can lack. The entry is fetched as
 * index.js?v=<version> and cached immutable, but a tab left open across a
 * deploy still runs the old entry, and the deploy deleted the chunk it names.
 * The boundary turns that failed import into a reload prompt instead of a
 * blank strip (the April 2026 calendar crash, 05c24b4, had no such fallback).
 */
import { lazy, Suspense, type ComponentProps } from 'react'
import { Icon } from '@wolffm/themes'
import { ErrorBoundary } from '../ErrorBoundary'

let chunk: Promise<typeof import('./TrackerStrip')> | undefined

/**
 * Start fetching the strip's chunk; later calls reuse the same request. A
 * failed fetch is forgotten, so the next call (the lazy mount) tries again.
 */
export function preloadTrackerStrip() {
  chunk ??= import('./TrackerStrip').catch((err: unknown) => {
    chunk = undefined
    throw err
  })
  return chunk
}

const TrackerStrip = lazy(() => preloadTrackerStrip().then(m => ({ default: m.TrackerStrip })))

type Props = ComponentProps<typeof TrackerStrip>

export function LazyTrackerStrip(props: Props) {
  return (
    <ErrorBoundary
      fallback={
        <section className="tracker-strip" aria-label="Trackers" data-testid="tracker-strip">
          <div className="tracker-strip__status tracker-strip__status--error" role="alert">
            Couldn't load the trackers. The app may have been updated since this page loaded.
            <button type="button" className="tracker-btn" onClick={() => window.location.reload()}>
              <Icon name="refresh" /> Reload
            </button>
          </div>
        </section>
      }
    >
      <Suspense fallback={null}>
        <TrackerStrip {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
