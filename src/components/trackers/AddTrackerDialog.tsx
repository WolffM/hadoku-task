/**
 * "Add a widget": the new tracker form — a name, whether it counts or records a
 * value, and an optional unit. Stays open with what was typed when the create
 * fails. When the caller can also add a sequence, a widget-type choice at the
 * top switches to the exercise library (the strip opens it).
 */
import React from 'react'
import { Modal } from '@wolffm/task-ui-components'
import type { TrackerKind } from '../../domain/trackers'

export interface AddTrackerDialogProps {
  onAdd: (input: { name: string; kind: TrackerKind; unit: string | null }) => Promise<boolean>
  onClose: () => void
  /** Offer "Sequence" as the widget type. Absent ⇒ trackers only. */
  onChooseSequence?: () => void
}

export function AddTrackerDialog({ onAdd, onClose, onChooseSequence }: AddTrackerDialogProps) {
  const [name, setName] = React.useState('')
  const [kind, setKind] = React.useState<TrackerKind>('counter')
  const [unit, setUnit] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    const ok = await onAdd({ name: name.trim(), kind, unit: unit.trim() || null })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      isOpen
      title="Add a widget"
      onClose={onClose}
      onConfirm={submit}
      confirmLabel="Add tracker"
      confirmDisabled={!name.trim() || busy}
      className="tracker-dialog"
    >
      <form
        className="tracker-dialog__form"
        aria-label="Add a tracker"
        onSubmit={e => {
          e.preventDefault()
          void submit()
        }}
      >
        {onChooseSequence && (
          <div className="tracker-kind" role="radiogroup" aria-label="Widget type">
            <button
              type="button"
              role="radio"
              aria-checked
              className="tracker-kind__option tracker-kind__option--active"
            >
              Tracker
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={false}
              title="A workout: exercises played in order, with a timer"
              className="tracker-kind__option"
              onClick={onChooseSequence}
            >
              Sequence
            </button>
          </div>
        )}
        <p className="tracker-dialog__kind">
          <strong>Tracker</strong> · count something, or log a reading. It sits above the board's
          lanes.
        </p>
        <label className="tracker-field">
          <span>Name</span>
          <input
            className="tracker-input"
            aria-label="New tracker name"
            placeholder="Pushups, water, weight…"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={100}
          />
        </label>
        <div className="tracker-kind" role="radiogroup" aria-label="Tracker type">
          {(
            [
              ['counter', 'Count', 'Each entry adds to the total'],
              ['value', 'Value', 'Each entry records a reading, like a weight']
            ] as const
          ).map(([k, label, hint]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              title={hint}
              className={`tracker-kind__option${kind === k ? ' tracker-kind__option--active' : ''}`}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="tracker-field">
          <span>Unit</span>
          <input
            className="tracker-input"
            aria-label="New tracker unit"
            placeholder={kind === 'value' ? 'kg, lb…' : 'optional'}
            value={unit}
            onChange={e => setUnit(e.target.value)}
            maxLength={20}
          />
        </label>
      </form>
    </Modal>
  )
}
