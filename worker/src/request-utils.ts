/**
 * Request Utilities for Task API
 *
 * Common utilities for extracting and validating request parameters.
 *
 * NOTE: Many generic utilities have been moved to @wolffm/worker-utils.
 * This file now contains only task-api-specific helpers.
 */
import type { Context } from 'hono'
import type { TaskStorage, AuthContext } from '@wolffm/task/api'
import { extractField, parseBody, isNonEmptyString } from '@wolffm/worker-utils'
import { DEFAULT_SESSION_ID, DEFAULT_BOARD_ID } from './constants'

/**
 * Get board ID from request synchronously (assumes body already parsed)
 *
 * @param c - Hono context
 * @param body - Parsed body object
 * @param defaultId - Default board ID if not found
 * @returns Board ID
 */
export function getBoardIdFromContext(
  c: Context,
  body: Record<string, unknown> = {},
  defaultId: string = DEFAULT_BOARD_ID
): string {
  const fromBody = typeof body.boardId === 'string' ? body.boardId : null
  return fromBody || extractField(c, ['query:boardId'], defaultId) || defaultId
}

/**
 * Get task ID from URL parameter
 *
 * @param c - Hono context
 * @param paramName - Parameter name (default: 'id')
 * @returns Task ID or null if not found
 */
export function getTaskIdFromParam(c: Context, paramName = 'id'): string | null {
  const id = c.req.param(paramName)
  return id || null
}

/**
 * The identity preferences are stored under, plus the stale namespaces to
 * recover from.
 */
export interface PrefsIdentity {
  /** Stable storage id. Preferences are read and written here. */
  id: string
  /**
   * Older namespaces this user's preferences may still sit under, most-likely
   * first. Read-only: the read path copies forward from these, never writes to
   * them.
   */
  legacyIds: string[]
}

/**
 * Resolve the identity preferences are keyed by.
 *
 * Preferences MUST use the same stable identity as boards and tasks: the
 * edge-injected `X-User-Id` (see the identity-scoping middleware in index.ts,
 * which sets `auth.userId` and points `auth.sessionId` at it).
 *
 * The raw `X-Session-Id` header is NOT a user identity. edge-router mints a
 * fresh random session id on every login (`generateSessionId()` — 16 random
 * bytes, workers/edge-router/src/session.ts), so keying preferences by it
 * orphans a user's settings on every new login and every new device. That is
 * precisely what produced the ~270 stranded 32-hex `prefs:{sessionId}` blobs
 * sitting in TASKS_KV for ~9 real users.
 *
 * `legacyIds` therefore carries every namespace the same user's preferences
 * could have been written to before this fix, so the read path can copy them
 * forward instead of silently serving defaults.
 */
export function resolvePrefsIdentity(
  c: Context,
  auth: { userId?: string; sessionId?: string; legacyId?: string; key?: string }
): PrefsIdentity {
  const id = auth.userId || auth.sessionId || DEFAULT_SESSION_ID

  // Ordered by how likely each is to hold this user's most recent preferences:
  // the session id the client is presenting right now, then the raw-credential
  // namespace that pre-dates the userId flip.
  const legacyIds: string[] = []
  for (const candidate of [c.req.header('X-Session-Id'), auth.legacyId, auth.key]) {
    if (!candidate || candidate === id || candidate === DEFAULT_SESSION_ID) continue
    if (!legacyIds.includes(candidate)) legacyIds.push(candidate)
  }

  return { id, legacyIds }
}

/**
 * Validate task ID (uses util's isNonEmptyString)
 *
 * @param id - Task ID to validate
 * @returns Error message or null if valid
 */
export function validateTaskId(id: string | null): string | null {
  if (!isNonEmptyString(id)) {
    return 'Missing required parameter: task ID'
  }
  return null
}

/**
 * Validate board ID (uses util's isNonEmptyString)
 *
 * @param id - Board ID to validate
 * @returns Error message or null if valid
 */
export function validateBoardId(id: string | null): string | null {
  if (!isNonEmptyString(id)) {
    return 'Missing required parameter: board ID'
  }
  return null
}

/**
 * Parse request body safely (wrapper around util's parseBody with default)
 *
 * @param c - Hono context
 * @returns Parsed body or empty object
 */
export function parseBodySafely(c: Context): Promise<Record<string, unknown>> {
  return parseBody(c, {})
}

/**
 * Create a task operation handler (for PATCH/DELETE/POST complete)
 * Handles common pattern: validate ID, parse body, get boardId, log, execute
 */
export function createTaskOperationHandler<T>(
  method: string,
  path: string,
  operation: (
    storage: TaskStorage,
    auth: AuthContext,
    taskId: string,
    boardId: string,
    body?: Record<string, unknown>
  ) => Promise<T>,
  handleBoardOperation: (
    c: Context,
    boardId: string,
    op: (storage: TaskStorage, auth: AuthContext) => Promise<T>
  ) => Promise<Response>,
  logRequest: (method: string, path: string, data: Record<string, unknown>) => void,
  logError: (method: string, path: string, error: unknown) => void,
  badRequest: (c: Context, message: string) => Response,
  _getContext: unknown
) {
  return async (c: Context) => {
    const id = getTaskIdFromParam(c)
    const validationError = validateTaskId(id)
    if (validationError || !id) {
      logError(method, path, validationError ?? 'Missing task ID')
      return badRequest(c, validationError ?? 'Missing task ID')
    }

    const taskId = id

    const body = await parseBodySafely(c)
    const boardId = getBoardIdFromContext(c, body, DEFAULT_BOARD_ID)

    logRequest(method, path.replace(':id', taskId), {
      userType: c.get('authContext').userType,
      boardId,
      taskId
    })

    return handleBoardOperation(c, boardId, (storage: TaskStorage, auth: AuthContext) =>
      operation(storage, auth, taskId, boardId, body)
    )
  }
}
