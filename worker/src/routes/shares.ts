/**
 * Board share management routes (§7).
 *
 * Owner-only: grant, list, revoke. Grantee-only: leave (remove own access).
 * A grantee is named by display NAME (preferred — no credential changes hands)
 * or by raw key, and either way the registry resolves it; a raw userId is not
 * accepted, because an owner taken on faith from a request body is the defect
 * this whole model exists to prevent. A board is addressed by the same ref
 * (slug/handle) as everywhere else and resolved through route-utils.
 *
 * Routes are declared with createRoute so they both validate and appear in the
 * generated OpenAPI spec (schemas-agent.ts).
 *
 * The pieces these routes share with the automation auto-grants live beside
 * this file: share-registry (who a grantee is), share-naming (the display-name
 * convention) and share-grants (granting without a human).
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { tierAtLeast } from '@wolffm/worker-utils'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { listShares, upsertShare, removeShare, resolveOwnBoard } from './board-sharing'
import {
  GrantShareInputSchema,
  GrantShareResponseSchema,
  ListSharesResponseSchema,
  LeaveShareResponseSchema,
  RevokeShareResponseSchema,
  UserSearchResponseSchema,
  ForbiddenErrorSchema,
  BoardNotFoundErrorSchema,
  ShareGranteeNotFoundErrorSchema,
  NoUserIdErrorSchema
} from '../schemas-agent'
import { ErrorResponseSchema } from '../schemas'
import {
  isIdentityError,
  nowIso,
  registryNameMap,
  resolveGrantee,
  searchRegistryNames,
  type Level
} from './share-registry'
import type { AppContext } from '../types'

// Narrowed to the codes each (route, status) can actually emit — see agent.ts.
const forbidden = { 'application/json': { schema: ForbiddenErrorSchema } }
const boardNotFound = { 'application/json': { schema: BoardNotFoundErrorSchema } }
const granteeNotFound = { 'application/json': { schema: ShareGranteeNotFoundErrorSchema } }
const noUserIdErr = { 'application/json': { schema: NoUserIdErrorSchema } }
const simpleErr = { 'application/json': { schema: ErrorResponseSchema } }
const refParam = z.object({
  ref: z.string().openapi({ param: { name: 'ref', in: 'path' }, example: 'main' })
})

export function createShareRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Autocomplete: search live display names for the share UI. Auth-gated to a
  // signed-in (non-public) caller — a board owner picking a grantee. Display
  // names carry no auth bearing, so returning them is safe.
  const searchRoute = createRoute({
    method: 'get',
    path: '/users/search',
    tags: ['Sharing'],
    summary: 'Search display names (share autocomplete)',
    request: {
      query: z.object({
        q: z.string().openapi({ example: 'ten', description: 'Name prefix/substring.' }),
        limit: z.string().optional()
      })
    },
    responses: {
      200: {
        description: 'Matching users',
        content: { 'application/json': { schema: UserSearchResponseSchema } }
      }
    }
  })
  app.openapi(searchRoute, async c => {
    const auth = c.get('authContext')
    // Only signed-in users may enumerate names (avoids anonymous scraping).
    if (!tierAtLeast(auth, 'friend')) {
      return c.json({ users: [] }, 200)
    }
    const { q, limit } = c.req.valid('query')
    const n = Math.min(Math.max(1, parseInt(limit ?? '8', 10) || 8), 20)
    const users = await searchRegistryNames(c.env, q, n)
    return c.json({ users }, 200)
  })

  // Grant (or update) a share — owner only.
  const grantRoute = createRoute({
    method: 'post',
    path: '/boards/{ref}/shares',
    tags: ['Sharing'],
    summary: 'Grant a board share (owner only)',
    request: {
      params: refParam,
      body: { content: { 'application/json': { schema: GrantShareInputSchema } } }
    },
    responses: {
      200: {
        description: 'Share granted',
        content: { 'application/json': { schema: GrantShareResponseSchema } }
      },
      400: { description: 'Invalid grantee', content: simpleErr },
      403: { description: 'Not the owner (FORBIDDEN)', content: forbidden },
      404: {
        description: 'Board not found, or no key with that name (BOARD_NOT_FOUND | NAME_NOT_FOUND)',
        content: granteeNotFound
      },
      409: { description: 'Named key never signed in (NO_USER_ID)', content: noUserIdErr }
    }
  })
  app.openapi(grantRoute, async c => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' as const }, 404)
    if (ctx.access !== 'owner') {
      return c.json(
        { error: 'Only the board owner can manage shares', code: 'FORBIDDEN' as const },
        403
      )
    }
    const body = c.req.valid('json') as {
      name?: string
      key?: string
      level: Level
    }

    // Two ways in, and neither is "trust what you were sent". There is no
    // userId branch: an already-resolved owner cannot be re-resolved, so
    // accepting one from a body is always a claim taken on faith (R5).
    const grantee = await resolveGrantee(c.env, { name: body.name, key: body.key })
    if (isIdentityError(grantee)) {
      // Discriminated rather than posted as one untyped bag with a dynamic
      // status: each declared response has its own schema (404 carries a
      // NAME_NOT_FOUND code, 409 a NO_USER_ID one, 400 neither), and only a
      // literal status lets the compiler check the body against the right one.
      // The wire is unchanged — resolveGrantee sets `code` on exactly these two.
      if (grantee.status === 404) {
        return c.json({ error: grantee.error, code: 'NAME_NOT_FOUND' as const }, 404)
      }
      if (grantee.status === 409) {
        return c.json({ error: grantee.error, code: 'NO_USER_ID' as const }, 409)
      }
      return c.json({ error: grantee.error }, 400)
    }
    if (grantee.userId === ctx.ownerId) {
      return c.json(
        { error: 'The owner already has full access.', timestamp: new Date().toISOString() },
        400
      )
    }

    // Never log the key — only the (masked) resolved id + display name.
    logRequest('POST', `/task/api/boards/${ref}/shares`, {
      board: ctx.boardId,
      grantee: `${grantee.userId.slice(0, 8)}…`,
      level: body.level
    })

    await upsertShare(c.env.DB, ctx.ownerId, ctx.boardId, grantee.userId, body.level, nowIso())
    // Echo what was granted so the owner can confirm it's the right identity/tier.
    return c.json(
      {
        ok: true,
        granteeUserId: grantee.userId,
        granteeName: grantee.name ?? null,
        level: body.level,
        granted: { name: grantee.name ?? null, tier: grantee.tier ?? null, level: body.level }
      },
      200
    )
  })

  // List shares on a board — owner only.
  const listRoute = createRoute({
    method: 'get',
    path: '/boards/{ref}/shares',
    tags: ['Sharing'],
    summary: "List a board's shares (owner only)",
    request: { params: refParam },
    responses: {
      200: {
        description: 'The shares',
        content: { 'application/json': { schema: ListSharesResponseSchema } }
      },
      403: { description: 'Not the owner (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(listRoute, async c => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' as const }, 404)
    if (ctx.access !== 'owner') {
      return c.json(
        { error: 'Only the board owner can view shares', code: 'FORBIDDEN' as const },
        403
      )
    }
    const shares = await listShares(c.env.DB, ctx.ownerId, ctx.boardId)
    // Annotate each grantee with their display name + tier (one registry scan)
    // so the share UI shows people, not raw userIds.
    const names = shares.length ? await registryNameMap(c.env) : new Map()
    const annotated = shares.map(s => {
      const who = names.get(s.granteeUserId)
      return { ...s, name: who?.name ?? null, tier: who?.tier ?? null }
    })
    return c.json({ shares: annotated }, 200)
  })

  // Leave a shared board — grantee removes their OWN access, no owner involved.
  const leaveRoute = createRoute({
    method: 'delete',
    path: '/boards/{ref}/shares/me',
    tags: ['Sharing'],
    summary: 'Leave a shared board (grantee)',
    request: { params: refParam },
    responses: {
      200: {
        description: 'Left the board',
        content: { 'application/json': { schema: LeaveShareResponseSchema } }
      },
      400: { description: 'You own this board', content: simpleErr },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(leaveRoute, async c => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' as const }, 404)
    if (ctx.access === 'owner') {
      return c.json(
        {
          error: "You own this board; you can't leave it. Delete it instead.",
          timestamp: new Date().toISOString()
        },
        400
      )
    }
    logRequest('DELETE', `/task/api/boards/${ref}/shares/me`, { board: ctx.boardId })
    await removeShare(c.env.DB, ctx.ownerId, ctx.boardId, ctx.callerId)
    return c.json({ ok: true, left: true }, 200)
  })

  // Revoke a grantee's access — owner only.
  const revokeRoute = createRoute({
    method: 'delete',
    path: '/boards/{ref}/shares/{granteeUserId}',
    tags: ['Sharing'],
    summary: "Revoke a grantee's access (owner only)",
    request: {
      params: refParam.extend({
        granteeUserId: z.string().openapi({ param: { name: 'granteeUserId', in: 'path' } })
      })
    },
    responses: {
      200: {
        description: 'Revoked',
        content: { 'application/json': { schema: RevokeShareResponseSchema } }
      },
      403: { description: 'Not the owner (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(revokeRoute, async c => {
    const { ref, granteeUserId } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' as const }, 404)
    if (ctx.access !== 'owner') {
      return c.json(
        { error: 'Only the board owner can revoke shares', code: 'FORBIDDEN' as const },
        403
      )
    }
    // Guard: the owner's board must actually resolve to their own row.
    const own = await resolveOwnBoard(c.env.DB, ctx.ownerId, ref)
    if (!own) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' as const }, 404)
    logRequest('DELETE', `/task/api/boards/${ref}/shares/${granteeUserId.slice(0, 8)}…`, {
      board: ctx.boardId
    })
    const removed = await removeShare(c.env.DB, ctx.ownerId, ctx.boardId, granteeUserId)
    return c.json({ ok: true, removed }, 200)
  })

  return app
}
