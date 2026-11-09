/**
 * The "new tracker" dialog: a name, whether it counts or records a value, and
 * an optional unit. Stays open with what was typed when the create fails.
 */
import React from 'react'
import { Modal } from '@wolffm/task-ui-components'
import type { TrackerKind } from '../../domain/trackers'

export interface AddTrackerDialogProps {
  onAdd: (input: { name: string; kind: TrackerKind; unit: string | null }) => Promise<boolean>
  onClose: () => void
}

export function AddTrackerDialog({ onAdd, onClose }: AddTrackerDialogProps) {
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
      title="New tracker"
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
