/**
 * Tracker-board API. Direct server calls, no localStorage mirror: the worker is
 * the only store for trackers, so every call is awaited and a refusal throws a
 * TrackerApiError carrying the server's own message for the caller to toast.
 */
import type {
  Tracker,
  TrackerBoardData,
  TrackerEntry,
  TrackerEntrySource,
  TrackerKind
} from '../domain/trackers'
import { adminHeaders } from './client-context'

export class TrackerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'TrackerApiError'
  }
}

export interface TrackerApi {
  list(boardRef: string): Promise<TrackerBoardData>
  createTracker(
    boardRef: string,
    input: { name: string; kind: TrackerKind; unit?: string | null }
  ): Promise<Tracker>
  updateTracker(
    boardRef: string,
    trackerId: string,
    patch: { name?: string; unit?: string | null; position?: number }
  ): Promise<Tracker>
  deleteTracker(boardRef: string, trackerId: string): Promise<void>
  logEntry(
    boardRef: string,
    trackerId: string,
    body: { delta?: number; value?: number; note?: string; source?: TrackerEntrySource }
  ): Promise<{ tracker: Tracker; entry: TrackerEntry }>
  deleteEntry(boardRef: string, trackerId: string, entryId: string): Promise<Tracker>
}

export function createTrackerApi(sessionId: string): TrackerApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`/task/api${path}`, {
        method,
        headers: adminHeaders(sessionId),
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    } catch {
      throw new TrackerApiError('Network error — the tracker was not updated', 0)
    }
    const data = (await res.json().catch(() => ({}))) as {
      error?: string | { message?: string }
      code?: string
    }
    if (!res.ok) {
      const msg = typeof data.error === 'string' ? data.error : data.error?.message
      throw new TrackerApiError(msg || `Request failed (${res.status})`, res.status, data.code)
    }
    return data as T
  }

  const trackers = (ref: string, rest = '') => `/boards/${encodeURIComponent(ref)}/trackers${rest}`
  const seg = encodeURIComponent

  return {
    async list(ref) {
      return call<TrackerBoardData>('GET', trackers(ref))
    },
    async createTracker(ref, input) {
      return (await call<{ tracker: Tracker }>('POST', trackers(ref), input)).tracker
    },
    async updateTracker(ref, id, patch) {
      return (await call<{ tracker: Tracker }>('PATCH', trackers(ref, `/${seg(id)}`), patch))
        .tracker
    },
    async deleteTracker(ref, id) {
      await call('DELETE', trackers(ref, `/${seg(id)}`))
    },
    async logEntry(ref, id, body) {
      return call<{ tracker: Tracker; entry: TrackerEntry }>(
        'POST',
        trackers(ref, `/${seg(id)}/entries`),
        body
      )
    },
    async deleteEntry(ref, id, entryId) {
      return (
        await call<{ tracker: Tracker }>(
          'DELETE',
          trackers(ref, `/${seg(id)}/entries/${seg(entryId)}`)
        )
      ).tracker
    }
  }
}
