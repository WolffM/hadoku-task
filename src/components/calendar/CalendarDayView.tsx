/**
 * CalendarDayView component
 * Displays a day view calendar with hour grid and task blocks
 */

import React, { useRef, useState } from 'react'
import type { Task } from '../../domain/types'
import { CalendarTaskBlock } from './CalendarTaskBlock'
import {
  getCalendarTasks,
  formatCalendarDate,
  addDays,
  isSameDay,
  formatTime,
  createTimeOnDay,
  getMinutesFromY,
  getMinutesSinceMidnight,
  getDurationMinutes
} from '../../domain/utils/calendar'

const HOUR_HEIGHT = 60 // pixels per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i)

export interface CalendarDayViewProps {
  tasks: Task[]
  selectedDate: Date
  onDateChange: (date: Date) => void
  onCreateTask: (title: string) => void
  onUpdateTask: (taskId: string, updates: { tag: string }) => Promise<void>
  onDeleteTask: (taskId: string) => void
  onEditTag: (taskId: string) => void
  pendingOperations: Set<string>
}

export function CalendarDayView({
  tasks,
  selectedDate,
  onDateChange,
  onCreateTask: _onCreateTask,
  onUpdateTask: _onUpdateTask,
  onDeleteTask,
  onEditTag,
  pendingOperations
}: CalendarDayViewProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [hoverSlot, setHoverSlot] = useState<{ hour: number; quarter: number } | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [createTime, setCreateTime] = useState<{ startTime: string; endTime: string } | null>(null)
  const [createTitle, setCreateTitle] = useState('')

  const calendarTasks = getCalendarTasks(tasks, selectedDate)
  const isToday = isSameDay(selectedDate, new Date())

  const handlePrevDay = () => onDateChange(addDays(selectedDate, -1))
  const handleNextDay = () => onDateChange(addDays(selectedDate, 1))
  const handleToday = () => onDateChange(new Date())

  const handleSlotClick = (hour: number, quarter: number) => {
    const minutes = hour * 60 + quarter * 15
    const startTime = createTimeOnDay(selectedDate, Math.floor(minutes / 60), minutes % 60)
    const endTime = createTimeOnDay(
      selectedDate,
      Math.floor((minutes + 30) / 60),
      (minutes + 30) % 60
    )

    setCreateTime({ startTime, endTime })
    setCreateTitle('')
    setIsCreating(true)
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!createTitle.trim() || !createTime) return

    // For now, just create a basic task - the calendar fields will be added via API
    // TODO: Integrate with addTask that supports startTime/endTime
    _onCreateTask(createTitle.trim())

    setIsCreating(false)
    setCreateTime(null)
    setCreateTitle('')
  }

  const handleCreateCancel = () => {
    setIsCreating(false)
    setCreateTime(null)
    setCreateTitle('')
  }

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId)
    e.dataTransfer.setData('application/x-hadoku-calendar-task', taskId)
    e.dataTransfer.effectAllowed = 'move'
  }

  /**
   * Get minutes from Y position relative to grid
   * Returns null if grid ref is not available
   */
  const getGridMinutes = (clientY: number): number | null => {
    if (!gridRef.current) return null
    const rect = gridRef.current.getBoundingClientRect()
    return getMinutesFromY(clientY, rect.top, HOUR_HEIGHT)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const minutes = getGridMinutes(e.clientY)
    if (minutes === null) return
    const hour = Math.floor(minutes / 60)
    const quarter = Math.floor((minutes % 60) / 15)
    setHoverSlot({ hour, quarter })
  }

  const handleDragLeave = () => {
    setHoverSlot(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setHoverSlot(null)

    const taskId = e.dataTransfer.getData('application/x-hadoku-calendar-task')
    if (!taskId) return

    const minutes = getGridMinutes(e.clientY)
    if (minutes === null) return

    // Find the task and calculate new times
    const task = tasks.find(t => t.id === taskId)
    if (!task || !task.startTime || !task.endTime) return

    const duration = getDurationMinutes(task.startTime, task.endTime)

    const newStartMinutes = minutes
    const newEndMinutes = Math.min(newStartMinutes + duration, 24 * 60)

    const newStartTime = createTimeOnDay(
      selectedDate,
      Math.floor(newStartMinutes / 60),
      newStartMinutes % 60
    )
    const newEndTime = createTimeOnDay(
      selectedDate,
      Math.floor(newEndMinutes / 60),
      newEndMinutes % 60
    )

    // TODO: Update task with new times via API
    console.log('[CalendarDayView] Drop task', { taskId, newStartTime, newEndTime })
  }

  return (
    <div className="calendar-day-view">
      {/* Navigation header */}
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
      </div>

      {/* Hour grid */}
      <div
        ref={gridRef}
        className="calendar-grid"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {HOURS.map(hour => (
          <div key={hour} className="calendar-hour-row">
            <div className="calendar-time-label">{formatTime(hour)}</div>
            <div className="calendar-hour-content">
              {/* 4 quarter-hour slots */}
              {[0, 1, 2, 3].map(quarter => (
                <div
                  key={quarter}
                  className={`calendar-slot ${
                    hoverSlot?.hour === hour && hoverSlot?.quarter === quarter
                      ? 'calendar-slot--hover'
                      : ''
                  }`}
                  onClick={() => handleSlotClick(hour, quarter)}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Task blocks */}
        <div className="calendar-tasks-layer">
          {calendarTasks.map(task => (
            <CalendarTaskBlock
              key={task.id}
              task={task}
              hourHeight={HOUR_HEIGHT}
              dayStart={selectedDate}
              onDragStart={handleDragStart}
              onDelete={onDeleteTask}
              onEditTag={onEditTag}
              isPending={
                pendingOperations.has(`delete-${task.id}`) ||
                pendingOperations.has(`complete-${task.id}`)
              }
            />
          ))}
        </div>

        {/* Current time indicator */}
        {isToday && <CurrentTimeIndicator hourHeight={HOUR_HEIGHT} />}
      </div>

      {/* Create task inline form */}
      {isCreating && createTime && (
        <div className="calendar-create-overlay" onClick={handleCreateCancel}>
          <form
            className="calendar-create-form"
            onClick={e => e.stopPropagation()}
            onSubmit={handleCreateSubmit}
          >
            <input
              type="text"
              className="calendar-create-input"
              placeholder="New task..."
              value={createTitle}
              onChange={e => setCreateTitle(e.target.value)}
              autoFocus
            />
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

/**
 * Current time indicator line
 */
function CurrentTimeIndicator({ hourHeight }: { hourHeight: number }) {
  const minutes = getMinutesSinceMidnight(new Date().toISOString())
  const top = (minutes / 60) * hourHeight

  return (
    <div className="calendar-current-time" style={{ top: `${top}px` }}>
      <div className="calendar-current-time__dot" />
      <div className="calendar-current-time__line" />
    </div>
  )
}
