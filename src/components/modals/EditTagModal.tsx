/**
 * EditTagModal component
 * Dialog for editing tags on a task
 */

import React from 'react'
import { Modal } from '../Modal'
import type { BoardsFile } from '../../domain/types'

export interface EditTagModalProps {
  isOpen: boolean
  taskId: string | null
  currentTag: string | null
  editTagInput: string
  boards: BoardsFile | null
  currentBoardId: string
  onClose: () => void
  onConfirm: () => Promise<void>
  onInputChange: (value: string) => void
  onToggleTagPill: (tag: string) => void
}

export function EditTagModal({
  isOpen,
  taskId,
  currentTag,
  editTagInput,
  boards,
  currentBoardId,
  onClose,
  onConfirm,
  onInputChange,
  onToggleTagPill
}: EditTagModalProps) {
  const currentBoard = boards?.boards?.find(b => b.id === currentBoardId)
  const boardTags = currentBoard?.tags || []
  const currentTags = currentTag?.split(' ').filter(Boolean) || []

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onConfirm()
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Edit Tags"
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel="Save"
      cancelLabel="Cancel"
    >
      <div className="edit-tag-modal">
        {/* Show existing board tags as clickable pills */}
        {boardTags.length > 0 && (
          <div className="edit-tag-pills">
            <label className="edit-tag-label">Select Tags</label>
            <div className="edit-tag-pills-container">
              {[...boardTags].sort().map(tag => {
                const isActive = currentTags.includes(tag)
                return (
                  <button
                    key={tag}
                    className={`edit-tag-pill ${isActive ? 'active' : ''}`}
                    onClick={() => onToggleTagPill(tag)}
                    type="button"
                  >
                    #{tag}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="edit-tag-field">
          <label className="edit-tag-label">Add New Tag</label>
          <input
            type="text"
            className="edit-tag-input"
            value={editTagInput}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter a tag"
            autoFocus
          />
          <div className="edit-tag-hint">
            <div>"one tag" → #one-tag</div>
            <div>"#two #tags" → #two #tags</div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
