/**
 * Agent claim-protocol routes (§4 / §5.7).
 *
 * claim / heartbeat / set-lane / release are the AGENT path: they need WRITE
 * access to the board (owner or contributor — a readonly grantee is refused) and
 * a live token, and they may write an `agent` lane the human path can't (§5.2).
 * history is a read; the change feed is caller-scoped to the caller's own data.
 *
 * The worker performs no orchestration: it hands out leases and records
 * outcomes. "Eligible" is the runner's business, so there is no /agent/eligible.
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import { badRequest } from '@wolffm/worker-utils'
import { logRequest } from '../logger'
import { getBoardContext, type BoardCtx } from './route-utils'
import {
  claimTask,
  heartbeatClaim,
  setLane,
  releaseClaim,
  getClaimHistory,
  getChanges
} from './board-claims'
import { DEFAULT_SESSION_ID } from '../constants'
import type { AppContext } from '../types'

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
  app.post('/agent/claim', async (c: any) => {
    let body: { board?: string; taskId?: string; agentId?: string; lane?: string | null; leaseSeconds?: number }
    try {
      body = await c.req.json()
    } catch {
      return badRequest(c, 'Invalid JSON body')
    }
    if (!body.board || !body.taskId) return badRequest(c, '`board` and `taskId` are required')
    const ctx = await boardForWrite(c, body.board)
    if (ctx instanceof Response) return ctx

    const agentId = body.agentId || ctx.callerId
    logRequest('POST', '/task/api/agent/claim', { board: ctx.boardId, task: body.taskId, agent: agentId.slice(0, 8) })
    const result = await claimTask(c.env.DB, ctx.ownerId, ctx.boardId, body.taskId, agentId, {
      lane: body.lane ?? null,
      leaseSeconds: body.leaseSeconds,
      mode: ctx.mode,
      lanes: ctx.lanes
    })
    return c.json(result)
  })

  // Extend a lease. 409 LEASE_LOST if the token no longer holds the claim.
  app.post('/agent/heartbeat', async (c: any) => {
    let body: { board?: string; taskId?: string; token?: string; leaseSeconds?: number }
    try {
      body = await c.req.json()
    } catch {
      return badRequest(c, 'Invalid JSON body')
    }
    if (!body.board || !body.taskId || !body.token) {
      return badRequest(c, '`board`, `taskId` and `token` are required')
    }
    const ctx = await boardForWrite(c, body.board)
    if (ctx instanceof Response) return ctx
    const result = await heartbeatClaim(c.env.DB, ctx.ownerId, body.taskId, body.token, body.leaseSeconds)
    return c.json({ ok: true, ...result })
  })

  // Move a task's lane while holding the claim.
  app.post('/agent/set-lane', async (c: any) => {
    let body: { board?: string; taskId?: string; token?: string; lane?: string }
    try {
      body = await c.req.json()
    } catch {
      return badRequest(c, 'Invalid JSON body')
    }
    if (!body.board || !body.taskId || !body.token || body.lane === undefined) {
      return badRequest(c, '`board`, `taskId`, `token` and `lane` are required')
    }
    const ctx = await boardForWrite(c, body.board)
    if (ctx instanceof Response) return ctx
    const result = await setLane(c.env.DB, ctx.ownerId, ctx.boardId, body.taskId, body.token, body.lane, {
      mode: ctx.mode,
      lanes: ctx.lanes
    })
    return c.json(result)
  })

  // Release the claim: move to a lane, write notes, unclaim. Idempotent on token.
  app.post('/agent/release', async (c: any) => {
    let body: {
      board?: string
      taskId?: string
      token?: string
      lane?: string | null
      notes?: string | null
      outcome?: string | null
      ifCurrentLane?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return badRequest(c, 'Invalid JSON body')
    }
    if (!body.board || !body.taskId || !body.token) {
      return badRequest(c, '`board`, `taskId` and `token` are required')
    }
    const ctx = await boardForWrite(c, body.board)
    if (ctx instanceof Response) return ctx
    logRequest('POST', '/task/api/agent/release', { board: ctx.boardId, task: body.taskId })
    const result = await releaseClaim(c.env.DB, ctx.ownerId, ctx.boardId, body.taskId, body.token, {
      lane: body.lane ?? null,
      notes: body.notes,
      outcome: body.outcome ?? null,
      ifCurrentLane: body.ifCurrentLane,
      mode: ctx.mode,
      lanes: ctx.lanes
    })
    return c.json(result)
  })

  // Claim history for a task (read; any access to the board).
  app.get('/agent/history', async (c: any) => {
    const ref = c.req.query('board')
    const taskId = c.req.query('task')
    if (!ref || !taskId) return badRequest(c, '`board` and `task` query params are required')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    const history = await getClaimHistory(c.env.DB, ctx.ownerId, taskId)
    return c.json({ history })
  })

  // Change feed (§4.4): the caller's own tasks since a cursor. `since` is
  // "<updated_at>,<id>"; omit for a full initial sweep.
  app.get('/changes', async (c: any) => {
    const auth = c.get('authContext')
    const ownerId = auth?.sessionId ?? DEFAULT_SESSION_ID
    const since = c.req.query('since')
    const limit = parseInt(c.req.query('limit') ?? '100', 10)
    let cursor: { updatedAt: string; id: string } | null = null
    if (since) {
      const comma = since.lastIndexOf(',')
      if (comma > 0) cursor = { updatedAt: since.slice(0, comma), id: since.slice(comma + 1) }
    }
    const result = await getChanges(c.env.DB, ownerId, cursor, Number.isNaN(limit) ? 100 : limit)
    return c.json(result)
  })

  return app
}
