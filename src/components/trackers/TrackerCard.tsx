/**
 * One tracker: its current figure, today / 7-day context, and the controls to
 * change it. A counter gets −/+ and "set to"; a value tracker gets a number
 * field that logs a new reading.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import {
  counterTotalSince,
  entriesFor,
  formatDelta,
  formatTrackerNumber,
  formatWhen,
  startOfLocalDay,
  type Tracker,
  type TrackerEntry
} from '../../domain/trackers'

export interface TrackerCardProps {
  tracker: Tracker
  entries: TrackerEntry[]
  now: Date
  canWrite: boolean
  onLog: (body: { delta?: number; value?: number }) => void
  onRename: (patch: { name: string; unit: string | null }) => void
  onDelete: () => void
}

/** Parse a typed number; null for blank or junk. Accepts a comma decimal. */
function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function TrackerCard({
  tracker,
  entries,
  now,
  canWrite,
  onLog,
  onRename,
  onDelete
}: TrackerCardProps) {
  const [editing, setEditing] = React.useState(false)
  const [name, setName] = React.useState(tracker.name)
  const [unit, setUnit] = React.useState(tracker.unit ?? '')
  const [settingOpen, setSettingOpen] = React.useState(false)
  const [numberInput, setNumberInput] = React.useState('')

  const isCounter = tracker.kind === 'counter'
  const mine = entriesFor(entries, tracker.id)
  const unitLabel = tracker.unit ? ` ${tracker.unit}` : ''

  const submitNumber = (e: React.FormEvent) => {
    e.preventDefault()
    const n = parseNumber(numberInput)
    if (n === null) return
    onLog({ value: n })
    setNumberInput('')
    setSettingOpen(false)
  }

  const saveRename = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onRename({ name: name.trim(), unit: unit.trim() || null })
    setEditing(false)
  }

  let context: React.ReactNode
  if (isCounter) {
    const today = counterTotalSince(entries, tracker.id, startOfLocalDay(now))
    const week = counterTotalSince(entries, tracker.id, startOfLocalDay(now, 6))
    context = (
      <>
        <span data-testid="tracker-today">Today {formatDelta(today)}</span>
        <span aria-hidden="true">·</span>
        <span>7 days {formatDelta(week)}</span>
      </>
    )
  } else {
    const weekStart = startOfLocalDay(now, 6).getTime()
    const inWeek = mine.filter(e => Date.parse(e.at) >= weekStart)
    const oldest = inWeek[inWeek.length - 1]
    context =
      mine.length === 0 ? (
        <span>No readings yet</span>
      ) : (
        <>
          <span>Last {formatWhen(mine[0].at, now)}</span>
          {inWeek.length > 1 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                7 days {formatDelta(tracker.value - oldest.value)}
                {unitLabel}
              </span>
            </>
          )}
        </>
      )
  }

  return (
    <article className="tracker-card" data-testid="tracker-card" data-tracker={tracker.name}>
      {editing ? (
        <form className="tracker-card__rename" onSubmit={saveRename}>
          <input
            className="tracker-input"
            aria-label="Tracker name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={100}
            autoFocus
          />
          <input
            className="tracker-input tracker-input--unit"
            aria-label="Unit"
            placeholder="unit"
            value={unit}
            onChange={e => setUnit(e.target.value)}
            maxLength={20}
          />
          <div className="tracker-card__row">
            <button type="submit" className="tracker-btn tracker-btn--primary">
              Save
            </button>
            <button type="button" className="tracker-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <header className="tracker-card__header">
          <h3 className="tracker-card__name">{tracker.name}</h3>
          {canWrite && (
            <div className="tracker-card__tools">
              <button
                type="button"
                className="tracker-icon-btn"
                title="Rename"
                aria-label={`Rename ${tracker.name}`}
                onClick={() => {
                  setName(tracker.name)
                  setUnit(tracker.unit ?? '')
                  setEditing(true)
                }}
              >
                <Icon name="edit" />
              </button>
              <button
                type="button"
                className="tracker-icon-btn"
                title="Delete"
                aria-label={`Delete ${tracker.name}`}
                onClick={onDelete}
              >
                <Icon name="trash" />
              </button>
            </div>
          )}
        </header>
      )}

      <div className="tracker-card__value" data-testid="tracker-value">
        {formatTrackerNumber(tracker.value)}
        {tracker.unit && <span className="tracker-card__unit">{tracker.unit}</span>}
      </div>
      <div className="tracker-card__context">{context}</div>

      {canWrite && isCounter && (
        <div className="tracker-card__row">
          <button
            type="button"
            className="tracker-btn tracker-btn--step"
            aria-label={`Subtract one from ${tracker.name}`}
            onClick={() => onLog({ delta: -1 })}
          >
            <Icon name="minus" />
          </button>
          <button
            type="button"
            className="tracker-btn tracker-btn--primary tracker-btn--grow"
            aria-label={`Add one to ${tracker.name}`}
            onClick={() => onLog({ delta: 1 })}
          >
            <Icon name="plus" /> 1
          </button>
          <button
            type="button"
            className="tracker-btn"
            aria-expanded={settingOpen}
            onClick={() => setSettingOpen(o => !o)}
          >
            Set
          </button>
        </div>
      )}

      {canWrite && (!isCounter || settingOpen) && (
        <form className="tracker-card__row" onSubmit={submitNumber}>
          <input
            className="tracker-input"
            inputMode="decimal"
            aria-label={isCounter ? `Set ${tracker.name} to` : `New ${tracker.name} reading`}
            placeholder={isCounter ? 'Set count to…' : `New reading${unitLabel}`}
            value={numberInput}
            onChange={e => setNumberInput(e.target.value)}
          />
          <button
            type="submit"
            className="tracker-btn tracker-btn--primary"
            disabled={parseNumber(numberInput) === null}
          >
            {isCounter ? 'Set' : 'Log'}
          </button>
        </form>
      )}
    </article>
  )
}
