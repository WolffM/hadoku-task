/**
 * TaskItem component - renders a single task with actions
 */

import React from 'react'
import type { Task } from '@hadoku/task/api/types'
import { formatAge } from '../lib/formatters'

interface TaskItemProps {
  task: Task
  isDraggable?: boolean
  pendingOperations: Set<string>
  onComplete: (taskId: string) => void
  onDelete: (taskId: string) => void
  onAddTag: (taskId: string) => void
  onDragStart?: (e: React.DragEvent, taskId: string) => void
}

export function TaskItem({
  task,
  isDraggable = true,
  pendingOperations,
  onComplete,
  onDelete,
  onAddTag,
  onDragStart
}: TaskItemProps) {
  const isCompleting = pendingOperations.has(`complete-${task.id}`)
  const isDeleting = pendingOperations.has(`delete-${task.id}`)

  return (
    <li 
      className="task-app__item"
      draggable={isDraggable}
      onDragStart={onDragStart ? (e) => onDragStart(e, task.id) : undefined}
    >
      <div className="task-app__item-content">
        <div className="task-app__item-title-row">
          <div className="task-app__item-title">{task.title}</div>
          <div className="task-app__item-age">{formatAge(task.createdAt)}</div>
        </div>
        {task.tag && <div className="task-app__item-tag">
          {task.tag.split(' ').map(tag => `#${tag}`).join(' ')}
        </div>}
      </div>
      <div className="task-app__item-actions">
        <button 
          className="task-app__action-btn task-app__complete-btn"
          onClick={() => onComplete(task.id)}
          title="Complete task"
          disabled={isCompleting || isDeleting}
        >
          {isCompleting ? '⏳' : '✓'}
        </button>
        <button 
          className="task-app__action-btn task-app__delete-btn"
          onClick={() => onDelete(task.id)}
          title="Delete task"
          disabled={isCompleting || isDeleting}
        >
          {isDeleting ? '⏳' : '×'}
        </button>
        <button 
          className="task-app__action-btn task-app__tag-btn"
          onClick={() => onAddTag(task.id)}
          title="Add tag"
          disabled={isCompleting || isDeleting}
        >
          🏷️
        </button>
      </div>
    </li>
  )
}
