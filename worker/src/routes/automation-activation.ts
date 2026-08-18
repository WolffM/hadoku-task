/**
 * Activation and deactivation — owner only, and destructive.
 *
 * Activation is a migration, not a toggle: it rewrites the board's tags into the
 * provider's lane vocabulary, which is why it runs preview-then-commit against a
 * digest. Deactivation restores the pre-activation tag list.
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { activateAutomation, deactivateAutomation } from './board-automation'
import { grantAutomationRunnerShare, grantRepoServiceKeyShare } from './shares'
import {
  ActivateInputSchema,
  ActivateResponseSchema,
  DeactivateResponseSchema
} from '../schemas-agent'
import {
  forbidden,
  boardNotFound,
  digestMismatch,
  laneSetInvalid,
  refParam
} from './automation-shared'
import type { AppContext } from '../types'

export function registerActivateRoute(app: OpenAPIHono<AppContext>) {
  // Activate (or re-activate) automation — owner only, preview-then-commit.
  const activateRoute = createRoute({
    method: 'post',
    path: '/boards/{ref}/activate-automation',
    tags: ['Automation'],
    summary: 'Activate automation on a board (owner only)',
    description:
      'dryRun returns a preview + digest and writes nothing; the committing call echoes the digest (stale ⇒ 409 DIGEST_MISMATCH).',
    request: {
      params: refParam,
      body: { content: { 'application/json': { schema: ActivateInputSchema } } }
    },
    responses: {
      200: {
        description: 'Preview (dryRun) or applied',
        content: { 'application/json': { schema: ActivateResponseSchema } }
      },
      403: {
        description:
          'Read-only access, or a contributor attempting an owner-only activation — the first conversion of a standard board, or a lane set that would strand tasks (FORBIDDEN)',
        content: forbidden
      },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound },
      409: { description: 'Stale digest (DIGEST_MISMATCH)', content: digestMismatch },
      422: { description: 'Invalid lane set (LANE_SET_INVALID)', content: laneSetInvalid }
    }
  })
  app.openapi(activateRoute, async c => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' as const }, 404)
    // Readonly never writes. Owner vs contributor is decided INSIDE
    // activateAutomation, which is where the preview exists: a contributor may
    // upgrade an already-automated board when the new lane set strands nothing.
    if (ctx.access === 'readonly') {
      return c.json({ error: 'Read-only access to this board', code: 'FORBIDDEN' as const }, 403)
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
    logRequest('POST', `/task/api/boards/${ref}/activate-automation`, {
      board: ctx.boardId,
      dryRun,
      commit: !dryRun
    })

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
      { dryRun, expectedDigest: dryRun ? undefined : body.digest, access: ctx.access }
    )

    // A board that just became an automation board is useless to the runner until
    // it holds a share, so grant it here instead of making every owner remember.
    // Owner-only on purpose: a contributor upgrading a board must not be able to
    // hand a third identity access to someone else's board — that's the owner's
    // call. Dry runs write nothing, so they don't resolve the registry either.
    if (!dryRun && ctx.access === 'owner') {
      const share = await grantAutomationRunnerShare(c.env, ctx.ownerId, ctx.boardId)
      // An activation that also CONNECTS a repo is a repo connection like any
      // other, so it earns the same grant as POST /repo. Only when the body
      // carried one — a re-activation that omits `repo` keeps the board's existing
      // mapping (COALESCE) and isn't connecting anything new.
      const repoShare = body.repo
        ? await grantRepoServiceKeyShare(c.env, ctx.ownerId, ctx.boardId, body.repo)
        : null
      logRequest('POST', `/task/api/boards/${ref}/activate-automation`, {
        board: ctx.boardId,
        runnerShare: share.granted ? `granted:${share.name}` : `skipped:${share.reason}`,
        ...(repoShare && {
          repoShare: repoShare.granted ? `granted:${repoShare.name}` : `skipped:${repoShare.reason}`
        })
      })
      return c.json(
        {
          ...result,
          automationRunnerShare: share,
          ...(repoShare && { repoServiceKeyShare: repoShare })
        },
        200
      )
    }
    return c.json(result, 200)
  })
}

export function registerDeactivateRoute(app: OpenAPIHono<AppContext>) {
  // Deactivate automation — owner only. Restores the pre-activation tag list.
  const deactivateRoute = createRoute({
    method: 'post',
    path: '/boards/{ref}/deactivate-automation',
    tags: ['Automation'],
    summary: 'Deactivate automation on a board (owner only)',
    request: { params: refParam },
    responses: {
      200: {
        description: 'Restored to standard',
        content: { 'application/json': { schema: DeactivateResponseSchema } }
      },
      403: { description: 'Not the owner (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(deactivateRoute, async c => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' as const }, 404)
    if (ctx.access !== 'owner') {
      return c.json(
        { error: 'Only the board owner can deactivate automation', code: 'FORBIDDEN' as const },
        403
      )
    }
    logRequest('POST', `/task/api/boards/${ref}/deactivate-automation`, { board: ctx.boardId })
    const result = await deactivateAutomation(c.env.DB, ctx.ownerId, ctx.boardId)
    return c.json(result, 200)
  })
}
