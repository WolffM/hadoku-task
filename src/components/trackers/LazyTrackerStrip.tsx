/**
 * A board's tracker strip, loaded on demand.
 *
 * Only wife tier and up have trackers, and the board only mounts this when it
 * has some (GET /boards' `trackerCount`) or one is being added, so its code is a
 * separate chunk instead of weight on every /task cold load: hadoku_site's
 * check:bundle-budgets refused the bump that inlined it.
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

const TrackerStrip = lazy(() => import('./TrackerStrip').then(m => ({ default: m.TrackerStrip })))

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
      <Suspense
        fallback={
          <section className="tracker-strip" aria-label="Trackers" data-testid="tracker-strip">
            <div className="tracker-strip__status">Loading trackers…</div>
          </section>
        }
      >
        <TrackerStrip {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
