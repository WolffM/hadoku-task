/**
 * TaskItem component - renders a single task with actions
 */

import React from 'react'
import type { Task } from '../domain/types'
import { formatAge } from '../utils/formatters'
import { formatTagsForDisplay } from '../domain/utils/tags'
import { TagIcon } from '@wolffm/task-ui-components'

interface TaskItemProps {
  task: Task
  isDraggable?: boolean
  pendingOperations: Set<string>
  onComplete: (taskId: string) => void
  onDelete: (taskId: string) => void
  onEditTag: (taskId: string) => void
  onDragStart?: (e: React.DragEvent, taskId: string) => void
  onDragEnd?: (e: React.DragEvent) => void
  selected?: boolean
  showCompleteButton?: boolean
  showDeleteButton?: boolean
  showTagButton?: boolean
}

export function TaskItem({
  task,
  isDraggable = true,
  pendingOperations,
  onComplete,
  onDelete,
  onEditTag,
  onDragStart,
  onDragEnd,
  selected = false,
  showCompleteButton = true,
  showDeleteButton = true,
  showTagButton = false
}: TaskItemProps) {
  const isCompleting = pendingOperations.has(`complete-${task.id}`)
  const isDeleting = pendingOperations.has(`delete-${task.id}`)

  return (
    <li
      className={`task-app__item hdk-advanced-surface hdk-advanced-surface--shift ${selected ? 'selected' : ''}`}
      data-task-id={task.id}
      draggable={isDraggable}
      onDragStart={onDragStart ? e => onDragStart(e, task.id) : undefined}
      onDragEnd={e => {
        // Remove dragging class if present
        const el = e.currentTarget as HTMLElement
        el.classList.remove('dragging')
        // Call external onDragEnd if provided
        if (onDragEnd) {
          try {
            onDragEnd(e)
          } catch {
            // Ignore drag end errors
          }
        }
      }}
    >
      <div className="task-app__item-content">
        <div className="task-app__item-title" title={task.title}>
          {task.title}
        </div>

        <div className="task-app__item-meta-row">
          {task.tag ? (
            <div className="task-app__item-tag">{formatTagsForDisplay(task.tag)}</div>
          ) : (
            <div />
          )}
          <div className="task-app__item-age">{formatAge(task.createdAt)}</div>
        </div>
      </div>
      <div className="task-app__item-actions">
        {showTagButton && (
          <button
            className="task-app__action-btn task-app__edit-tag-btn"
            onClick={() => onEditTag(task.id)}
            title="Edit tags"
            disabled={isCompleting || isDeleting}
          >
            <TagIcon />
          </button>
        )}
        {showCompleteButton && (
          <button
            className="task-app__action-btn task-app__complete-btn"
            onClick={() => onComplete(task.id)}
            title="Complete task"
            disabled={isCompleting || isDeleting}
          >
            {isCompleting ? '⏳' : '✓'}
          </button>
        )}
        {showDeleteButton && (
          <button
            className="task-app__action-btn task-app__delete-btn"
            onClick={() => onDelete(task.id)}
            title="Delete task"
            disabled={isCompleting || isDeleting}
          >
            {isDeleting ? '⏳' : '×'}
          </button>
        )}
      </div>
    </li>
  )
}
