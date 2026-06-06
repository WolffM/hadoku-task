/**
 * Calendar utility functions
 */

import type { Task } from '../types'

/**
 * Format a Date as a local calendar-day string, "YYYY-MM-DD".
 * This is the canonical `Task.date` membership key.
 */
export function toDayString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Derive the local calendar-day string from an ISO timestamp (used to backfill
 * `date` for tasks that carry a startTime). Returns null for empty input.
 */
export function dayStringFromISO(iso: string | null | undefined): string | null {
  if (!iso) return null
  return toDayString(new Date(iso))
}

/**
 * Resolve a task's calendar day: prefer the explicit `date`, else derive it from
 * `startTime` (covers legacy tasks not yet backfilled). Null = not on the calendar.
 */
export function taskDay(task: Task): string | null {
  return task.date ?? dayStringFromISO(task.startTime)
}

/**
 * Get tasks scheduled on a specific day — both all-day (date only) and timed
 * (date derived from startTime). Membership is keyed off the calendar day.
 */
export function getCalendarTasks(tasks: Task[], date: Date): Task[] {
  const target = toDayString(date)
  return tasks.filter(task => taskDay(task) === target)
}

/**
 * Get minutes since midnight for an ISO timestamp
 */
export function getMinutesSinceMidnight(isoString: string | null | undefined): number {
  if (!isoString) return 0
  const date = new Date(isoString)
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * Create an ISO timestamp for a specific time on a given day
 */
export function createTimeOnDay(date: Date, hours: number, minutes: number): string {
  const result = new Date(date)
  result.setHours(hours, minutes, 0, 0)
  return result.toISOString()
}

/**
 * Snap minutes to 15-minute increments
 */
function snapToGrid(minutes: number): number {
  return Math.round(minutes / 15) * 15
}

/**
 * Calculate minutes from Y position in the calendar grid
 */
export function getMinutesFromY(y: number, containerTop: number, hourHeight: number): number {
  const relativeY = y - containerTop
  const minutes = (relativeY / hourHeight) * 60
  return snapToGrid(Math.max(0, Math.min(24 * 60 - 15, minutes)))
}

/**
 * Format time for display (e.g., "9:00 AM")
 */
export function formatTime(hours: number, minutes: number = 0): string {
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  const displayMinutes = minutes.toString().padStart(2, '0')
  return `${displayHours}:${displayMinutes} ${period}`
}

/**
 * Format time from ISO string
 */
export function formatTimeFromISO(isoString: string | null | undefined): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  return formatTime(date.getHours(), date.getMinutes())
}

/**
 * Calculate duration in minutes between two ISO timestamps
 */
export function getDurationMinutes(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): number {
  if (!startTime || !endTime) return 0
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  return Math.floor((end - start) / (1000 * 60))
}

/**
 * Format duration for display (e.g., "1h 30m")
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h ${remainingMinutes}m`
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

/**
 * Format date for calendar header (e.g., "Mon, Jan 6")
 */
export function formatCalendarDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ]
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`
}
