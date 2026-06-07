/**
 * CalendarDayView component
 * Day view rendered as a clean, scannable agenda list (time gutter + cards),
 * styled to match the board's task items. Supports two kinds of scheduled task:
 *   - all-day  ("task for this day"): `date` only, shown in a pinned group
 *   - timed:   `date` + start/end, shown in time order with a "now" marker
 */

import React, { useState } from 'react'
import type { Task } from '../../domain/types'
import { CalendarAgendaItem } from './CalendarAgendaItem'
import {
  getCalendarTasks,
  formatCalendarDate,
  addDays,
  isSameDay,
  formatTime,
  createTimeOnDay,
  getMinutesSinceMidnight,
  toDayString
} from '../../domain/utils/calendar'

export interface CalendarSchedule {
  date?: string | null
  startTime?: string | null
  endTime?: string | null
}

export interface CalendarDayViewProps {
  tasks: Task[]
  selectedDate: Date
  onDateChange: (date: Date) => void
  onCreateTask: (title: string, schedule: CalendarSchedule) => void
  // Reschedule is not surfaced in the list view yet (no spatial drag target);
  // kept in the contract so a future grid/week view can wire it back up. Timed-only:
  // reschedule always moves a task to a concrete start/end.
  onRescheduleTask?: (
    taskId: string,
    schedule: { startTime: string | null; endTime: string | null }
  ) => void
  onDeleteTask: (taskId: string) => void
  onEditTag: (taskId: string) => void
  pendingOperations: Set<string>
}

/**
 * Pick a sensible default slot for a brand-new timed task: the next full hour
 * (capped so it never spills past the end of the day), one hour long.
 */
function defaultCreateSlot(selectedDate: Date): CalendarSchedule {
  const now = new Date()
  const base = isSameDay(selectedDate, now) ? now.getHours() + 1 : 9
  const startHour = Math.min(base, 23)
  const endHour = Math.min(startHour + 1, 24)
  return {
    startTime: createTimeOnDay(selectedDate, startHour, 0),
    endTime: createTimeOnDay(selectedDate, endHour === 24 ? 23 : endHour, endHour === 24 ? 59 : 0)
  }
}

export function CalendarDayView({
  tasks,
  selectedDate,
  onDateChange,
  onCreateTask,
  onDeleteTask,
  onEditTag,
  pendingOperations
}: CalendarDayViewProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createAllDay, setCreateAllDay] = useState(false)

  const dayTasks = getCalendarTasks(tasks, selectedDate)
  const allDayTasks = dayTasks.filter(t => !t.startTime)
  const timedTasks = dayTasks
    .filter(t => t.startTime)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))

  const isToday = isSameDay(selectedDate, new Date())
  const nowMinutes = getMinutesSinceMidnight(new Date().toISOString())

  // Index of the first timed task at or after "now" — where the red current-time
  // marker slots into the timed list. -1 means every timed task is in the past.
  const nowIndex = isToday
    ? timedTasks.findIndex(t => getMinutesSinceMidnight(t.startTime) >= nowMinutes)
    : -1

  const handlePrevDay = () => onDateChange(addDays(selectedDate, -1))
  const handleNextDay = () => onDateChange(addDays(selectedDate, 1))
  const handleToday = () => onDateChange(new Date())

  const openCreate = (allDay: boolean) => {
    setCreateAllDay(allDay)
    setCreateTitle('')
    setIsCreating(true)
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!createTitle.trim()) return
    const schedule: CalendarSchedule = createAllDay
      ? { date: toDayString(selectedDate) }
      : defaultCreateSlot(selectedDate)
    onCreateTask(createTitle.trim(), schedule)
    setIsCreating(false)
    setCreateTitle('')
  }

  const handleCreateCancel = () => {
    setIsCreating(false)
    setCreateTitle('')
  }

  const renderItem = (task: Task) => (
    <CalendarAgendaItem
      key={task.id}
      task={task}
      onDelete={onDeleteTask}
      onEditTag={onEditTag}
      isPending={
        pendingOperations.has(`delete-${task.id}`) || pendingOperations.has(`complete-${task.id}`)
      }
    />
  )

  const renderNowMarker = (key: string) => (
    <div className="calendar-agenda__now" key={key} aria-label="Current time">
      <div className="calendar-agenda__now-label">
        {formatTime(Math.floor(nowMinutes / 60), nowMinutes % 60)}
      </div>
      <div className="calendar-agenda__now-line" />
    </div>
  )

  return (
    <div className="calendar-day-view">
      {/* Header: navigation + date + new-task actions */}
      <div className="calendar-header">
        <div className="calendar-header__nav">
          <button
            className="calendar-nav-btn"
            onClick={handlePrevDay}
            title="Previous day"
            aria-label="Previous day"
          >
            ‹
          </button>
          <button
            className="calendar-nav-btn"
            onClick={handleNextDay}
            title="Next day"
            aria-label="Next day"
          >
            ›
          </button>
        </div>

        <div className="calendar-header__date">
          <span className={`calendar-date-label ${isToday ? 'calendar-date-label--today' : ''}`}>
            {formatCalendarDate(selectedDate)}
          </span>
          {!isToday && (
            <button className="calendar-today-btn" onClick={handleToday}>
              Today
            </button>
          )}
        </div>

        <button className="calendar-add-btn" onClick={() => openCreate(false)}>
          + New task
        </button>
      </div>

      {/* Agenda list */}
      {dayTasks.length === 0 ? (
        <div className="calendar-agenda calendar-agenda--empty">
          <p className="calendar-agenda__empty-text">Nothing scheduled for this day.</p>
        </div>
      ) : (
        <div className="calendar-agenda">
          {allDayTasks.length > 0 && (
            <div className="calendar-agenda__group">
              <div className="calendar-agenda__group-label">All day</div>
              {allDayTasks.map(renderItem)}
            </div>
          )}

          {timedTasks.map((task, i) => (
            <React.Fragment key={task.id}>
              {i === nowIndex && renderNowMarker('now')}
              {renderItem(task)}
            </React.Fragment>
          ))}
          {/* "now" sits after every timed task (all of today's slots are past) */}
          {isToday && timedTasks.length > 0 && nowIndex === -1 && renderNowMarker('now-end')}
        </div>
      )}

      {/* Create task inline form (shared overlay styling) */}
      {isCreating && (
        <div className="calendar-create-overlay" onClick={handleCreateCancel}>
          <form
            className="calendar-create-form"
            onClick={e => e.stopPropagation()}
            onSubmit={handleCreateSubmit}
          >
            <input
              type="text"
              className="calendar-create-input"
              placeholder={createAllDay ? 'New all-day task…' : 'New task…'}
              value={createTitle}
              onChange={e => setCreateTitle(e.target.value)}
              autoFocus
            />
            <label className="calendar-create-allday">
              <input
                type="checkbox"
                checked={createAllDay}
                onChange={e => setCreateAllDay(e.target.checked)}
              />
              All day (no set time)
            </label>
            <div className="calendar-create-actions">
              <button type="submit" className="calendar-create-btn calendar-create-btn--primary">
                Create
              </button>
              <button type="button" className="calendar-create-btn" onClick={handleCreateCancel}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
