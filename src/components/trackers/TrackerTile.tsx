/**
 * One tracker as a tile. The tile's own button does the frequent thing in one
 * tap — +1 on a counter, "log a reading" on a value tracker — so a tracker
 * never has to be selected first. Tapping anywhere else on the tile opens that
 * tracker's detail: its history and the rarer actions.
 *
 * The open target is a real <button> layered under the content (which ignores
 * pointer events) and the action button sits above it: two sibling buttons,
 * never one nested in the other.
 */
import React from 'react'
import {
  counterTotalSince,
  formatTrackerNumber,
  startOfLocalDay,
  valueSummary
} from '../../domain/trackerStats'
import type { Tracker, TrackerEntry } from '../../domain/trackers'
import { TrackerTrend } from './TrackerTrend'

const FLASH_MS = 700

export interface TrackerTileProps {
  tracker: Tracker
  entries: TrackerEntry[]
  now: Date
  canWrite: boolean
  onIncrement: () => void
  onLogReading: () => void
  onOpen: () => void
}

export function TrackerTile({
  tracker,
  entries,
  now,
  canWrite,
  onIncrement,
  onLogReading,
  onOpen
}: TrackerTileProps) {
  const [flash, setFlash] = React.useState(false)
  const timer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  const isCounter = tracker.kind === 'counter'
  const today = counterTotalSince(entries, tracker.id, startOfLocalDay(now))

  const increment = () => {
    onIncrement()
    setFlash(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFlash(false), FLASH_MS)
  }

  return (
    <article
      className={`tracker-tile${flash ? ' tracker-tile--hit' : ''}`}
      data-testid="tracker-card"
      data-tracker={tracker.name}
    >
      <button
        type="button"
        className="tracker-tile__open"
        aria-label={`Open ${tracker.name}`}
        onClick={onOpen}
      />
      <div className="tracker-tile__body">
        <h3 className="tracker-tile__name">{tracker.name}</h3>
        {isCounter ? (
          <>
            <div className="tracker-tile__figure" data-testid="tracker-today">
              <span className="tracker-tile__number">{formatTrackerNumber(today)}</span>
              <span className="tracker-tile__unit">today</span>
            </div>
            <div className="tracker-tile__sub" data-testid="tracker-value">
              {formatTrackerNumber(tracker.value)}
              {tracker.unit ? ` ${tracker.unit}` : ''} total
            </div>
          </>
        ) : (
          <>
            <div className="tracker-tile__figure" data-testid="tracker-value">
              <span className="tracker-tile__number">{formatTrackerNumber(tracker.value)}</span>
              {tracker.unit && <span className="tracker-tile__unit">{tracker.unit}</span>}
            </div>
            <div className="tracker-tile__sub">{valueSummary(tracker, entries, now)}</div>
          </>
        )}
        <div className="tracker-tile__foot">
          <TrackerTrend
            tracker={tracker}
            entries={entries}
            now={now}
            days={7}
            className="tracker-tile__trend"
          />
          {/* Room for the action button, which sits above the open layer. */}
          {canWrite && <span className="tracker-tile__action-slot" />}
        </div>
      </div>
      {canWrite && (
        <button
          type="button"
          className="tracker-tile__action"
          aria-label={isCounter ? `Add one to ${tracker.name}` : `Log ${tracker.name}`}
          onClick={isCounter ? increment : onLogReading}
        >
          {isCounter ? '+1' : 'Log'}
        </button>
      )}
    </article>
  )
}
