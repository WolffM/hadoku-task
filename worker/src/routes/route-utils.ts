/**
 * Route Utilities
 *
 * Shared helper functions for route handlers
 */
import type { Context } from 'hono'
import type { TaskStorage, AuthContext as TaskAuthContext, Lane } from '@wolffm/task/api'
import { createD1Storage } from './d1-storage'
import { resolveBoardAccess, type Access } from './board-sharing'
import {
  parseLanes,
  assertHumanLaneWrite,
  notifyLaneWrite,
  githubToken,
  runnerRepo
} from './board-automation'
import { DEFAULT_SESSION_ID, DEFAULT_BOARD_ID } from '../constants'
import type { AppContext, Env } from '../types'

/**
 * The board-scoped context (§7): the owner's data scope + the caller's access.
 * `auth.sessionId` is the OWNER's id; `callerId`/`access` carry authorisation.
 */
export interface BoardCtx {
  storage: TaskStorage
  auth: TaskAuthContext & { callerId: string; access: Access }
  boardId: string
  access: Access
  isOwn: boolean
  ownerId: string
  callerId: string
  /** 'standard' | 'automation' — selects lane enforcement (§5.2). */
  mode: string
  /** The board's lane set (empty on a standard board). */
  lanes: Lane[]
}

/**
 * Transport-agnostic core of {@link getBoardContext}: resolve a board `ref` to
 * its owner + the caller's access, returning an owner-scoped storage/auth. Used
 * by both the HTTP routes (via getBoardContext) and the MCP tools, so a shared
 * board resolves identically no matter which surface a caller drives.
 *
 * Returns null when `ref` is a real handle the caller has no share for.
 */
export async function resolveBoardCtx(
  env: Env,
  auth: (TaskAuthContext & { legacyId?: string; sessionId?: string }) | undefined,
  ref: string
): Promise<BoardCtx | null> {
  const callerId = auth?.sessionId ?? DEFAULT_SESSION_ID
  const res = await resolveBoardAccess(env.DB, callerId, ref)
  if (!res) return null
  const isOwn = res.ownerId === callerId
  // Read-repair only applies to the caller's own pre-flip namespace; a shared
  // board's data is the owner's and already in D1, so no legacy fallback there.
  const storage = createD1Storage(env, isOwn ? auth?.legacyId : undefined)
  const scopedAuth = {
    ...(auth as TaskAuthContext),
    sessionId: res.ownerId,
    callerId,
    access: res.access
  }
  return {
    storage,
    auth: scopedAuth,
    boardId: res.boardId,
    access: res.access,
    isOwn,
    ownerId: res.ownerId,
    callerId,
    mode: res.mode,
    lanes: parseLanes(res.lanesJson)
  }
}

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
 * Board-aware context (§7). Resolves a board reference to its owner + the
 * caller's access level, then returns a context whose `auth.sessionId` is the
 * OWNER's id (the data scope) with `callerId` + `access` carried alongside for
 * authorisation. Own boards resolve to the caller with 'owner' access, so this
 * is a no-op for the common path.
 *
 * Returns null when the ref is a real handle the caller has no share for
 * (forbidden / not found — the route answers 404).
 */
export function getBoardContext(c: Context<AppContext>, ref: string): Promise<BoardCtx | null> {
  return resolveBoardCtx(c.env, c.get('authContext'), ref)
}

/**
 * The board a task operation targets — ONE rule for every task route.
 *
 * The reference may arrive in the request BODY (`board`, or its older name
 * `boardId`) or as a QUERY parameter of either name; body wins, then query, then
 * the default board. Create used to read the body only and delete the query
 * only, so the same integrator had to encode the same board two different ways
 * depending on which verb it was calling. Both forms now work on both.
 *
 * The value is a board REFERENCE, resolved by resolveBoardCtx: the caller's own
 * slug, or the globally-unique `handle` of a board shared with them.
 */
export function boardRefFrom(
  c: Context<AppContext>,
  body?: Record<string, unknown> | null
): string {
  const fromBody = [body?.board, body?.boardId].find(v => typeof v === 'string' && v !== '')
  return (
    (fromBody as string | undefined) ??
    c.req.query('board') ??
    c.req.query('boardId') ??
    DEFAULT_BOARD_ID
  )
}

/** Body keys that carry the board reference, stripped before a task is built from it. */
export const BOARD_REF_KEYS = ['board', 'boardId'] as const

/**
 * Drop the board-reference keys from a request body, leaving the task fields.
 * Both names are accepted on the wire (see {@link boardRefFrom}), so both have
 * to come off before the rest is treated as task input. Both are optional in
 * every input schema, so the result still satisfies the body's own type.
 */
export function withoutBoardRef<T extends object>(body: T): T {
  const rest = { ...body } as Record<string, unknown>
  for (const key of BOARD_REF_KEYS) delete rest[key]
  return rest as T
}

/**
 * The key concurrent writes to one board serialise on.
 *
 * Scoped to the board's OWNER + slug — exactly the storage key (D1 rows are
 * keyed on user_id + board_id) and nothing else. It deliberately does NOT fold
 * in the caller's tier: resolveBoardCtx points `auth.sessionId` at the owner but
 * leaves `auth.userType` as the CALLER's tier, so a key built from both gave an
 * admin owner and a service-tier grantee two different locks for the same board.
 * They didn't serialise, and saveTasks' read-modify-write then dropped one of
 * the two writes outright. userType isn't part of the storage key, so it isn't
 * part of the lock key.
 */
export function boardLockKey(ownerId: string | undefined, boardId: string): string {
  return `board:${ownerId ?? DEFAULT_SESSION_ID}:${boardId}`
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
 * Generic handler wrapper for single-board operations (with locking).
 *
 * Board-aware (§7): the `boardId` is resolved to its owner + the caller's access
 * level. Handlers then run against the OWNER's data scope. `write` gates the
 * operation on access — a readonly grantee is refused, an unshared board 404s.
 *
 * `laneTag` opts into automation lane enforcement (§5.2): when the key is
 * present, the value is the tag this HUMAN-path write would land the task in,
 * and it's validated against the board's lanes (throws 403/422). Omit the key
 * for writes that don't touch the tag (complete, delete, schedule). It also
 * arms the outbound wake dispatch, which needs `taskId` to name what moved.
 */
export async function handleBoardOperation<T>(
  c: Context<AppContext>,
  boardId: string,
  // The operation receives the RESOLVED owner's board slug as its third arg —
  // for a shared board addressed by handle, that differs from `boardId`, and the
  // handler must scope by the owner's slug, not the handle.
  operation: (storage: TaskStorage, auth: TaskAuthContext, resolvedBoardId: string) => Promise<T>,
  opts: { write?: boolean; laneTag?: string | null; taskId?: string } = {}
): Promise<Response> {
  const ctx = await getBoardContext(c, boardId)
  if (!ctx) {
    return c.json({ error: `Board ${boardId} not found`, code: 'BOARD_NOT_FOUND' }, 404)
  }
  if (opts.write && ctx.access === 'readonly') {
    return c.json({ error: 'Read-only access to this board', code: 'FORBIDDEN' }, 403)
  }
  // Automation lane enforcement (§5.2): the human path may only land a task in a
  // `user` lane. Throws LaneInvalidError (422) / LaneNotEditableError (403),
  // mapped to their status by the app-level onError handler.
  if ('laneTag' in opts && ctx.mode === 'automation') {
    assertHumanLaneWrite(ctx.lanes, opts.laneTag)
  }
  const { storage, auth } = ctx
  // Lock on the OWNER's namespace so concurrent writes from owner + grantees to
  // the same shared board serialise on the same key, whatever tier each caller is.
  const boardsKey = boardLockKey(ctx.ownerId, ctx.boardId)

  const result = await withBoardLock(boardsKey, async () => {
    return operation(storage, auth as TaskAuthContext, ctx.boardId)
  })

  // Wake the board's runner AFTER the write commits — a dispatch for a write that
  // then threw would send the pipeline looking for a task that never moved. A
  // failed dispatch never fails the human's write: notifyLaneWrite can't throw.
  if ('laneTag' in opts && opts.taskId) {
    await notifyLaneWrite(
      {
        db: c.env.DB,
        ownerId: ctx.ownerId,
        boardId: ctx.boardId,
        taskId: opts.taskId,
        laneTag: opts.laneTag,
        lanes: ctx.lanes,
        mode: ctx.mode,
        token: githubToken(c.env),
        runnerRepo: runnerRepo(c.env)
      },
      c
    )
  }

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
  // Batch ops are caller-scoped (no share resolution), so the caller IS the
  // owner here — but the key must still be built with boardLockKey so a batch
  // write serialises against the single-task writes on the same board.
  getBoardKeys?: (body: Record<string, unknown>, sessionId: string) => string[]
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
  const boardsKeys = getBoardKeys(body, auth.sessionId || DEFAULT_SESSION_ID)

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
