/**
 * Route Utilities
 *
 * Shared helper functions for route handlers
 */
import type { Context } from 'hono'
import type { TaskStorage, AuthContext as TaskAuthContext } from '@wolffm/task/api'
import { createD1Storage } from './d1-storage'
import type { AppContext } from '../types'

/**
 * Helper to get storage and auth from context.
 *
 * Boards/tasks are stored in D1 (the KV→D1 cutover is complete). `legacyId` is
 * still passed so the D1 stats path can dual-read masked-key event rows written
 * before the userId flip.
 */
export const getContext = (c: Context<AppContext>) => {
  const auth = c.get('authContext')
  return { storage: createD1Storage(c.env, auth?.legacyId), auth }
}

/**
 * Parse an optimistic-concurrency `If-Match` request header into a board version.
 * Accepts a bare number (`3`) or a quoted ETag (`"3"`). Returns `undefined` when
 * absent or when `*` (clients opting out of the check) — legacy last-write-wins.
 */
export function parseIfMatch(c: Context<AppContext>): number | undefined {
  const raw = c.req.header('If-Match')
  if (!raw || raw === '*') return undefined
  const parsed = parseInt(raw.replace(/"/g, '').trim(), 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** Set the `ETag` response header from a versioned operation result, if present. */
function setVersionETag(c: Context<AppContext>, result: unknown): void {
  if (
    result &&
    typeof result === 'object' &&
    typeof (result as { version?: unknown }).version === 'number'
  ) {
    c.header('ETag', `"${(result as { version: number }).version}"`)
  }
}

/**
 * Generic handler wrapper for operations without locking
 */
export async function handleOperation<T>(
  c: Context<AppContext>,
  operation: (storage: TaskStorage, auth: TaskAuthContext) => Promise<T>
): Promise<Response> {
  const { storage, auth } = getContext(c)

  const result = await operation(storage, auth)
  return c.json(result)
}

/**
 * Simple in-memory lock to prevent concurrent writes to the same board
 *
 * IMPORTANT LIMITATION:
 * These locks are per-worker instance, NOT globally coordinated across all
 * Cloudflare Worker instances. This means:
 *
 * - ✅ Prevents race conditions within a single worker instance
 * - ❌ Does NOT prevent race conditions across multiple worker instances
 * - ✅ Acceptable for personal use (single user, low traffic)
 * - ❌ Not suitable for production multi-user deployments without Durable Objects
 *
 * For production deployments with multiple concurrent users, consider:
 * 1. Durable Objects - Provides true global coordination with single instance per board
 * 2. Optimistic locking - Use version numbers/ETags in KV metadata
 * 3. Accept eventual consistency - Document limitation and monitor for conflicts
 *
 * Current approach trades strong consistency for simplicity and cost (free tier).
 *
 * @see https://developers.cloudflare.com/durable-objects/ for global coordination
 */
const boardLocks = new Map<string, Promise<unknown>>()

export async function withBoardLock<T>(boardsKey: string, operation: () => Promise<T>): Promise<T> {
  // Wait for any existing operation on this board to complete
  const existingLock = boardLocks.get(boardsKey)
  if (existingLock) {
    await existingLock.catch(() => {
      // Ignore errors from previous operations
    })
  }

  // Create a new lock for this operation
  const newLock = operation()
  boardLocks.set(boardsKey, newLock)

  try {
    const result = await newLock
    return result
  } finally {
    // Clean up the lock if it's still ours
    if (boardLocks.get(boardsKey) === newLock) {
      boardLocks.delete(boardsKey)
    }
  }
}

/**
 * Generic handler wrapper for single-board operations (with locking)
 */
export async function handleBoardOperation<T>(
  c: Context<AppContext>,
  boardId: string,
  operation: (storage: TaskStorage, auth: TaskAuthContext) => Promise<T>
): Promise<Response> {
  const { storage, auth } = getContext(c)
  const boardsKey = `${auth.userType}:${auth.sessionId}:${boardId}`

  const result = await withBoardLock(boardsKey, async () => {
    return operation(storage, auth)
  })

  setVersionETag(c, result)
  return c.json(result)
}

/**
 * Generic handler wrapper for batch operations
 */
export async function handleBatchOperation<T>(
  c: Context<AppContext>,
  requiredFields: string[],
  operation: (
    storage: TaskStorage,
    auth: TaskAuthContext,
    body: Record<string, unknown>
  ) => Promise<T>,
  getBoardKeys?: (body: Record<string, unknown>, userType: string, sessionId: string) => string[]
): Promise<Response> {
  const { storage, auth } = getContext(c)
  const body = await c.req.json()

  // Validate required fields
  const { requireFields, badRequest } = await import('@wolffm/worker-utils')
  const error = requireFields(body, requiredFields)
  if (error) {
    return badRequest(c, error)
  }

  // If no board keys provided, no locking needed
  if (!getBoardKeys) {
    const result = await operation(storage, auth, body)
    return c.json(result)
  }

  // Get board keys and apply locks
  const boardsKeys = getBoardKeys(body, auth.userType, auth.sessionId || 'public')

  // Single board lock
  if (boardsKeys.length === 1) {
    const result = await withBoardLock(boardsKeys[0], async () => {
      return operation(storage, auth, body)
    })
    return c.json(result)
  }

  // Multiple board locks (in consistent order to prevent deadlocks)
  const sortedKeys = [...boardsKeys].sort()
  const result = await withBoardLock(sortedKeys[0], async () => {
    return withBoardLock(sortedKeys[1], async () => {
      return operation(storage, auth, body)
    })
  })
  return c.json(result)
}
