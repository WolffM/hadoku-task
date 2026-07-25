/**
 * Board share management routes (§7).
 *
 * Owner-only: grant, list, revoke. Grantee-only: leave (remove own access).
 * Grantee identity is resolved by KEY via the read-only SESSIONS_KV registry
 * (never stored, never logged), or by a raw userId. A board is addressed by the
 * same ref (slug/handle) as everywhere else and resolved through getBoardContext.
 *
 * Routes are declared with createRoute so they both validate and appear in the
 * generated OpenAPI spec (schemas-agent.ts).
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { badRequest } from '@wolffm/worker-utils'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { listShares, upsertShare, removeShare, resolveOwnBoard } from './board-sharing'
import {
  GrantShareInputSchema,
  GrantShareResponseSchema,
  ListSharesResponseSchema,
  LeaveShareResponseSchema,
  RevokeShareResponseSchema,
  DomainErrorSchema
} from '../schemas-agent'
import { ErrorResponseSchema } from '../schemas'
import type { AppContext, Env } from '../types'

type Level = 'readonly' | 'contributor'

/** Resolve a grantee key → userId via the SESSIONS_KV registry, or accept a raw userId. */
async function resolveGrantee(
  env: Env,
  input: { key?: string; userId?: string }
): Promise<{ userId: string; name?: string } | { error: string }> {
  if (input.userId) return { userId: input.userId }
  const key = input.key
  if (!key) return { error: 'Provide `key` (grantee access key) or `userId`.' }
  if (!env.SESSIONS_KV) return { error: 'Key resolution unavailable; pass `userId` instead.' }
  const raw = await env.SESSIONS_KV.get(`key:${key}`)
  if (!raw) return { error: 'That key is not registered.' }
  let rec: { userId?: string; name?: string }
  try {
    rec = JSON.parse(raw) as { userId?: string; name?: string }
  } catch {
    return { error: 'Registry record is unreadable.' }
  }
  // userId is lazily minted on first sign-in; a key that never signed in has none.
  if (!rec.userId) return { error: 'That key has never signed in, so it has no id yet.' }
  return { userId: rec.userId, name: rec.name }
}

const nowIso = () => new Date().toISOString()

const jsonErr = { 'application/json': { schema: DomainErrorSchema } }
const simpleErr = { 'application/json': { schema: ErrorResponseSchema } }
const refParam = z.object({ ref: z.string().openapi({ param: { name: 'ref', in: 'path' }, example: 'main' }) })

export function createShareRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Grant (or update) a share — owner only.
  const grantRoute = createRoute({
    method: 'post',
    path: '/boards/{ref}/shares',
    tags: ['Sharing'],
    summary: 'Grant a board share (owner only)',
    request: { params: refParam, body: { content: { 'application/json': { schema: GrantShareInputSchema } } } },
    responses: {
      200: { description: 'Share granted', content: { 'application/json': { schema: GrantShareResponseSchema } } },
      400: { description: 'Invalid grantee', content: simpleErr },
      403: { description: 'Not the owner', content: jsonErr },
      404: { description: 'Board not found', content: jsonErr }
    }
  })
  app.openapi(grantRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can manage shares', code: 'FORBIDDEN' }, 403)
    }
    const body = c.req.valid('json') as { key?: string; userId?: string; level: Level }

    const grantee = await resolveGrantee(c.env, { key: body.key, userId: body.userId })
    if ('error' in grantee) return badRequest(c, grantee.error)
    if (grantee.userId === ctx.ownerId) {
      return badRequest(c, 'The owner already has full access.')
    }

    // Never log the key — only the (masked) resolved id + display name.
    logRequest('POST', `/task/api/boards/${ref}/shares`, {
      board: ctx.boardId,
      grantee: `${grantee.userId.slice(0, 8)}…`,
      level: body.level
    })

    await upsertShare(c.env.DB, ctx.ownerId, ctx.boardId, grantee.userId, body.level, nowIso())
    return c.json({ ok: true, granteeUserId: grantee.userId, granteeName: grantee.name, level: body.level })
  }) as never)

  // List shares on a board — owner only.
  const listRoute = createRoute({
    method: 'get',
    path: '/boards/{ref}/shares',
    tags: ['Sharing'],
    summary: 'List a board\'s shares (owner only)',
    request: { params: refParam },
    responses: {
      200: { description: 'The shares', content: { 'application/json': { schema: ListSharesResponseSchema } } },
      403: { description: 'Not the owner', content: jsonErr },
      404: { description: 'Board not found', content: jsonErr }
    }
  })
  app.openapi(listRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can view shares', code: 'FORBIDDEN' }, 403)
    }
    const shares = await listShares(c.env.DB, ctx.ownerId, ctx.boardId)
    return c.json({ shares })
  }) as never)

  // Leave a shared board — grantee removes their OWN access, no owner involved.
  const leaveRoute = createRoute({
    method: 'delete',
    path: '/boards/{ref}/shares/me',
    tags: ['Sharing'],
    summary: 'Leave a shared board (grantee)',
    request: { params: refParam },
    responses: {
      200: { description: 'Left the board', content: { 'application/json': { schema: LeaveShareResponseSchema } } },
      400: { description: 'You own this board', content: simpleErr },
      404: { description: 'Board not found', content: jsonErr }
    }
  })
  app.openapi(leaveRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access === 'owner') {
      return badRequest(c, "You own this board; you can't leave it. Delete it instead.")
    }
    logRequest('DELETE', `/task/api/boards/${ref}/shares/me`, { board: ctx.boardId })
    await removeShare(c.env.DB, ctx.ownerId, ctx.boardId, ctx.callerId)
    return c.json({ ok: true, left: true })
  }) as never)

  // Revoke a grantee's access — owner only.
  const revokeRoute = createRoute({
    method: 'delete',
    path: '/boards/{ref}/shares/{granteeUserId}',
    tags: ['Sharing'],
    summary: 'Revoke a grantee\'s access (owner only)',
    request: {
      params: refParam.extend({
        granteeUserId: z.string().openapi({ param: { name: 'granteeUserId', in: 'path' } })
      })
    },
    responses: {
      200: { description: 'Revoked', content: { 'application/json': { schema: RevokeShareResponseSchema } } },
      403: { description: 'Not the owner', content: jsonErr },
      404: { description: 'Board not found', content: jsonErr }
    }
  })
  app.openapi(revokeRoute, (async (c: any) => {
    const { ref, granteeUserId } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can revoke shares', code: 'FORBIDDEN' }, 403)
    }
    // Guard: the owner's board must actually resolve to their own row.
    const own = await resolveOwnBoard(c.env.DB, ctx.ownerId, ref)
    if (!own) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    logRequest('DELETE', `/task/api/boards/${ref}/shares/${granteeUserId.slice(0, 8)}…`, {
      board: ctx.boardId
    })
    const removed = await removeShare(c.env.DB, ctx.ownerId, ctx.boardId, granteeUserId)
    return c.json({ ok: true, removed })
  }) as never)

  return app
}
