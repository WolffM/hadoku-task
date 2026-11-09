/**
 * Tracker boards: a board whose mode is 'tracker' holds named counters/values
 * instead of tasks, and every change is a logged entry. The server is the only
 * store (worker/src/routes/trackers.ts); there is no localStorage mirror.
 */
export const TRACKER_MODE = 'tracker'

export type TrackerKind = 'counter' | 'value'
export type TrackerEntrySource = 'web' | 'api' | 'button'

export interface Tracker {
  id: string
  name: string
  kind: TrackerKind
  unit: string | null
  value: number
  position: number
  createdAt: string
  updatedAt: string
}

export interface TrackerEntry {
  id: string
  trackerId: string
  /** The change, on a counter. Null on a value entry. */
  delta: number | null
  /** The tracker's value once this entry applied. */
  value: number
  source: TrackerEntrySource
  actorId: string | null
  note: string | null
  at: string
}

export interface TrackerBoardData {
  canWrite: boolean
  trackers: Tracker[]
  entries: TrackerEntry[]
}

/** Tracker boards are a wife-tier-and-up feature; the worker enforces the same line. */
export function canUseTrackers(userType: string | undefined): boolean {
  return userType === 'wife' || userType === 'admin'
}

export function isTrackerBoard(board: { mode?: string | null } | null | undefined): boolean {
  return board?.mode === TRACKER_MODE
}

/** Local midnight `daysBack` days before `now` (0 = today). */
export function startOfLocalDay(now: Date, daysBack = 0): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysBack)
  return d
}

/** Sum of a counter's deltas at or after `since`. */
export function counterTotalSince(entries: TrackerEntry[], trackerId: string, since: Date): number {
  const from = since.getTime()
  let total = 0
  for (const e of entries) {
    if (e.trackerId === trackerId && e.delta !== null && Date.parse(e.at) >= from) total += e.delta
  }
  return total
}

/** A tracker's entries, newest first (the order the API returns them in). */
export function entriesFor(entries: TrackerEntry[], trackerId: string): TrackerEntry[] {
  return entries.filter(e => e.trackerId === trackerId)
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

export function formatTrackerNumber(n: number): string {
  return numberFormat.format(n)
}

/** "+3" / "−2" / "0": a signed count, with a real minus sign. */
export function formatDelta(n: number): string {
  if (n > 0) return `+${formatTrackerNumber(n)}`
  if (n < 0) return `−${formatTrackerNumber(-n)}`
  return '0'
}

/** "just now", "5m ago", "3h ago", "yesterday 14:05", "Mon 9 Nov 14:05". */
export function formatWhen(iso: string, now: Date): string {
  const at = new Date(iso)
  const mins = Math.floor((now.getTime() - at.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (at >= startOfLocalDay(now)) return `${Math.floor(mins / 60)}h ago`
  if (at >= startOfLocalDay(now, 1)) return `yesterday ${time}`
  const day = at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} ${time}`
}
