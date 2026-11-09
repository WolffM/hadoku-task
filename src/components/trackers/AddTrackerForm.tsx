/**
 * The "add a tracker" card: a name, whether it counts or records a value, and
 * an optional unit.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import type { TrackerKind } from '../../domain/trackers'

export interface AddTrackerFormProps {
  onAdd: (input: { name: string; kind: TrackerKind; unit: string | null }) => Promise<boolean>
}

export function AddTrackerForm({ onAdd }: AddTrackerFormProps) {
  const [name, setName] = React.useState('')
  const [kind, setKind] = React.useState<TrackerKind>('counter')
  const [unit, setUnit] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    const ok = await onAdd({ name: name.trim(), kind, unit: unit.trim() || null })
    setBusy(false)
    if (ok) {
      setName('')
      setUnit('')
    }
  }

  return (
    <form className="tracker-card tracker-card--add" onSubmit={submit} aria-label="Add a tracker">
      <h3 className="tracker-card__name">New tracker</h3>
      <input
        className="tracker-input"
        aria-label="New tracker name"
        placeholder="Pushups, water, weight…"
        value={name}
        onChange={e => setName(e.target.value)}
        maxLength={100}
      />
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
      <input
        className="tracker-input"
        aria-label="New tracker unit"
        placeholder={kind === 'value' ? 'Unit (kg, lb…)' : 'Unit (optional)'}
        value={unit}
        onChange={e => setUnit(e.target.value)}
        maxLength={20}
      />
      <button
        type="submit"
        className="tracker-btn tracker-btn--primary"
        disabled={!name.trim() || busy}
      >
        <Icon name="plus" /> Add tracker
      </button>
    </form>
  )
}
