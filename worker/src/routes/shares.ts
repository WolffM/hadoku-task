/**
 * Board share management routes (§7).
 *
 * Owner-only: grant, list, revoke. Grantee-only: leave (remove own access).
 * Grantee identity is resolved by KEY via the read-only SESSIONS_KV registry
 * (never stored, never logged), or by a raw userId. A board is addressed by the
 * same ref (slug/handle) as everywhere else and resolved through getBoardContext.
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import { badRequest } from '@wolffm/worker-utils'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { listShares, upsertShare, removeShare, resolveOwnBoard } from './board-sharing'
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

export function createShareRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Grant (or update) a share — owner only.
  app.post('/boards/:ref/shares', async (c: any) => {
    const ref = c.req.param('ref')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can manage shares', code: 'FORBIDDEN' }, 403)
    }

    let body: { key?: string; userId?: string; level?: string }
    try {
      body = await c.req.json()
    } catch {
      return badRequest(c, 'Invalid JSON body')
    }
    const level = body.level
    if (level !== 'readonly' && level !== 'contributor') {
      return badRequest(c, "`level` must be 'readonly' or 'contributor'")
    }

    const grantee = await resolveGrantee(c.env, { key: body.key, userId: body.userId })
    if ('error' in grantee) return badRequest(c, grantee.error)
    if (grantee.userId === ctx.ownerId) {
      return badRequest(c, 'The owner already has full access.')
    }

    // Never log the key — only the (masked) resolved id + display name.
    logRequest('POST', `/task/api/boards/${ref}/shares`, {
      board: ctx.boardId,
      grantee: `${grantee.userId.slice(0, 8)}…`,
      level: level as Level
    })

    await upsertShare(c.env.DB, ctx.ownerId, ctx.boardId, grantee.userId, level, nowIso())
    return c.json({ ok: true, granteeUserId: grantee.userId, granteeName: grantee.name, level })
  })

  // List shares on a board — owner only.
  app.get('/boards/:ref/shares', async (c: any) => {
    const ref = c.req.param('ref')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can view shares', code: 'FORBIDDEN' }, 403)
    }
    const shares = await listShares(c.env.DB, ctx.ownerId, ctx.boardId)
    return c.json({ shares })
  })

  // Leave a shared board — grantee removes their OWN access, no owner involved.
  app.delete('/boards/:ref/shares/me', async (c: any) => {
    const ref = c.req.param('ref')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access === 'owner') {
      return badRequest(c, "You own this board; you can't leave it. Delete it instead.")
    }
    logRequest('DELETE', `/task/api/boards/${ref}/shares/me`, { board: ctx.boardId })
    await removeShare(c.env.DB, ctx.ownerId, ctx.boardId, ctx.callerId)
    return c.json({ ok: true, left: true })
  })

  // Revoke a grantee's access — owner only.
  app.delete('/boards/:ref/shares/:granteeUserId', async (c: any) => {
    const ref = c.req.param('ref')
    const granteeUserId = c.req.param('granteeUserId')
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
  })

  return app
}
