/**
 * A tracker's recent shape: a bar per day for a counter (today's bar
 * highlighted), a line through the readings for a value tracker.
 */
import {
  dailyTotals,
  formatTrackerNumber,
  readingsSince,
  startOfLocalDay
} from '../../domain/trackerStats'
import type { Tracker, TrackerEntry } from '../../domain/trackers'

export interface TrackerTrendProps {
  tracker: Tracker
  entries: TrackerEntry[]
  now: Date
  days: number
  className?: string
}

export function TrackerTrend({ tracker, entries, now, days, className = '' }: TrackerTrendProps) {
  if (tracker.kind === 'counter') {
    const totals = dailyTotals(entries, tracker.id, now, days)
    const max = Math.max(1, ...totals)
    return (
      <div
        className={`tracker-trend tracker-trend--bars ${className}`.trim()}
        role="img"
        aria-label={`${tracker.name}, last ${days} days: ${totals.map(formatTrackerNumber).join(', ')}`}
      >
        {totals.map((n, i) => (
          <span
            key={i}
            className={`tracker-trend__bar${i === days - 1 ? ' tracker-trend__bar--today' : ''}`}
            style={{ height: `${Math.max(0, n / max) * 100}%` }}
          />
        ))}
      </div>
    )
  }

  const readings = readingsSince(entries, tracker.id, startOfLocalDay(now, days - 1))
  if (readings.length < 2) return <div className={`tracker-trend ${className}`.trim()} />
  const lo = Math.min(...readings)
  const span = Math.max(...readings) - lo || 1
  const points = readings
    .map((v, i) => `${(i / (readings.length - 1)) * 100},${28 - ((v - lo) / span) * 26}`)
    .join(' ')
  return (
    <svg
      className={`tracker-trend tracker-trend--line ${className}`.trim()}
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${tracker.name}, readings over the last ${days} days: ${readings.map(formatTrackerNumber).join(', ')}`}
    >
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
