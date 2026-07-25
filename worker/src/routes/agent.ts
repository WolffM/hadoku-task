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
  DomainErrorSchema
} from '../schemas-agent'
import { DEFAULT_SESSION_ID } from '../constants'
import type { AppContext } from '../types'

const jsonErr = { 'application/json': { schema: DomainErrorSchema } }

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
      200: { description: 'Claimed', content: { 'application/json': { schema: ClaimResponseSchema } } },
      403: { description: 'Read-only access', content: jsonErr },
      404: { description: 'Board or task not found', content: jsonErr },
      409: { description: 'A live lease is held (CLAIM_HELD)', content: jsonErr },
      422: { description: 'Unknown destination lane', content: jsonErr }
    }
  })
  app.openapi(claimRoute, (async (c: any) => {
    const body = c.req.valid('json') as { board: string; taskId: string; agentId?: string; lane?: string | null; leaseSeconds?: number }
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
      200: { description: 'Extended', content: { 'application/json': { schema: HeartbeatResponseSchema } } },
      403: { description: 'Read-only access', content: jsonErr },
      404: { description: 'Board not found', content: jsonErr },
      409: { description: 'Lease was taken (LEASE_LOST)', content: jsonErr }
    }
  })
  app.openapi(heartbeatRoute, (async (c: any) => {
    const body = c.req.valid('json') as { board: string; taskId: string; token: string; leaseSeconds?: number }
    const ctx = await boardForWrite(c, body.board)
    if (ctx instanceof Response) return ctx
    const result = await heartbeatClaim(c.env.DB, ctx.ownerId, body.taskId, body.token, body.leaseSeconds)
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
      200: { description: 'Moved', content: { 'application/json': { schema: SetLaneResponseSchema } } },
      403: { description: 'Read-only access', content: jsonErr },
      404: { description: 'Board not found', content: jsonErr },
      409: { description: 'Lease was taken (LEASE_LOST)', content: jsonErr },
      422: { description: 'Unknown lane', content: jsonErr }
    }
  })
  app.openapi(setLaneRoute, (async (c: any) => {
    const body = c.req.valid('json') as { board: string; taskId: string; token: string; lane: string }
    const ctx = await boardForWrite(c, body.board)
    if (ctx instanceof Response) return ctx
    const result = await setLane(c.env.DB, ctx.ownerId, ctx.boardId, body.taskId, body.token, body.lane, {
      mode: ctx.mode,
      lanes: ctx.lanes
    })
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
      200: { description: 'Released', content: { 'application/json': { schema: ReleaseResponseSchema } } },
      403: { description: 'Read-only access', content: jsonErr },
      404: { description: 'Board or task not found', content: jsonErr },
      409: { description: 'Lease taken (LEASE_LOST) or lane changed (LANE_CHANGED)', content: jsonErr },
      422: { description: 'Unknown lane', content: jsonErr }
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
      200: { description: 'Dropped (idempotent)', content: { 'application/json': { schema: CancelResponseSchema } } },
      403: { description: 'Not the owner', content: jsonErr },
      404: { description: 'Board not found', content: jsonErr }
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
      200: { description: 'History (newest first)', content: { 'application/json': { schema: ClaimHistoryResponseSchema } } },
      404: { description: 'Board not found', content: jsonErr }
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
    request: { params: z.object({ ref: z.string().openapi({ param: { name: 'ref', in: 'path' }, example: 'main' }) }) },
    responses: {
      200: { description: 'Hydrated board', content: { 'application/json': { schema: HydratedBoardResponseSchema } } },
      404: { description: 'Board not found', content: jsonErr }
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
        ownerUserId: ctx.ownerId
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
        since: z.string().optional().openapi({ description: '"<updatedAt>,<id>" cursor from a prior call.' }),
        limit: z.string().optional().openapi({ description: 'Max rows (default 100, max 500).' })
      })
    },
    responses: {
      200: { description: 'Changes + next cursor', content: { 'application/json': { schema: ChangesResponseSchema } } }
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
