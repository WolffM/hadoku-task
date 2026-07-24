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
import { createD1Storage } from './d1-storage'
import { boardsKey, tasksKey } from '../kv-keys'
import { DEFAULT_BOARD_ID, DEFAULT_BOARD_NAME } from '../constants'
import {
  getBoardStats as getD1BoardStats,
  getBoardTimeline,
  deleteBoardEvents,
  logTaskEvent
} from '../events'
import { maskKey } from '@wolffm/worker-utils'
import type { AppContext, Env } from '../types'

/**
 * Create KV-backed storage adapter for @wolffm/task package.
 *
 * `legacyId` is the RAW-credential namespace a user's data lived under before
 * storage moved to userId scoping (see the identity-scoping middleware in
 * index.ts). When present, reads DUAL-READ: try the userId namespace first, and
 * on a miss fall back to the legacy raw-key namespace and COPY-FORWARD the hit
 * (read-repair) so the entry migrates exactly once, lazily, from whatever the
 * live legacy data currently is.
 *
 * Doing the migration lazily on read — rather than trusting an ahead-of-time
 * bulk copy — is what makes it race-free: a write that landed in the legacy
 * namespace after any bulk copy is still the source of truth until the first
 * post-flip read migrates it. Writes always go to the userId namespace only.
 */
export function createKVStorage(env: Env, legacyId?: string): TaskStorage {
  /**
   * Read `primaryKey`; on a miss, fall back to `legacyKey` and copy the value
   * forward into `primaryKey`. Returns null when neither exists.
   */
  async function readWithRepair<T>(
    primaryKey: string,
    legacyKey: string | null
  ): Promise<T | null> {
    const hit = await env.TASKS_KV.get<T>(primaryKey, 'json')
    if (hit) return hit
    if (!legacyKey || legacyKey === primaryKey) return null
    const legacy = await env.TASKS_KV.get<T>(legacyKey, 'json')
    if (!legacy) return null
    // Read-repair: migrate into the userId namespace so later reads hit directly.
    // The legacy entry is intentionally left in place — a later cleanup step
    // prunes it once the flip has soaked, so a rollback stays possible.
    await env.TASKS_KV.put(primaryKey, JSON.stringify(legacy))
    return legacy
  }

  return {
    // --- Boards ---
    async getBoards(userType: UserType, sessionId?: string): Promise<BoardsFile> {
      const data = await readWithRepair<BoardsFile>(
        boardsKey(sessionId),
        legacyId ? boardsKey(legacyId) : null
      )
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
      const data = await readWithRepair<TasksFile>(
        tasksKey(sessionId, boardId),
        legacyId ? tasksKey(legacyId, boardId) : null
      )
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
    // KV has no cross-key transaction, so this is best-effort concurrent puts —
    // the same non-atomic behaviour batchMoveTasks had before D1. The D1 adapter
    // makes it truly atomic; this legacy path is unchanged.
    async batchSaveTasks(
      userType: UserType,
      sessionId: string | undefined,
      writes: Array<{ boardId: string; tasks: TasksFile }>
    ) {
      await Promise.all(
        writes.map(w =>
          env.TASKS_KV.put(
            tasksKey(sessionId, w.boardId || DEFAULT_BOARD_ID),
            JSON.stringify(w.tasks)
          )
        )
      )
    },

    // --- Stats (board scoped) - NOW USING D1 ---
    async getStats(userType: UserType, sessionId?: string, boardId?: string): Promise<StatsFile> {
      if (!boardId) boardId = DEFAULT_BOARD_ID
      // Mask the session ID to 50% for D1 storage/queries (consistent with monitoring-logs)
      const userKey = sessionId ? maskKey(sessionId) : 'public'

      // Query D1 for real-time stats
      let counters = await getD1BoardStats(env.DB, userKey, boardId)
      let timeline = await getBoardTimeline(env.DB, userKey, boardId, 100)

      // Dual-read: rows written before the userId flip are keyed by the masked RAW
      // credential. Until the one-time D1 rewrite moves them, fall back to that
      // namespace when the userId namespace has nothing yet, so historical stats
      // stay visible. No copy-forward here — moving rows is the migration
      // script's job (a copy would double-count). Once the rewrite has run, the
      // legacy key matches zero rows and this is a no-op.
      const noRows = timeline.length === 0 && Object.values(counters).every(v => !v || v === 0)
      if (noRows && legacyId) {
        const legacyKey = maskKey(legacyId)
        if (legacyKey !== userKey) {
          counters = await getD1BoardStats(env.DB, legacyKey, boardId)
          timeline = await getBoardTimeline(env.DB, legacyKey, boardId, 100)
        }
      }

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
      const deletions: Promise<unknown>[] = [
        env.TASKS_KV.delete(taskKey),
        deleteBoardEvents(env.DB, maskedSessionId, boardId)
      ]
      // CRITICAL: also purge the pre-flip raw-key namespace. Without this, the
      // delete would remove only the userId copy and the very next read would
      // dual-read the surviving legacy entry and RESURRECT the deleted board.
      // Same for its D1 events, which are still keyed by the masked raw
      // credential until the one-time rewrite runs.
      if (legacyId && legacyId !== sessionId) {
        deletions.push(
          env.TASKS_KV.delete(tasksKey(legacyId, boardId)),
          deleteBoardEvents(env.DB, maskKey(legacyId), boardId)
        )
      }
      await Promise.all(deletions)
    }
  }
}

/**
 * Helper to get storage and auth from context
 */
export const getContext = (c: Context<AppContext>) => {
  const auth = c.get('authContext')
  // Pass the pre-flip raw-credential namespace so storage can dual-read +
  // read-repair it. Undefined for callers that never flipped (no X-User-Id).
  // TASK_STORAGE=d1 flips to the D1-backed adapter (T1 cutover); it migrates
  // each user's KV blob into D1 lazily on first read. Default stays KV so the
  // flip is a deploy-time var, independently rollback-able.
  const storage =
    c.env.TASK_STORAGE === 'd1'
      ? createD1Storage(c.env, auth?.legacyId)
      : createKVStorage(c.env, auth?.legacyId)
  return { storage, auth }
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
