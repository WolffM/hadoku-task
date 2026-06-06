/**
 * CalendarAgendaItem component
 * One row in the day-view agenda list: a time gutter plus a task card that
 * mirrors the board's .task-app__item treatment (accent, shadow, hover).
 */

import React from 'react'
import type { Task } from '../../domain/types'
import { formatTimeFromISO, getDurationMinutes, formatDuration } from '../../domain/utils/calendar'
import { formatTagsForDisplay } from '../../domain/utils/tags'

export interface CalendarAgendaItemProps {
  task: Task
  onDelete: (taskId: string) => void
  onEditTag: (taskId: string) => void
  isPending: boolean
}

export function CalendarAgendaItem({
  task,
  onDelete,
  onEditTag,
  isPending
}: CalendarAgendaItemProps) {
  const isAllDay = !task.startTime
  const startDisplay = formatTimeFromISO(task.startTime)
  const endDisplay = formatTimeFromISO(task.endTime)
  const durationDisplay = formatDuration(getDurationMinutes(task.startTime, task.endTime))
  const tags = task.tag ? formatTagsForDisplay(task.tag) : ''

  return (
    <div className="calendar-agenda__row">
      <div className="calendar-agenda__time">
        {isAllDay ? (
          <b>All day</b>
        ) : (
          <>
            <b>{startDisplay}</b>
            <span>{durationDisplay}</span>
          </>
        )}
      </div>

      <div
        className={`calendar-agenda__card ${isPending ? 'calendar-agenda__card--pending' : ''}`}
        data-task-id={task.id}
      >
        <div className="calendar-agenda__main">
          <div className="calendar-agenda__title" title={task.title}>
            {task.title}
          </div>
          <div className="calendar-agenda__meta">
            {!isAllDay && (
              <span>
                {startDisplay} – {endDisplay}
              </span>
            )}
            {tags && <span className="calendar-agenda__tags">{tags}</span>}
          </div>
        </div>

        <div className="calendar-agenda__actions">
          <button
            className="calendar-agenda__btn"
            onClick={e => {
              e.stopPropagation()
              onEditTag(task.id)
            }}
            title="Edit tags"
            aria-label="Edit tags"
          >
            #
          </button>
          <button
            className="calendar-agenda__btn calendar-agenda__btn--delete"
            onClick={e => {
              e.stopPropagation()
              onDelete(task.id)
            }}
            title="Delete"
            aria-label="Delete task"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
