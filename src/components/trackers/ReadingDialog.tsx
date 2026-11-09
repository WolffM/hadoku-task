/**
 * Log a new reading on a value tracker — what a value tile's Log button opens.
 */
import React from 'react'
import { Modal } from '@wolffm/task-ui-components'
import { parseTrackerNumber } from '../../domain/trackerStats'
import type { Tracker } from '../../domain/trackers'

export interface ReadingDialogProps {
  tracker: Tracker
  onLog: (value: number) => void
  onClose: () => void
}

export function ReadingDialog({ tracker, onLog, onClose }: ReadingDialogProps) {
  const [raw, setRaw] = React.useState('')
  const value = parseTrackerNumber(raw)
  const submit = () => {
    if (value === null) return
    onLog(value)
    onClose()
  }
  return (
    <Modal
      isOpen
      title={`Log ${tracker.name}`}
      onClose={onClose}
      onConfirm={submit}
      confirmLabel="Log"
      confirmDisabled={value === null}
      className="tracker-dialog"
    >
      <form
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="tracker-field">
          <span>New reading{tracker.unit ? ` (${tracker.unit})` : ''}</span>
          <input
            className="tracker-input"
            inputMode="decimal"
            value={raw}
            onChange={e => setRaw(e.target.value)}
          />
        </label>
      </form>
    </Modal>
  )
}
