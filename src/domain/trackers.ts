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
