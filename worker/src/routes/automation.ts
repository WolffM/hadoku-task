/**
 * Automation-board activation routes (§5.4).
 *
 * `activate-automation` is a destructive migration, not a toggle: it replaces a
 * board's freeform tags with a fixed lane set and locks the structure. It is
 * OWNER-ONLY (a contributor drives work through a board; it can't reshape one)
 * and mandates a `dryRun` preview whose digest the committing call echoes back.
 *
 * Declared with createRoute so the routes validate and appear in the OpenAPI spec.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { activateAutomation, deactivateAutomation } from './board-automation'
import {
  ActivateInputSchema,
  ActivateResponseSchema,
  DeactivateResponseSchema,
  DomainErrorSchema
} from '../schemas-agent'
import type { AppContext } from '../types'

const jsonErr = { 'application/json': { schema: DomainErrorSchema } }
const refParam = z.object({ ref: z.string().openapi({ param: { name: 'ref', in: 'path' }, example: 'main' }) })

export function createAutomationRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Activate (or re-activate) automation — owner only, preview-then-commit.
  const activateRoute = createRoute({
    method: 'post',
    path: '/boards/{ref}/activate-automation',
    tags: ['Automation'],
    summary: 'Activate automation on a board (owner only)',
    description: 'dryRun returns a preview + digest and writes nothing; the committing call echoes the digest (stale ⇒ 409 DIGEST_MISMATCH).',
    request: { params: refParam, body: { content: { 'application/json': { schema: ActivateInputSchema } } } },
    responses: {
      200: { description: 'Preview (dryRun) or applied', content: { 'application/json': { schema: ActivateResponseSchema } } },
      403: { description: 'Not the owner', content: jsonErr },
      404: { description: 'Board not found', content: jsonErr },
      409: { description: 'Stale digest', content: jsonErr },
      422: { description: 'Invalid lane set', content: jsonErr }
    }
  })
  app.openapi(activateRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can activate automation', code: 'FORBIDDEN' }, 403)
    }
    const body = c.req.valid('json') as {
      schemaId?: string | null
      schemaVersion?: number | null
      lanes: unknown
      repo?: string | null
      dryRun?: boolean
      digest?: string
    }

    const dryRun = body.dryRun === true
    logRequest('POST', `/task/api/boards/${ref}/activate-automation`, { board: ctx.boardId, dryRun, commit: !dryRun })

    const result = await activateAutomation(
      c.env.DB,
      ctx.ownerId,
      ctx.boardId,
      { schemaId: body.schemaId ?? null, schemaVersion: body.schemaVersion ?? null, lanes: body.lanes, repo: body.repo ?? null },
      { dryRun, expectedDigest: dryRun ? undefined : body.digest }
    )
    return c.json(result)
  }) as never)

  // Deactivate automation — owner only. Restores the pre-activation tag list.
  const deactivateRoute = createRoute({
    method: 'post',
    path: '/boards/{ref}/deactivate-automation',
    tags: ['Automation'],
    summary: 'Deactivate automation on a board (owner only)',
    request: { params: refParam },
    responses: {
      200: { description: 'Restored to standard', content: { 'application/json': { schema: DeactivateResponseSchema } } },
      403: { description: 'Not the owner', content: jsonErr },
      404: { description: 'Board not found', content: jsonErr }
    }
  })
  app.openapi(deactivateRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can deactivate automation', code: 'FORBIDDEN' }, 403)
    }
    logRequest('POST', `/task/api/boards/${ref}/deactivate-automation`, { board: ctx.boardId })
    const result = await deactivateAutomation(c.env.DB, ctx.ownerId, ctx.boardId)
    return c.json(result)
  }) as never)

  return app
}
