/**
 * EditTagModal component
 * Dialog for editing tags on a task
 */

import React from 'react'
import { Modal } from '@wolffm/task-ui-components'
import type { BoardsFile } from '../../domain/types'
import { normalizeTag } from '../../domain/utils/tags'

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
  taskId: _taskId,
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
  // A task carries one tag, so the pills are a radio group, not checkboxes.
  const selectedTag = normalizeTag(currentTag)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onConfirm()
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Edit Tag"
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel="Save"
      cancelLabel="Cancel"
    >
      <div className="edit-tag-modal">
        {/* Show existing board tags as clickable pills */}
        {boardTags.length > 0 && (
          <div className="edit-tag-pills">
            <label className="edit-tag-label">Select Tag</label>
            <div className="edit-tag-pills-container" role="radiogroup" aria-label="Select tag">
              {[...boardTags].sort().map(tag => {
                const isActive = selectedTag === tag
                return (
                  <button
                    key={tag}
                    className={`edit-tag-pill ${isActive ? 'active' : ''}`}
                    onClick={() => onToggleTagPill(tag)}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                  >
                    #{tag}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="edit-tag-field">
          <label className="edit-tag-label">New Tag</label>
          <input
            type="text"
            className="edit-tag-input"
            value={editTagInput}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter a tag"
            autoFocus
          />
          <div className="edit-tag-hint">
            <div>"one tag" → #one-tag</div>
            <div>Replaces the current tag — a task has one.</div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
