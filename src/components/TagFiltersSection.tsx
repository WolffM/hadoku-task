/**
 * TagFiltersSection component
 * Displays tag filter pills and add tag button
 */

import React from 'react'
import { TagFilterButton } from './TagFilterButton'
import { getTaskIdsFromDragEvent } from '../utils/dragDrop'
import type { PendingTaskOperation } from '../hooks/useModalState'

export interface TagFiltersSectionProps {
  tags: string[]
  selectedFilters: Set<string>
  dragOverFilter: string | null
  onToggleFilter: (tag: string) => void
  onTagContextMenu: (tag: string, x: number, y: number) => void
  onDragOver: (e: React.DragEvent, filter: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, filterTag: string) => Promise<void>
  onCreateTagClick: () => void
  onPendingOperation: (op: PendingTaskOperation | null) => void
}

export function TagFiltersSection({
  tags,
  selectedFilters,
  dragOverFilter,
  onToggleFilter,
  onTagContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
  onCreateTagClick,
  onPendingOperation
}: TagFiltersSectionProps) {
  const handleAddTagDrop = (e: React.DragEvent) => {
    e.preventDefault()
    onDragLeave(e)

    const ids = getTaskIdsFromDragEvent(e.dataTransfer)
    if (ids.length > 0) {
      onPendingOperation({ type: 'apply-tag', taskIds: ids })
      onCreateTagClick()
    }
  }

  return (
    <div className="task-app__filters">
      {tags.map(tag => (
        <TagFilterButton
          key={tag}
          tag={tag}
          isActive={selectedFilters.has(tag)}
          isDragOver={dragOverFilter === tag}
          onToggle={onToggleFilter}
          onContextMenu={onTagContextMenu}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        />
      ))}
      <button
        className={`pill-btn task-app__filter-add ${dragOverFilter === 'add-tag' ? 'task-app__filter-drag-over' : ''}`}
        onClick={onCreateTagClick}
        onDragOver={e => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          onDragOver(e, 'add-tag')
        }}
        onDragLeave={onDragLeave}
        onDrop={handleAddTagDrop}
        aria-label="Add tag"
      >
        ＋
      </button>
    </div>
  )
}
