/**
 * CreateTagModal component
 * Modal dialog for creating a new tag
 */

import React from 'react'
import { Modal } from '@wolffm/task-ui-components'
import type { Task } from '../../domain/types'
import type { PendingTaskOperation } from '../../hooks/useModalState'
import { getAllTags, formatError } from '../../domain/utils/tags'
import { logger } from '@wolffm/task-ui-components'

export interface CreateTagModalProps {
  isOpen: boolean
  inputValue: string
  tasks: Task[]
  pendingTaskOperation: PendingTaskOperation | null
  onClose: () => void
  onConfirm: (tagName: string) => Promise<void>
  onInputChange: (value: string) => void
}

export function CreateTagModal({
  isOpen,
  inputValue,
  tasks,
  pendingTaskOperation,
  onClose,
  onConfirm,
  onInputChange
}: CreateTagModalProps) {
  const handleConfirm = async () => {
    if (!inputValue.trim()) return
    try {
      await onConfirm(inputValue)
    } catch (err) {
      logger.error('[CreateTagModal] Failed to create tag', {
        error: formatError(err),
        tagName: inputValue
      })
    }
  }

  const existingTags = getAllTags(tasks)

  return (
    <Modal
      isOpen={isOpen}
      title="Create New Tag"
      onClose={onClose}
      onConfirm={handleConfirm}
      inputValue={inputValue}
      onInputChange={onInputChange}
      inputPlaceholder="Enter new tag name"
      confirmLabel="Create"
      confirmDisabled={!inputValue.trim()}
    >
      {pendingTaskOperation?.type === 'apply-tag' && pendingTaskOperation.taskIds.length > 0 && (
        <p className="modal-hint">
          This tag will be applied to {pendingTaskOperation.taskIds.length} task
          {pendingTaskOperation.taskIds.length > 1 ? 's' : ''}
        </p>
      )}

      {existingTags.length > 0 && (
        <div className="modal-section">
          <label className="modal-label">Existing tags:</label>
          <div className="modal-tags-list">
            {existingTags.map(tag => (
              <span key={tag} className="modal-tag-chip">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
