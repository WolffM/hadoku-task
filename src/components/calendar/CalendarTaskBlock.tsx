/**
 * CalendarTaskBlock component
 * Renders a task as a positioned block in the calendar grid
 */

import React from 'react'
import type { Task } from '../../domain/types'
import {
  getMinutesSinceMidnight,
  formatTimeFromISO,
  getDurationMinutes,
  formatDuration
} from '../../domain/utils/calendar'
import { formatTagsForDisplay } from '../../domain/utils/tags'

export interface CalendarTaskBlockProps {
  task: Task
  hourHeight: number
  dayStart: Date
  onDragStart?: (e: React.DragEvent, taskId: string) => void
  onResizeStart?: (e: React.MouseEvent, taskId: string, edge: 'top' | 'bottom') => void
  onDelete: (taskId: string) => void
  onEditTag: (taskId: string) => void
  isPending: boolean
}

export function CalendarTaskBlock({
  task,
  hourHeight,
  dayStart: _dayStart,
  onDragStart,
  onResizeStart,
  onDelete,
  onEditTag,
  isPending
}: CalendarTaskBlockProps) {
  const startMinutes = getMinutesSinceMidnight(task.startTime)
  const endMinutes = getMinutesSinceMidnight(task.endTime)
  const durationMinutes = getDurationMinutes(task.startTime, task.endTime)

  // Calculate position
  const top = (startMinutes / 60) * hourHeight
  const height = Math.max(((endMinutes - startMinutes) / 60) * hourHeight, hourHeight / 4) // Min height of 15min

  const timeDisplay = formatTimeFromISO(task.startTime)
  const durationDisplay = formatDuration(durationMinutes)

  return (
    <div
      className={`calendar-task-block ${isPending ? 'calendar-task-block--pending' : ''}`}
      style={{ top: `${top}px`, height: `${height}px` }}
      draggable
      onDragStart={e => onDragStart?.(e, task.id)}
      data-task-id={task.id}
    >
      {/* Top resize handle */}
      <div
        className="calendar-resize-handle calendar-resize-handle--top"
        onMouseDown={e => {
          e.stopPropagation()
          onResizeStart?.(e, task.id, 'top')
        }}
      />

      <div className="calendar-task-block__content">
        <div className="calendar-task-block__title" title={task.title}>
          {task.title}
        </div>
        <div className="calendar-task-block__meta">
          <span className="calendar-task-block__time">{timeDisplay}</span>
          <span className="calendar-task-block__duration">{durationDisplay}</span>
        </div>
        {task.tag && (
          <div className="calendar-task-block__tags">{formatTagsForDisplay(task.tag)}</div>
        )}
      </div>

      <div className="calendar-task-block__actions">
        <button
          className="calendar-task-block__btn"
          onClick={e => {
            e.stopPropagation()
            onEditTag(task.id)
          }}
          title="Edit tags"
        >
          #
        </button>
        <button
          className="calendar-task-block__btn calendar-task-block__btn--delete"
          onClick={e => {
            e.stopPropagation()
            onDelete(task.id)
          }}
          title="Delete"
        >
          ×
        </button>
      </div>

      {/* Bottom resize handle */}
      <div
        className="calendar-resize-handle calendar-resize-handle--bottom"
        onMouseDown={e => {
          e.stopPropagation()
          onResizeStart?.(e, task.id, 'bottom')
        }}
      />
    </div>
  )
}
