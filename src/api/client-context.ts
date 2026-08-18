/**
 * The shared half of the API client: the types callers import, the helpers every
 * method group uses, and the context they are handed.
 *
 * `createApi` is a closure — its methods reach for `localStorage`, `sessionId`,
 * `onSyncError` and a `snapshot` taken before an optimistic write. Splitting the
 * 27 methods into per-domain modules means naming that closure, which is what
 * ApiCtx is. Nothing here decides policy; client.ts still owns which branch a
 * caller gets and composes the groups.
 */
import type { TasksFile, BoardsFile, Task } from '../domain/types'
import { createLocalStorageApi } from './localStorageApi'
import { formatError } from '../domain/utils/tags'
import { logger } from '@wolffm/logger/client'

// Type for task updates (partial Task without id and createdAt)
export type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt'>>

// Helper for performance timing
export function now(): number {
  if (
    typeof window !== 'undefined' &&
    window.performance &&
    typeof window.performance.now === 'function'
  ) {
    return window.performance.now()
  }
  return Date.now()
}

/**
 * Sync API boards data to localStorage
 * Updates localStorage to match server state for offline access and cross-tab consistency
 */
export async function syncBoardsToLocalStorage(
  localApi: ReturnType<typeof createLocalStorageApi>,
  apiData: BoardsFile,
  userType: string,
  sessionId: string
) {
  // For each board in API response, update localStorage
  for (const board of apiData.boards || []) {
    const boardId = board.id

    // Update tasks for this board (always write, even if empty - to clear completed tasks)
    const tasksKey = `${userType}-${sessionId}-${boardId}-tasks`
    const tasksFile: TasksFile = {
      version: 1,
      updatedAt: apiData.updatedAt || new Date().toISOString(),
      tasks: board.tasks || []
    }
    window.localStorage.setItem(tasksKey, JSON.stringify(tasksFile))

    // Update stats for this board if present
    if (board.stats) {
      const statsKey = `${userType}-${sessionId}-${boardId}-stats`
      window.localStorage.setItem(statsKey, JSON.stringify(board.stats))
    }
  }

  // Update boards index. Persist the FULL board metadata (handle, ownerUserId,
  // access, pinned, position, mode, lanes, repo, schema…), stripping only the
  // bulky per-board tasks/stats — those live under their own keys (above). The
  // index used to keep just {id,name,tags}, so the cache-first paint rendered a
  // DEGRADED board set (no pins, no automation lanes, no sharing metadata) until
  // the network sync repainted — a visible two-stage flicker. Keeping every
  // field makes the cached paint structurally identical to the server's.
  const boardsKey = `${userType}-${sessionId}-boards`
  const boardsIndex = {
    version: 1,
    updatedAt: apiData.updatedAt || new Date().toISOString(),
    boards: (apiData.boards || []).map(({ tasks: _tasks, stats: _stats, ...meta }) => ({
      ...meta,
      tags: meta.tags || []
    }))
  }
  window.localStorage.setItem(boardsKey, JSON.stringify(boardsIndex))

  logger.info('[api] Synced API data to localStorage', {
    boards: apiData.boards?.length || 0,
    totalTasks: apiData.boards?.reduce((sum, b) => sum + (b.tasks?.length || 0), 0) || 0
  })
}

export function adminHeaders(userType: string, sessionId?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-User-Type': userType
  }
  if (sessionId) headers['X-Session-Id'] = sessionId
  return headers
}

/**
 * What the server said when it refused a background sync, when it said anything
 * useful. Without this a reporter can only say "something was rejected" — and for
 * a refusal the user caused and can act on (moving a task into a lane only the
 * agent may write), naming the reason is the whole difference between a usable
 * message and a shrug.
 */
export interface SyncErrorDetail {
  status: number
  /** The domain error code, e.g. `LANE_NOT_EDITABLE`. */
  code?: string
  /** The server's human-readable message, safe to show as-is. */
  message?: string
  /** The optimistic local write was rolled back, so the UI now matches the server. */
  reverted?: boolean
}

export type SyncErrorReporter = (
  operation: string,
  reason: 'http-error' | 'network',
  detail?: SyncErrorDetail
) => void

/**
 * A 4xx the server will give the same answer to however many times we ask —
 * the write is wrong, not the moment. `408`/`429` are the exceptions: both mean
 * "ask again", so they belong with the transient failures.
 *
 * This is the line an optimistic client has to draw somewhere: local state is
 * normally the source of truth and a failed sync is retried, but a definitive
 * refusal makes the local copy the WRONG one, and keeping it shows the user a
 * change that did not happen.
 */
export function isDefinitiveRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

/** Read a domain error body without letting a non-JSON response become a second failure. */
export async function readErrorDetail(r: globalThis.Response): Promise<SyncErrorDetail> {
  const detail: SyncErrorDetail = { status: r.status }
  try {
    const body = (await r.json()) as { error?: unknown; code?: unknown }
    if (typeof body?.code === 'string') detail.code = body.code
    if (typeof body?.error === 'string') detail.message = body.error
  } catch {
    /* an HTML error page or empty body — the status alone is what we have */
  }
  return detail
}

/**
 * Undo an optimistic local write the server then refused. Returns true when the
 * local state now matches the server's.
 *
 * Every one of these is a targeted inverse rather than a full `syncFromApi()`,
 * deliberately: a resync is authoritative but it overwrites EVERY board, which
 * would discard any other optimistic write still in flight. The narrow undo only
 * touches what this call changed.
 */
export type Undo = () => Promise<boolean> | boolean

/**
 * The refused-sync path, shared by `backgroundSync` and by `createTask`'s
 * hand-rolled fetch (which reads the server's id and so can't use the generic
 * helper). Reads the reason, undoes the write when the refusal is definitive, and
 * reports both in one call.
 */
export async function reportRefusal(
  r: globalThis.Response,
  operation: string,
  context: Record<string, unknown>,
  onError?: SyncErrorReporter,
  undo?: Undo,
  // A Response body reads once. When the caller already had to inspect it to
  // decide whether this IS a refusal, it passes the result in rather than
  // re-reading an exhausted stream.
  prereadDetail?: SyncErrorDetail
): Promise<void> {
  const detail = prereadDetail ?? (await readErrorDetail(r))
  logger.warn(`[api] ${operation}: Server sync returned error`, {
    status: r.status,
    code: detail.code,
    ...context
  })
  if (undo && isDefinitiveRefusal(r.status)) {
    try {
      detail.reverted = (await undo()) === true
      if (detail.reverted) {
        logger.info(`[api] ${operation}: reverted the optimistic write`, context)
      }
    } catch (revertErr) {
      // A failed undo leaves local ahead of the server — bad, but the reload the
      // reporter would have triggered is exactly what a resync fixes, and dying
      // here would also swallow the user-facing message.
      logger.error(`[api] ${operation}: could not revert the optimistic write`, {
        ...context,
        error: formatError(revertErr)
      })
    }
  }
  onError?.(operation, 'http-error', detail)
}

/**
 * Fire-and-forget server sync with consistent logging.
 * Used for optimistic updates where localStorage is source of truth.
 *
 * `undo` runs for a definitive 4xx before the error is reported, so the local
 * write is already rolled back by the time the user reads why.
 *
 * `missingIsDone` marks an IDEMPOTENT removal — a delete, whose goal state is
 * "the server does not have this". A TASK_NOT_FOUND 404 means it already holds
 * that state, so the write succeeded in every sense the user cares about.
 * Without this, the one status that means "already gone" was the one that put
 * the row BACK: 404 passes isDefinitiveRefusal, so the undo re-created the task
 * locally and the board showed it again on the next paint, for as long as the
 * delete kept 404ing.
 *
 * BOARD_NOT_FOUND is deliberately NOT swallowed. It is also a 404, but it means
 * the delete never ran — we named a board that does not exist — so the task is
 * still there. Treating that as success would drop it locally while the server
 * keeps it, which is a silent divergence that the next sync quietly undoes.
 */
export function backgroundSync(
  url: string,
  options: globalThis.RequestInit,
  operation: string,
  context: Record<string, unknown>,
  onError?: SyncErrorReporter,
  undo?: Undo,
  missingIsDone = false
): void {
  fetch(url, options)
    .then(async r => {
      if (missingIsDone && r.status === 404) {
        const detail = await readErrorDetail(r)
        if (detail.code !== 'BOARD_NOT_FOUND') {
          logger.info(
            `[api] ${operation}: already absent server-side — treating 404 as done`,
            context
          )
          return r
        }
        await reportRefusal(r, operation, context, onError, undo, detail)
      } else if (!r.ok) {
        await reportRefusal(r, operation, context, onError, undo)
      } else {
        logger.info(`[api] ${operation}: Server sync completed`, context)
      }
      return r
    })
    .catch(err => {
      logger.error(`[api] ${operation}: Server sync failed`, {
        ...context,
        error: formatError(err)
      })
      onError?.(operation, 'network')
    })
}

/**
 * Create optimistic API client
 * - All user types use localStorage for immediate updates
 * - "public" is localStorage-only, no server sync
 * - All other user types (friend, admin, custom names) sync to server in background
 */
export interface CreateApiOptions {
  onSyncError?: SyncErrorReporter
}

/**
 * Tiers this client distinguishes. Only `public` branches (localStorage-only);
 * every other tier syncs to the server, which is why the union can be widened
 * without touching a single call site. Kept complete anyway — a tier missing
 * here becomes a cast at every caller, which is how `service` went unlisted
 * for months while being passed in at runtime.
 */
export type TaskUserTier = 'public' | 'friend' | 'service' | 'wife' | 'admin'

/** What every method group needs from `createApi`, and nothing more. */
export interface ApiCtx {
  userType: TaskUserTier
  sessionId: string
  localStorage: ReturnType<typeof createLocalStorageApi>
  onSyncError?: SyncErrorReporter
  /**
   * The locally-cached task, read before an optimistic write so a refusal can
   * put it back. Never throws — an unreadable cache means no undo, which is
   * strictly better than no write.
   */
  snapshot: (boardId: string, taskId: string) => Promise<Task | null>
}
