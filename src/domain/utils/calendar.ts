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
 * Derive the *local* calendar-day string from an ISO timestamp. Used for DISPLAY
 * (which day a timed task occupies in the viewer's timezone). Empty input → null.
 */
export function dayStringFromISO(iso: string | null | undefined): string | null {
  if (!iso) return null
  return toDayString(new Date(iso))
}

/**
 * Derive the *UTC* calendar-day string from an ISO timestamp. This is the
 * canonical value persisted in `Task.date`, so storage is consistent regardless
 * of where the (isomorphic) handler runs — server (UTC) or browser (local).
 * Display always recomputes the local day from startTime, so the stored UTC day
 * is metadata, never shown directly. Empty input → null.
 */
export function utcDayFromISO(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Resolve a task's calendar day in the viewer's local timezone.
 *
 * Timed tasks derive their day from `startTime` (interpreted in the browser's
 * timezone), which is authoritative — a stored `date` may have been backfilled
 * server-side in UTC and would land the task on the wrong local day. All-day
 * tasks have no `startTime`, so they use the stored `date` as-is.
 * Null = not on the calendar.
 */
export function taskDay(task: Task): string | null {
  if (task.startTime) return dayStringFromISO(task.startTime)
  return task.date ?? null
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
 * A task's calendar day as STORED — `date` (the canonical membership key), or
 * the UTC day of `startTime` for a task that predates the backfill.
 *
 * Distinct from {@link taskDay}, which resolves the *viewer's local* day and is
 * therefore browser-only: it would silently answer in the runtime's timezone
 * (UTC) on a server. Anything that filters or reports a calendar server-side
 * must use this one, so the same task lands in the same window everywhere.
 */
export function storedTaskDay(task: Task): string | null {
  return task.date ?? utcDayFromISO(task.startTime)
}

/** A window (and provider filter) over a board's calendar. Days are "YYYY-MM-DD". */
export interface CalendarQuery {
  /** Inclusive first day. Omit for "no lower bound". */
  from?: string | null
  /** Inclusive last day. Omit for "no upper bound". */
  to?: string | null
  /** Only tasks mirrored from this provider (`Task.source`). */
  source?: string | null
}

/**
 * The calendar members of a task list: everything carrying a calendar day,
 * narrowed by the query and ordered by day, then start time, then id.
 *
 * Tasks WITHOUT a day are not calendar members at all — they live only in board
 * view (see Task.date in ../types). That is the whole membership rule; there is
 * no separate calendar-item concept to keep in sync.
 */
export function calendarTasks(tasks: Task[], query: CalendarQuery = {}): Task[] {
  const { from, to, source } = query
  const dated = tasks
    .map(task => ({ task, day: storedTaskDay(task) }))
    .filter((e): e is { task: Task; day: string } => e.day !== null)
    .filter(e => (from ? e.day >= from : true))
    .filter(e => (to ? e.day <= to : true))
    .filter(e => (source ? e.task.source === source : true))
  dated.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (a.task.startTime ?? '').localeCompare(b.task.startTime ?? '') ||
      a.task.id.localeCompare(b.task.id)
  )
  return dated.map(e => e.task)
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
