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
 * Get session ID from request header or auth context
 *
 * @param c - Hono context
 * @param auth - Auth context
 * @returns Session ID
 */
export function getSessionIdFromRequest(c: Context, auth: { sessionId?: string }): string {
  return c.req.header('X-Session-Id') || auth.sessionId || DEFAULT_SESSION_ID
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
