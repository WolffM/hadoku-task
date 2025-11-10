/**
 * ClearTagModal component
 * Confirmation dialog for clearing/deleting a tag
 */

import React from 'react'
import { Modal } from '@wolffm/task-ui-components'

export interface ClearTagModalProps {
  tag: string | null
  count: number
  isOpen: boolean
  onClose: () => void
  onConfirm: (tag: string) => Promise<void>
}

export function ClearTagModal({ tag, count, isOpen, onClose, onConfirm }: ClearTagModalProps) {
  const handleConfirm = async () => {
    if (!tag) return
    await onConfirm(tag)
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      title={`Clear Tag #${tag}?`}
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmLabel="Clear Tag"
      confirmDanger={true}
    >
      {tag && (
        <p>
          This will remove <strong>#{tag}</strong> from <strong>{count} task(s)</strong> and delete
          the tag from the board.
        </p>
      )}
    </Modal>
  )
}
