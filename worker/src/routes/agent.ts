/**
 * Agent claim-protocol routes (§4 / §5.7).
 *
 * claim / heartbeat / set-lane / release / cancel are the AGENT path: they need
 * WRITE access to the board (owner or contributor — a readonly grantee is
 * refused) and a live token, and they may write an `agent` lane the human path
 * can't (§5.2). history is a read; the change feed is caller-scoped.
 *
 * The worker performs no orchestration: it hands out leases and records
 * outcomes. "Eligible" is the runner's business, so there is no /agent/eligible.
 *
 * Declared with createRoute so the routes validate and appear in the OpenAPI spec.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { getBoardContext, type BoardCtx } from './route-utils'
import {
  claimTask,
  heartbeatClaim,
  setLane,
  releaseClaim,
  cancelClaim,
  getClaimHistory,
  getChanges,
  liveClaimedTaskIds
} from './board-claims'
import { getBoardConfig } from './board-automation'
import { detectPresetUpdate, warmPresets } from './preset-update'
import {
  ClaimInputSchema,
  ClaimResponseSchema,
  HeartbeatInputSchema,
  HeartbeatResponseSchema,
  SetLaneInputSchema,
  SetLaneResponseSchema,
  ReleaseInputSchema,
  ReleaseResponseSchema,
  CancelInputSchema,
  CancelResponseSchema,
  ClaimHistoryResponseSchema,
  ChangesResponseSchema,
  HydratedBoardResponseSchema,
  ForbiddenErrorSchema,
  BoardNotFoundErrorSchema,
  TaskOrBoardNotFoundErrorSchema,
  ClaimHeldErrorSchema,
  LeaseLostErrorSchema,
  ReleaseConflictErrorSchema,
  LaneUnknownErrorSchema,
  NotesTooLargeErrorSchema
} from '../schemas-agent'
import { DEFAULT_SESSION_ID } from '../constants'
import type { AppContext } from '../types'

// Each error response is typed to the codes THAT route+status can actually emit,
// so a generated client gets one exception class per outcome rather than a single
// 409 it has to re-parse. Derived from the handlers in board-claims.ts.
const forbidden = { 'application/json': { schema: ForbiddenErrorSchema } }
const boardNotFound = { 'application/json': { schema: BoardNotFoundErrorSchema } }
const taskOrBoardNotFound = { 'application/json': { schema: TaskOrBoardNotFoundErrorSchema } }
const claimHeld = { 'application/json': { schema: ClaimHeldErrorSchema } }
const leaseLost = { 'application/json': { schema: LeaseLostErrorSchema } }
const releaseConflict = { 'application/json': { schema: ReleaseConflictErrorSchema } }
const laneUnknown = { 'application/json': { schema: LaneUnknownErrorSchema } }
const notesTooLarge = { 'application/json': { schema: NotesTooLargeErrorSchema } }

/**
 * Resolve the board for a write on the agent path. Returns the resolved BoardCtx,
 * or a Response (404 unshared / 403 readonly) the caller returns as-is.
 */
async function boardForWrite(c: any, ref: string): Promise<BoardCtx | Response> {
  const ctx = await getBoardContext(c, ref)
  if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
  if (ctx.access === 'readonly') {
    return c.json({ error: 'Read-only access to this board', code: 'FORBIDDEN' }, 403)
  }
  return ctx
}

export function createAgentRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Claim a task (atomic). 409 CLAIM_HELD if a live lease exists.
  const claimRoute = createRoute({
    method: 'post',
    path: '/agent/claim',
    tags: ['Agent'],
    summary: 'Atomically claim a task',
    request: { body: { content: { 'application/json': { schema: ClaimInputSchema } } } },
    responses: {
      200: {
        description: 'Claimed',
        content: { 'application/json': { schema: ClaimResponseSchema } }
      },
      403: { description: 'Read-only access (FORBIDDEN)', content: forbidden },
      404: {
        description: 'Board or task not found (BOARD_NOT_FOUND | TASK_NOT_FOUND)',
        content: taskOrBoardNotFound
      },
      409: { description: 'A live lease is held (CLAIM_HELD)', content: claimHeld },
      422: { description: 'Unknown destination lane (LANE_UNKNOWN)', content: laneUnknown }
    }
  })
  app.openapi(claimRoute, (async (c: any) => {
    const body = c.req.valid('json') as {
      board: string
      taskId: string
      agentId?: string
      lane?: string | null
      leaseSeconds?: number
    }
    const ctx = await boardForWrite(c, body.board)
    if (ctx instanceof Response) return ctx
    const agentId = body.agentId || ctx.callerId
    const result = await claimTask(c.env.DB, ctx.ownerId, ctx.boardId, body.taskId, agentId, {
      lane: body.lane ?? null,
      leaseSeconds: body.leaseSeconds,
      mode: ctx.mode,
      lanes: ctx.lanes
    })
    return c.json(result)
  }) as never)

  // Extend a lease. 409 LEASE_LOST if the token no longer holds the claim.
  const heartbeatRoute = createRoute({
    method: 'post',
    path: '/agent/heartbeat',
    tags: ['Agent'],
    summary: 'Extend a lease',
    request: { body: { content: { 'application/json': { schema: HeartbeatInputSchema } } } },
    responses: {
      200: {
        description: 'Extended',
        content: { 'application/json': { schema: HeartbeatResponseSchema } }
      },
      403: { description: 'Read-only access (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound },
      409: { description: 'Lease was taken (LEASE_LOST)', content: leaseLost }
    }
  })
  app.openapi(heartbeatRoute, (async (c: any) => {
    const body = c.req.valid('json') as {
      board: string
      taskId: string
      token: string
      leaseSeconds?: number
    }
    const ctx = await boardForWrite(c, body.board)
    if (ctx instanceof Response) return ctx
    const result = await heartbeatClaim(
      c.env.DB,
      ctx.ownerId,
      body.taskId,
      body.token,
      body.leaseSeconds
    )
    return c.json({ ok: true, ...result })
  }) as never)

  // Move a task's lane while holding the claim.
  const setLaneRoute = createRoute({
    method: 'post',
    path: '/agent/set-lane',
    tags: ['Agent'],
    summary: 'Move a task while holding its claim (agent path)',
    request: { body: { content: { 'application/json': { schema: SetLaneInputSchema } } } },
    responses: {
      200: {
        description: 'Moved',
        content: { 'application/json': { schema: SetLaneResponseSchema } }
      },
      403: { description: 'Read-only access (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound },
      409: { description: 'Lease was taken (LEASE_LOST)', content: leaseLost },
      422: { description: 'Unknown lane (LANE_UNKNOWN)', content: laneUnknown }
    }
  })
  app.openapi(setLaneRoute, (async (c: any) => {
    const body = c.req.valid('json') as {
      board: string
      taskId: string
      token: string
      lane: string
    }
    const ctx = await boardForWrite(c, body.board)
    if (ctx instanceof Response) return ctx
    const result = await setLane(
      c.env.DB,
      ctx.ownerId,
      ctx.boardId,
      body.taskId,
      body.token,
      body.lane,
      {
        mode: ctx.mode,
        lanes: ctx.lanes
      }
    )
    return c.json(result)
  }) as never)

  // Release the claim: move to a lane, write notes/metadata, unclaim. Idempotent on token.
  const releaseRoute = createRoute({
    method: 'post',
    path: '/agent/release',
    tags: ['Agent'],
    summary: 'Release a claim (move + notes + unclaim)',
    request: { body: { content: { 'application/json': { schema: ReleaseInputSchema } } } },
    responses: {
      200: {
        description: 'Released',
        content: { 'application/json': { schema: ReleaseResponseSchema } }
      },
      403: { description: 'Read-only access (FORBIDDEN)', content: forbidden },
      404: {
        description: 'Board or task not found (BOARD_NOT_FOUND | TASK_NOT_FOUND)',
        content: taskOrBoardNotFound
      },
      409: {
        description: 'Lease taken (LEASE_LOST) or lane changed (LANE_CHANGED)',
        content: releaseConflict
      },
      413: {
        description: '`notes` exceeds the 64 KB limit (NOTES_TOO_LARGE) — nothing written',
        content: notesTooLarge
      },
      422: { description: 'Unknown lane (LANE_UNKNOWN)', content: laneUnknown }
    }
  })
  app.openapi(releaseRoute, (async (c: any) => {
    const body = c.req.valid('json') as {
      board: string
      taskId: string
      token: string
      lane?: string | null
      notes?: string | null
      outcome?: string | null
      ifCurrentLane?: string
      metadata?: Record<string, unknown> | null
      complete?: boolean
    }
    const ctx = await boardForWrite(c, body.board)
    if (ctx instanceof Response) return ctx
    const result = await releaseClaim(c.env.DB, ctx.ownerId, ctx.boardId, body.taskId, body.token, {
      lane: body.lane ?? null,
      notes: body.notes,
      outcome: body.outcome ?? null,
      ifCurrentLane: body.ifCurrentLane,
      metadata: body.metadata,
      complete: body.complete === true,
      mode: ctx.mode,
      lanes: ctx.lanes
    })
    return c.json(result)
  }) as never)

  // Cancel a claim — the board OWNER force-drops a stuck/held claim by hand.
  const cancelRoute = createRoute({
    method: 'post',
    path: '/agent/cancel',
    tags: ['Agent'],
    summary: 'Force-drop a claim (owner only)',
    request: { body: { content: { 'application/json': { schema: CancelInputSchema } } } },
    responses: {
      200: {
        description: 'Dropped (idempotent)',
        content: { 'application/json': { schema: CancelResponseSchema } }
      },
      403: { description: 'Not the owner (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(cancelRoute, (async (c: any) => {
    const body = c.req.valid('json') as { board: string; taskId: string }
    const ctx = await getBoardContext(c, body.board)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can cancel a claim', code: 'FORBIDDEN' }, 403)
    }
    const result = await cancelClaim(c.env.DB, ctx.ownerId, body.taskId)
    return c.json(result)
  }) as never)

  // Claim history for a task (read; any access to the board).
  const historyRoute = createRoute({
    method: 'get',
    path: '/agent/history',
    tags: ['Agent'],
    summary: 'Claim history for a task',
    request: {
      query: z.object({
        board: z.string().openapi({ example: 'main' }),
        task: z.string()
      })
    },
    responses: {
      200: {
        description: 'History (newest first)',
        content: { 'application/json': { schema: ClaimHistoryResponseSchema } }
      },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(historyRoute, (async (c: any) => {
    const { board: ref, task: taskId } = c.req.valid('query')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    const history = await getClaimHistory(c.env.DB, ctx.ownerId, taskId)
    return c.json({ history })
  }) as never)

  // One board, fully hydrated (§5.5): metadata (repo, mode, lanes) + its tasks,
  // each flagged `claimed` if a live lease holds it. Resolves through sharing.
  const hydratedRoute = createRoute({
    method: 'get',
    path: '/boards/{ref}',
    tags: ['Boards'],
    summary: 'One board, fully hydrated (tasks + claim state)',
    request: {
      params: z.object({
        ref: z.string().openapi({ param: { name: 'ref', in: 'path' }, example: 'main' })
      })
    },
    responses: {
      200: {
        description: 'Hydrated board',
        content: { 'application/json': { schema: HydratedBoardResponseSchema } }
      },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(hydratedRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    const cfg = await getBoardConfig(c.env.DB, ctx.ownerId, ctx.boardId)
    if (!cfg) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    const [file, claimed] = await Promise.all([
      ctx.storage.getTasks(ctx.auth.userType, ctx.auth.sessionId, ctx.boardId),
      liveClaimedTaskIds(c.env.DB, ctx.ownerId, ctx.boardId)
    ])

    // Is the board behind the contract it was activated from? Computed off the
    // task tags already loaded above and the preset cache as it stands — this
    // read must not inherit a provider's latency, so it never fetches. The warm
    // happens after the response is sent.
    const binding = c.env.AUTOMATION_PRESET_SOURCES
    const presetUpdate = detectPresetUpdate(binding, {
      access: ctx.access,
      mode: cfg.mode,
      schemaId: cfg.schemaId,
      schemaVersion: cfg.schemaVersion,
      // ACTIVE tags only. `toInbox` counts tasks a migration would strand, and a
      // completed task isn't going anywhere — counting it would report a real
      // migration where the board is actually safe.
      taskTags: file.tasks.filter(t => t.state === 'Active').map(t => t.tag)
    })
    if (ctx.access === 'owner' && cfg.mode === 'automation') {
      warmPresets(binding, c)
    }

    return c.json({
      board: {
        id: ctx.boardId,
        name: cfg.name,
        handle: cfg.handle,
        repo: cfg.repo,
        mode: cfg.mode,
        lanes: cfg.lanes,
        schemaId: cfg.schemaId,
        schemaVersion: cfg.schemaVersion,
        access: ctx.access,
        ownerUserId: ctx.ownerId,
        ...(presetUpdate ? { presetUpdate } : {})
      },
      tasks: file.tasks.map(t => ({ ...t, claimed: claimed.has(t.id) })),
      version: file.version ?? 1
    })
  }) as never)

  // Change feed (§4.4): the caller's own tasks since a cursor. `since` is
  // "<updated_at>,<id>"; omit for a full initial sweep.
  const changesRoute = createRoute({
    method: 'get',
    path: '/changes',
    tags: ['Agent'],
    summary: 'Change feed (poll instead of full-scanning)',
    request: {
      query: z.object({
        since: z
          .string()
          .optional()
          .openapi({ description: '"<updatedAt>,<id>" cursor from a prior call.' }),
        limit: z.string().optional().openapi({ description: 'Max rows (default 100, max 500).' })
      })
    },
    responses: {
      200: {
        description: 'Changes + next cursor',
        content: { 'application/json': { schema: ChangesResponseSchema } }
      }
    }
  })
  app.openapi(changesRoute, (async (c: any) => {
    const auth = c.get('authContext')
    const ownerId = auth?.sessionId ?? DEFAULT_SESSION_ID
    const { since, limit: limitStr } = c.req.valid('query')
    const limit = parseInt(limitStr ?? '100', 10)
    let cursor: { updatedAt: string; id: string } | null = null
    if (since) {
      const comma = since.lastIndexOf(',')
      if (comma > 0) cursor = { updatedAt: since.slice(0, comma), id: since.slice(comma + 1) }
    }
    const result = await getChanges(c.env.DB, ownerId, cursor, Number.isNaN(limit) ? 100 : limit)
    return c.json(result)
  }) as never)

  return app
}
