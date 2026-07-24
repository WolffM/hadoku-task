/**
 * Automation-board activation routes (§5.4).
 *
 * `activate-automation` is a destructive migration, not a toggle: it replaces a
 * board's freeform tags with a fixed lane set and locks the structure. It is
 * OWNER-ONLY (a contributor drives work through a board; it can't reshape one)
 * and mandates a `dryRun` preview whose digest the committing call echoes back.
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import { badRequest } from '@wolffm/worker-utils'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { activateAutomation, deactivateAutomation } from './board-automation'
import type { AppContext } from '../types'

export function createAutomationRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Activate (or re-activate) automation — owner only, preview-then-commit.
  app.post('/boards/:ref/activate-automation', async (c: any) => {
    const ref = c.req.param('ref')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json(
        { error: 'Only the board owner can activate automation', code: 'FORBIDDEN' },
        403
      )
    }

    let body: {
      schemaId?: string | null
      schemaVersion?: number | null
      lanes?: unknown
      repo?: string | null
      dryRun?: boolean
      digest?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return badRequest(c, 'Invalid JSON body')
    }
    if (body.lanes === undefined) return badRequest(c, '`lanes` is required')

    const dryRun = body.dryRun === true
    logRequest('POST', `/task/api/boards/${ref}/activate-automation`, {
      board: ctx.boardId,
      dryRun,
      commit: !dryRun
    })

    // Errors (LaneSetInvalid 422, DigestMismatch 409, BoardNotFound 404) are
    // thrown and mapped to their status by the app-level onError handler.
    const result = await activateAutomation(
      c.env.DB,
      ctx.ownerId,
      ctx.boardId,
      {
        schemaId: body.schemaId ?? null,
        schemaVersion: body.schemaVersion ?? null,
        lanes: body.lanes,
        repo: body.repo ?? null
      },
      { dryRun, expectedDigest: dryRun ? undefined : body.digest }
    )
    return c.json(result)
  })

  // Deactivate automation — owner only. Restores the pre-activation tag list.
  app.post('/boards/:ref/deactivate-automation', async (c: any) => {
    const ref = c.req.param('ref')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json(
        { error: 'Only the board owner can deactivate automation', code: 'FORBIDDEN' },
        403
      )
    }

    logRequest('POST', `/task/api/boards/${ref}/deactivate-automation`, { board: ctx.boardId })
    const result = await deactivateAutomation(c.env.DB, ctx.ownerId, ctx.boardId)
    return c.json(result)
  })

  return app
}
