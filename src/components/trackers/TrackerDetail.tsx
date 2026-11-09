/**
 * One tracker, opened from its tile: the figure, a 14-day trend, every control
 * (−1/+1/set for a counter, a new reading for a value tracker), its own history
 * grouped by day with undo, and rename / delete.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import { Modal } from '@wolffm/task-ui-components'
import {
  counterSummary,
  describeEntry,
  entriesFor,
  formatClock,
  formatDay,
  formatTrackerNumber,
  groupByDay,
  parseTrackerNumber,
  valueSummary
} from '../../domain/trackerStats'
import type { Tracker, TrackerEntry } from '../../domain/trackers'
import { TrackerTrend } from './TrackerTrend'

export interface TrackerDetailProps {
  tracker: Tracker
  entries: TrackerEntry[]
  now: Date
  canWrite: boolean
  onLog: (body: { delta?: number; value?: number }) => void
  onUndo: (entry: TrackerEntry) => void
  onRename: (patch: { name: string; unit: string | null }) => void
  onDelete: () => void
  onClose: () => void
}

export function TrackerDetail({
  tracker,
  entries,
  now,
  canWrite,
  onLog,
  onUndo,
  onRename,
  onDelete,
  onClose
}: TrackerDetailProps) {
  const [numberInput, setNumberInput] = React.useState('')
  const [renaming, setRenaming] = React.useState(false)
  const [name, setName] = React.useState(tracker.name)
  const [unit, setUnit] = React.useState(tracker.unit ?? '')

  const isCounter = tracker.kind === 'counter'
  const mine = entriesFor(entries, tracker.id)
  const typed = parseTrackerNumber(numberInput)

  const submitNumber = (e: React.FormEvent) => {
    e.preventDefault()
    if (typed === null) return
    onLog({ value: typed })
    setNumberInput('')
  }

  const saveRename = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onRename({ name: name.trim(), unit: unit.trim() || null })
    setRenaming(false)
  }

  return (
    <Modal
      isOpen
      title={tracker.name}
      onClose={onClose}
      className="tracker-detail"
      actions={
        <div className="modal-actions tracker-detail__actions">
          {canWrite && !renaming && (
            <>
              <button
                type="button"
                className="modal-button"
                onClick={() => {
                  setName(tracker.name)
                  setUnit(tracker.unit ?? '')
                  setRenaming(true)
                }}
              >
                <Icon name="edit" /> Rename
              </button>
              <button
                type="button"
                className="modal-button modal-button--danger"
                onClick={onDelete}
              >
                <Icon name="trash" /> Delete
              </button>
            </>
          )}
          <span className="tracker-detail__spacer" />
          <button type="button" className="modal-button" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {renaming && (
        <form className="tracker-detail__rename" onSubmit={saveRename}>
          <label className="tracker-field">
            <span>Name</span>
            <input
              className="tracker-input"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
              autoFocus
            />
          </label>
          <label className="tracker-field">
            <span>Unit</span>
            <input
              className="tracker-input"
              value={unit}
              onChange={e => setUnit(e.target.value)}
              maxLength={20}
            />
          </label>
          <div className="tracker-detail__row">
            <button type="submit" className="tracker-btn tracker-btn--primary">
              Save
            </button>
            <button type="button" className="tracker-btn" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="tracker-detail__figure" data-testid="tracker-detail-value">
        <span className="tracker-detail__number">{formatTrackerNumber(tracker.value)}</span>
        {tracker.unit && <span className="tracker-detail__unit">{tracker.unit}</span>}
      </div>
      <div className="tracker-detail__summary">
        {isCounter ? counterSummary(tracker, entries, now) : valueSummary(tracker, entries, now)}
      </div>
      <TrackerTrend
        tracker={tracker}
        entries={entries}
        now={now}
        days={14}
        className="tracker-detail__trend"
      />

      {canWrite && (
        <div className="tracker-detail__controls">
          {isCounter && (
            <>
              <button
                type="button"
                className="tracker-btn tracker-btn--step"
                aria-label={`Subtract one from ${tracker.name}`}
                onClick={() => onLog({ delta: -1 })}
              >
                −1
              </button>
              <button
                type="button"
                className="tracker-btn tracker-btn--primary tracker-btn--step"
                aria-label={`Add one to ${tracker.name}`}
                onClick={() => onLog({ delta: 1 })}
              >
                +1
              </button>
            </>
          )}
          <form className="tracker-detail__set" onSubmit={submitNumber}>
            <input
              className="tracker-input"
              inputMode="decimal"
              aria-label={isCounter ? `Set ${tracker.name} to` : `New ${tracker.name} reading`}
              placeholder={
                isCounter
                  ? 'Set total to…'
                  : `New reading${tracker.unit ? ` (${tracker.unit})` : ''}`
              }
              value={numberInput}
              onChange={e => setNumberInput(e.target.value)}
            />
            <button type="submit" className="tracker-btn" disabled={typed === null}>
              {isCounter ? 'Set' : 'Log'}
            </button>
          </form>
        </div>
      )}

      <section className="tracker-log" aria-label={`${tracker.name} history`}>
        {mine.length === 0 ? (
          <p className="tracker-log__empty">Nothing logged in the last week.</p>
        ) : (
          groupByDay(mine).map(group => (
            <div key={group.day.getTime()} className="tracker-log__day">
              <h4 className="tracker-log__heading">{formatDay(group.day, now)}</h4>
              <ol className="tracker-log__list">
                {group.entries.map(e => (
                  <li key={e.id} className="tracker-log__item" data-testid="tracker-history-item">
                    <time className="tracker-log__time" dateTime={e.at}>
                      {formatClock(e.at)}
                    </time>
                    <span className="tracker-log__change">{describeEntry(e, tracker.unit)}</span>
                    {e.note && <span className="tracker-log__note">{e.note}</span>}
                    {e.source === 'button' && (
                      <span className="tracker-log__source" title="From a button">
                        <Icon name="zap" />
                      </span>
                    )}
                    {canWrite && (
                      <button
                        type="button"
                        className="tracker-icon-btn"
                        title="Undo this entry"
                        aria-label={`Undo ${tracker.name} ${describeEntry(e, tracker.unit)}`}
                        onClick={() => onUndo(e)}
                      >
                        <Icon name="undo" />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))
        )}
      </section>
    </Modal>
  )
}
