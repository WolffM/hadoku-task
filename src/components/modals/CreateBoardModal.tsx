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
  onConfirm: (boardName: string) => Promise<void>
  onInputChange: (value: string) => void
  validateBoardName: (name: string) => string | null
}

export function CreateBoardModal({
  isOpen,
  inputValue,
  validationError,
  pendingTaskOperation,
  onClose,
  onConfirm,
  onInputChange,
  validateBoardName
}: CreateBoardModalProps) {
  const handleConfirm = async () => {
    if (!inputValue.trim()) return

    const error = validateBoardName(inputValue)
    if (error) return // Validation error will be shown

    await onConfirm(inputValue)
  }

  const isDisabled = !inputValue.trim() || validateBoardName(inputValue) !== null

  return (
    <Modal
      isOpen={isOpen}
      title="Create New Board"
      onClose={onClose}
      onConfirm={handleConfirm}
      inputValue={inputValue}
      onInputChange={onInputChange}
      inputPlaceholder="Board name"
      confirmLabel="Create"
      confirmDisabled={isDisabled}
    >
      {pendingTaskOperation?.type === 'move-to-board' &&
        pendingTaskOperation.taskIds.length > 0 && (
          <p className="modal-hint">
            {pendingTaskOperation.taskIds.length} task
            {pendingTaskOperation.taskIds.length > 1 ? 's' : ''} will be moved to this board
          </p>
        )}
      {validationError && <p className="modal-error">{validationError}</p>}
    </Modal>
  )
}
