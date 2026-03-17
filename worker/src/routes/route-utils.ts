/**
 * Route Utilities
 *
 * Shared helper functions for route handlers
 */
import type { Context } from 'hono'
import type {
  TaskStorage,
  AuthContext as TaskAuthContext,
  UserType,
  TasksFile,
  StatsFile,
  BoardsFile
} from '@wolffm/task/api'
import { boardsKey, tasksKey } from '../kv-keys'
import { DEFAULT_BOARD_ID, DEFAULT_BOARD_NAME } from '../constants'
import {
  getBoardStats as getD1BoardStats,
  getBoardTimeline,
  deleteBoardEvents,
  logTaskEvent
} from '../events'
import { maskKey } from '@wolffm/worker-utils'

interface Env {
  TASKS_KV: KVNamespace
  DB: D1Database
}

interface AppContext {
  Bindings: Env
  Variables: {
    authContext: TaskAuthContext
    context: { auth: TaskAuthContext }
  }
}

/**
 * Create KV-backed storage adapter for @wolffm/task package
 */
export function createKVStorage(env: Env): TaskStorage {
  return {
    // --- Boards ---
    async getBoards(userType: UserType, sessionId?: string): Promise<BoardsFile> {
      const kvKey = boardsKey(sessionId)
      const data = await env.TASKS_KV.get<BoardsFile>(kvKey, 'json')
      if (data) return data
      // Default with a single default board
      return {
        version: 1,
        boards: [{ id: DEFAULT_BOARD_ID, name: DEFAULT_BOARD_NAME, tags: [], tasks: [] }],
        updatedAt: new Date().toISOString()
      }
    },
    async saveBoards(userType: UserType, boards: BoardsFile, sessionId?: string): Promise<void> {
      const kvKey = boardsKey(sessionId)
      await env.TASKS_KV.put(kvKey, JSON.stringify(boards))
    }, // --- Tasks (board scoped) ---
    async getTasks(userType: UserType, sessionId?: string, boardId?: string) {
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const kvKey = tasksKey(sessionId, boardId)
      const data = await env.TASKS_KV.get<TasksFile>(kvKey, 'json')
      if (data) return data
      return {
        version: 1,
        tasks: [],
        updatedAt: new Date().toISOString()
      }
    },
    async saveTasks(
      userType: UserType,
      sessionId: string | undefined,
      boardId: string | undefined,
      tasks: TasksFile
    ) {
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const kvKey = tasksKey(sessionId, boardId)
      await env.TASKS_KV.put(kvKey, JSON.stringify(tasks))
    },

    // --- Stats (board scoped) - NOW USING D1 ---
    async getStats(userType: UserType, sessionId?: string, boardId?: string): Promise<StatsFile> {
      if (!boardId) boardId = DEFAULT_BOARD_ID
      // Mask the session ID to 50% for D1 storage/queries (consistent with monitoring-logs)
      const userKey = sessionId ? maskKey(sessionId) : 'public'

      // Query D1 for real-time stats
      const counters = await getD1BoardStats(env.DB, userKey, boardId)
      const timeline = await getBoardTimeline(env.DB, userKey, boardId, 100)

      return {
        version: 2,
        counters,
        timeline: timeline.map(event => ({
          t: event.timestamp,
          event: event.event as 'created' | 'completed' | 'edited' | 'deleted',
          id: event.id
        })),
        tasks: {}, // Deprecated - no longer storing full task history
        updatedAt: new Date().toISOString()
      }
    },
    async saveStats(
      userType: UserType,
      sessionId: string | undefined,
      boardId: string | undefined,
      stats: StatsFile
    ): Promise<void> {
      // Extract new events from stats.timeline and log to D1
      // The @wolffm/task package passes stats with timeline, we extract the latest event
      if (!boardId) boardId = DEFAULT_BOARD_ID
      // Mask the session ID to 50% for D1 storage (consistent with monitoring-logs)
      const userKey = sessionId ? maskKey(sessionId) : 'public'

      // Get the most recent event from timeline (last one added)
      if (stats.timeline && stats.timeline.length > 0) {
        const latestEvent = stats.timeline[stats.timeline.length - 1]

        // Log to D1
        await logTaskEvent(env.DB, {
          userKey,
          boardId,
          taskId: latestEvent.id || '',
          eventType: latestEvent.event,
          metadata: undefined
        })
      }
    }, // --- Delete board data ---
    async deleteBoardData(userType: UserType, sessionId: string, boardId: string) {
      // Delete tasks from KV and events from D1
      const taskKey = tasksKey(sessionId, boardId)
      // Use masked sessionId for D1 operations
      const maskedSessionId = maskKey(sessionId)
      await Promise.all([
        env.TASKS_KV.delete(taskKey),
        deleteBoardEvents(env.DB, maskedSessionId, boardId)
      ])
    }
  }
}

/**
 * Helper to get storage and auth from context
 */
export const getContext = (c: Context<AppContext>) => ({
  storage: createKVStorage(c.env),
  auth: c.get('authContext')
})

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
