/**
 * The tracker board, loaded on demand.
 *
 * Only wife tier and up ever open a tracker board, so its code is a separate
 * chunk instead of weight on every /task cold load: hadoku_site's
 * check:bundle-budgets refused the bump that inlined it.
 *
 * A chunk is the one thing a stale page can lack. The entry is fetched as
 * index.js?v=<version> and cached immutable, but a tab left open across a
 * deploy still runs the old entry, and the deploy deleted the chunk it names.
 * The boundary turns that failed import into a reload prompt instead of a blank
 * board (the April 2026 calendar crash, 05c24b4, had no such fallback).
 */
import { lazy, Suspense, type ComponentProps } from 'react'
import { Icon } from '@wolffm/themes'
import { ErrorBoundary } from '../ErrorBoundary'

const TrackerBoard = lazy(() => import('./TrackerBoard').then(m => ({ default: m.TrackerBoard })))

type Props = ComponentProps<typeof TrackerBoard>

export function LazyTrackerBoard(props: Props) {
  return (
    <ErrorBoundary
      fallback={
        <div className="tracker-board" data-testid="tracker-board">
          <div className="tracker-board__status tracker-board__status--error" role="alert">
            Couldn't open {props.boardName}. The app may have been updated since this page loaded.
            <button type="button" className="tracker-btn" onClick={() => window.location.reload()}>
              <Icon name="refresh" /> Reload
            </button>
          </div>
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="tracker-board" data-testid="tracker-board">
            <div className="tracker-board__status">Loading trackers…</div>
          </div>
        }
      >
        <TrackerBoard {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
