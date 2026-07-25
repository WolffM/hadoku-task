/**
 * CalendarAgendaItem component
 * One row in the day-view agenda list: a time gutter plus a task card that
 * mirrors the board's .task-app__item treatment (accent, shadow, hover).
 * Tasks ingested from an external provider show a source badge and an
 * expandable breakdown of their metadata.
 */

import React, { useState } from 'react'
import type { Task } from '../../domain/types'
import { formatTimeFromISO, getDurationMinutes, formatDuration } from '../../domain/utils/calendar'
import { formatTagsForDisplay } from '../../domain/utils/tags'

export interface CalendarAgendaItemProps {
  task: Task
  onDelete: (taskId: string) => void
  onEditTag: (taskId: string) => void
  isPending: boolean
}

/** "scheduledBy" / "meeting_link" -> "Scheduled by" / "Meeting link" */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Render a metadata value: links become anchors, objects are stringified. */
function MetadataValue({ value }: { value: unknown }) {
  if (value == null) return <span className="calendar-agenda__meta-empty">—</span>
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value)) {
      return (
        <a href={value} target="_blank" rel="noopener noreferrer">
          {value}
        </a>
      )
    }
    return <>{value}</>
  }
  if (typeof value === 'number' || typeof value === 'boolean') return <>{String(value)}</>
  return <>{JSON.stringify(value)}</>
}

export function CalendarAgendaItem({
  task,
  onDelete,
  onEditTag,
  isPending
}: CalendarAgendaItemProps) {
  const [expanded, setExpanded] = useState(false)

  const isAllDay = !task.startTime
  const startDisplay = formatTimeFromISO(task.startTime)
  const endDisplay = formatTimeFromISO(task.endTime)
  const durationDisplay = formatDuration(getDurationMinutes(task.startTime, task.endTime))
  const tags = task.tag ? formatTagsForDisplay(task.tag) : ''

  const metadataEntries =
    task.metadata && typeof task.metadata === 'object' ? Object.entries(task.metadata) : []
  const hasMetadata = metadataEntries.length > 0

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
        <div className="calendar-agenda__card-row">
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
              {task.source && <span className="calendar-agenda__source">from {task.source}</span>}
              {tags && <span className="calendar-agenda__tags">{tags}</span>}
            </div>
          </div>

          <div className="calendar-agenda__actions">
            {hasMetadata && (
              <button
                className={`calendar-agenda__btn ${expanded ? 'calendar-agenda__btn--on' : ''}`}
                onClick={e => {
                  e.stopPropagation()
                  setExpanded(v => !v)
                }}
                title={expanded ? 'Hide details' : 'Show details'}
                aria-label={expanded ? 'Hide details' : 'Show details'}
                aria-expanded={expanded}
              >
                {expanded ? '▾' : 'ⓘ'}
              </button>
            )}
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

        {hasMetadata && expanded && (
          <dl className="calendar-agenda__details">
            {metadataEntries.map(([key, value]) => (
              <div className="calendar-agenda__detail" key={key}>
                <dt>{humanizeKey(key)}</dt>
                <dd>
                  <MetadataValue value={value} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}
