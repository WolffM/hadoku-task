/**
 * Tracker figures and wording: day totals, readings, summaries and the
 * formatting the tracker UI shows. Only the lazy tracker chunk imports this,
 * so it stays off the /task boot path (src/domain/trackers.ts is imported by
 * the eager app and holds just the types and the board/tier checks).
 */
import type { Tracker, TrackerEntry } from './trackers'

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

/**
 * A counter's per-day totals for the last `days` local days, oldest first —
 * the last element is today. A day with no entries is 0.
 */
export function dailyTotals(
  entries: TrackerEntry[],
  trackerId: string,
  now: Date,
  days: number
): number[] {
  const starts = Array.from({ length: days }, (_, i) =>
    startOfLocalDay(now, days - 1 - i).getTime()
  )
  const totals = new Array<number>(days).fill(0)
  for (const e of entries) {
    if (e.trackerId !== trackerId || e.delta === null) continue
    const at = Date.parse(e.at)
    if (at < starts[0]) continue
    let i = days - 1
    while (i > 0 && at < starts[i]) i--
    totals[i] += e.delta
  }
  return totals
}

/** A value tracker's readings since `since`, oldest first. */
export function readingsSince(entries: TrackerEntry[], trackerId: string, since: Date): number[] {
  const from = since.getTime()
  return entries
    .filter(e => e.trackerId === trackerId && Date.parse(e.at) >= from)
    .map(e => e.value)
    .reverse()
}

/** "09:41": the clock time of an entry, for a list already grouped by day. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** "Today", "Yesterday", or "Mon 9 Nov": the heading of a day group. */
export function formatDay(dayStart: Date, now: Date): string {
  const t = dayStart.getTime()
  if (t === startOfLocalDay(now).getTime()) return 'Today'
  if (t === startOfLocalDay(now, 1).getTime()) return 'Yesterday'
  return dayStart.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })
}

/** Entries (newest first) split into local days, newest day first. */
export function groupByDay(entries: TrackerEntry[]): { day: Date; entries: TrackerEntry[] }[] {
  const groups: { day: Date; entries: TrackerEntry[] }[] = []
  for (const e of entries) {
    const day = startOfLocalDay(new Date(e.at))
    const last = groups[groups.length - 1]
    if (last && last.day.getTime() === day.getTime()) last.entries.push(e)
    else groups.push({ day, entries: [e] })
  }
  return groups
}

/** What an entry did, as a row reads it: "+1 reps", "181.2 lb". */
export function describeEntry(entry: TrackerEntry, unit: string | null): string {
  const u = unit ? ` ${unit}` : ''
  return entry.delta === null
    ? `${formatTrackerNumber(entry.value)}${u}`
    : `${formatDelta(entry.delta)}${u}`
}

/** "−1.2 lb this week" / "Last 09:41" / "No readings yet" for a value tracker. */
export function valueSummary(tracker: Tracker, entries: TrackerEntry[], now: Date): string {
  const week = readingsSince(entries, tracker.id, startOfLocalDay(now, 6))
  const latest = entries.find(e => e.trackerId === tracker.id)
  if (!latest) return 'No readings yet'
  if (week.length < 2) return `Last ${formatClock(latest.at)}`
  const change = week[week.length - 1] - week[0]
  const unit = tracker.unit ? ` ${tracker.unit}` : ''
  if (change === 0) return 'No change this week'
  return `${formatDelta(change)}${unit} this week`
}

/** "Today +3 · 7 days +12" for a counter. */
export function counterSummary(tracker: Tracker, entries: TrackerEntry[], now: Date): string {
  const today = counterTotalSince(entries, tracker.id, startOfLocalDay(now))
  const week = counterTotalSince(entries, tracker.id, startOfLocalDay(now, 6))
  return `Today ${formatDelta(today)} · 7 days ${formatDelta(week)}`
}

/** Parse a typed number; null for blank or junk. Accepts a comma decimal. */
export function parseTrackerNumber(raw: string): number | null {
  const s = raw.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
