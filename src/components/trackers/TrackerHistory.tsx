/**
 * The board's history log: every entry in the loaded window, newest first,
 * filterable to one tracker, each undoable.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import {
  formatDelta,
  formatTrackerNumber,
  formatWhen,
  type Tracker,
  type TrackerEntry
} from '../../domain/trackers'

const PAGE = 25

export interface TrackerHistoryProps {
  trackers: Tracker[]
  entries: TrackerEntry[]
  now: Date
  canWrite: boolean
  onUndo: (entry: TrackerEntry) => void
}

export function TrackerHistory({ trackers, entries, now, canWrite, onUndo }: TrackerHistoryProps) {
  const [filter, setFilter] = React.useState<string>('')
  const [shown, setShown] = React.useState(PAGE)
  const byId = new Map(trackers.map(t => [t.id, t]))
  const visible = entries.filter(e => byId.has(e.trackerId) && (!filter || e.trackerId === filter))

  return (
    <section className="tracker-history" aria-label="History">
      <header className="tracker-history__header">
        <h3 className="tracker-history__title">History</h3>
        {trackers.length > 1 && (
          <select
            className="tracker-input tracker-history__filter"
            aria-label="Show history for"
            value={filter}
            onChange={e => {
              setFilter(e.target.value)
              setShown(PAGE)
            }}
          >
            <option value="">All trackers</option>
            {trackers.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {visible.length === 0 ? (
        <p className="tracker-history__empty">Nothing logged in the last week.</p>
      ) : (
        <ol className="tracker-history__list">
          {visible.slice(0, shown).map(e => {
            const t = byId.get(e.trackerId) as Tracker
            const unit = t.unit ? ` ${t.unit}` : ''
            const change =
              e.delta === null
                ? `${formatTrackerNumber(e.value)}${unit}`
                : `${formatDelta(e.delta)}${unit}`
            return (
              <li key={e.id} className="tracker-history__item" data-testid="tracker-history-item">
                <span className="tracker-history__name">{t.name}</span>
                <span className="tracker-history__change">{change}</span>
                {e.note && <span className="tracker-history__note">{e.note}</span>}
                <span className="tracker-history__meta">
                  {e.source === 'button' && (
                    <span title="From a button">
                      <Icon name="zap" />
                    </span>
                  )}
                  <time dateTime={e.at} title={new Date(e.at).toLocaleString()}>
                    {formatWhen(e.at, now)}
                  </time>
                </span>
                {canWrite && (
                  <button
                    type="button"
                    className="tracker-icon-btn"
                    title="Undo this entry"
                    aria-label={`Undo ${t.name} ${change}`}
                    onClick={() => onUndo(e)}
                  >
                    <Icon name="undo" />
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {visible.length > shown && (
        <button type="button" className="tracker-btn" onClick={() => setShown(s => s + PAGE)}>
          Show more
        </button>
      )}
    </section>
  )
}
