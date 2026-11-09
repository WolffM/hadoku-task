/**
 * CreateBoardModal component
 * Modal dialog for creating a new board
 */

import React from 'react'
import { Modal } from '@wolffm/task-ui-components'
import type { PendingTaskOperation } from '../../hooks/useModalState'

export interface CreateBoardModalProps {
  isOpen: boolean
  inputValue: string
  validationError: string | null
  pendingTaskOperation: PendingTaskOperation | null
  onClose: () => void
  onConfirm: (boardName: string, kind: BoardKind) => Promise<void>
  onInputChange: (value: string) => void
  validateBoardName: (name: string) => string | null
  /** Offer the tracker board type (wife tier and up). */
  allowTracker?: boolean
}

export type BoardKind = 'standard' | 'tracker'

const KINDS: ReadonlyArray<readonly [BoardKind, string, string]> = [
  ['standard', 'Tasks', 'A board of tasks'],
  ['tracker', 'Tracker', 'Counters and readings, with a history log']
]

export function CreateBoardModal({
  isOpen,
  inputValue,
  validationError,
  pendingTaskOperation,
  onClose,
  onConfirm,
  onInputChange,
  validateBoardName,
  allowTracker = false
}: CreateBoardModalProps) {
  const [kind, setKind] = React.useState<BoardKind>('standard')
  // Moving tasks onto a new board only makes sense for a task board.
  const movingTasks =
    pendingTaskOperation?.type === 'move-to-board' && pendingTaskOperation.taskIds.length > 0
  const offerKinds = allowTracker && !movingTasks
  const chosen: BoardKind = offerKinds ? kind : 'standard'

  React.useEffect(() => {
    if (isOpen) setKind('standard')
  }, [isOpen])

  const handleConfirm = async () => {
    if (!inputValue.trim()) return

    const error = validateBoardName(inputValue)
    if (error) return // Validation error will be shown

    await onConfirm(inputValue, chosen)
  }

  // Say WHY Create is disabled as you type: a duplicate name used to just grey
  // the button out, which read as the app refusing for no reason.
  const liveError = inputValue.trim() ? validateBoardName(inputValue) : null
  const isDisabled = !inputValue.trim() || liveError !== null
  const shownError = validationError ?? liveError

  return (
    <Modal
      isOpen={isOpen}
      title={chosen === 'tracker' ? 'Create Tracker Board' : 'Create New Board'}
      onClose={onClose}
      onConfirm={handleConfirm}
      inputValue={inputValue}
      onInputChange={onInputChange}
      inputPlaceholder="Board name"
      confirmLabel="Create"
      confirmDisabled={isDisabled}
    >
      {offerKinds && (
        <div className="tracker-kind" role="radiogroup" aria-label="Board type">
          {KINDS.map(([k, label, hint]) => (
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
      )}
      {movingTasks && (
        <p className="modal-hint">
          {pendingTaskOperation.taskIds.length} task
          {pendingTaskOperation.taskIds.length > 1 ? 's' : ''} will be moved to this board
        </p>
      )}
      {shownError && <p className="modal-error">{shownError}</p>}
    </Modal>
  )
}
