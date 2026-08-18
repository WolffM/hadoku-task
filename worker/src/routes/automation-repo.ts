/**
 * Linking a board to a GitHub repo, and checking the link before it is saved.
 *
 * `validateRepo` lives here with the two routes that use it. Its 404 handling is
 * the subtle part — GitHub answers 404 for both "no such repo" and "private repo
 * this token cannot see", because it will not leak private-repo existence, so
 * the message has to phrase it as both. worker/test/repo-validate-verify.ts
 * pins every branch.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { githubToken } from './board-automation'
import { validateRepo } from './github-repo'
import { grantRepoServiceKeyShare } from './shares'
import { tierAtLeast } from '@wolffm/worker-utils'
import {
  RepoValidateResponseSchema,
  SetRepoInputSchema,
  SetRepoResponseSchema
} from '../schemas-agent'
import { forbidden, boardNotFound, refParam } from './automation-shared'
import type { AppContext } from '../types'

export function registerSetRepoRoute(app: OpenAPIHono<AppContext>) {
  // Set a board's repo (owner only). Auto-saved by the UI the moment a repo
  // validates, so there's no separate "save" button.
  const setRepoRoute = createRoute({
    method: 'post',
    path: '/boards/{ref}/repo',
    tags: ['Automation'],
    summary: "Set or clear a board's repo (owner only)",
    description:
      'The board → checkout mapping (§5.5): a runner reads `repo` off the hydrated board rather than parsing a display name. Stored verbatim; probe it with GET /repos/validate first if you want it checked against GitHub.',
    request: {
      params: refParam,
      body: { content: { 'application/json': { schema: SetRepoInputSchema } } }
    },
    responses: {
      200: {
        description: 'Repo saved (or cleared)',
        content: { 'application/json': { schema: SetRepoResponseSchema } }
      },
      403: { description: 'Not the owner (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(setRepoRoute, async c => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' as const }, 404)
    if (ctx.access !== 'owner') {
      return c.json(
        { error: 'Only the board owner can set the repo', code: 'FORBIDDEN' as const },
        403
      )
    }
    const body = c.req.valid('json') as { repo?: string | null }
    // Blank is a clear, not a value — the UI clears by emptying the field.
    const repo = typeof body.repo === 'string' && body.repo.trim() ? body.repo.trim() : null
    const res = await c.env.DB.prepare(
      'UPDATE boards SET repo = ?, updated_at = ? WHERE user_id = ? AND id = ?'
    )
      .bind(repo, new Date().toISOString(), ctx.ownerId, ctx.boardId)
      .run()
    // An unknown slug resolves to "your own not-yet-created board" (branch 4 of
    // resolveBoardAccess), so ctx alone can't tell a real board from a typo. Report
    // what the write actually did: 0 rows means there was no board to map, and
    // answering {ok:true} there hands a runner a checkout mapping that isn't stored.
    if (res.meta.changes === 0) {
      return c.json({ error: `Board ${ref} not found`, code: 'BOARD_NOT_FOUND' as const }, 404)
    }
    // Connecting a repo is all it should take for that repo's own agent to reach
    // the board, so grant its service key here rather than making every owner
    // remember a second, hand-typed step. Clearing the repo grants nothing — and
    // deliberately does NOT revoke: taking access away is the owner's call, made
    // explicitly through the share panel, not a side effect of blanking a field.
    const serviceKeyShare = repo
      ? await grantRepoServiceKeyShare(c.env, ctx.ownerId, ctx.boardId, repo)
      : null
    logRequest('POST', `/task/api/boards/${ref}/repo`, {
      board: ctx.boardId,
      repo,
      ...(serviceKeyShare && {
        serviceKeyShare: serviceKeyShare.granted
          ? `granted:${serviceKeyShare.name}`
          : `skipped:${serviceKeyShare.reason}`
      })
    })
    return c.json({ ok: true, repo, ...(serviceKeyShare && { serviceKeyShare }) }, 200)
  })
}

export function registerRepoValidateRoute(app: OpenAPIHono<AppContext>) {
  // Validate a board's repo by probing GitHub. Signed-in only.
  const repoValidateRoute = createRoute({
    method: 'get',
    path: '/repos/validate',
    tags: ['Automation'],
    summary: 'Validate a repo against GitHub',
    request: { query: z.object({ repo: z.string().openapi({ example: 'WolffM/hadoku-task' }) }) },
    responses: {
      200: {
        description: 'Validation result',
        content: { 'application/json': { schema: RepoValidateResponseSchema } }
      }
    }
  })
  app.openapi(repoValidateRoute, async c => {
    const auth = c.get('authContext')
    if (!tierAtLeast(auth, 'friend')) {
      return c.json(
        {
          repo: '',
          valid: false,
          reason: 'token',
          message: 'Sign in to validate repos.'
        },
        200
      )
    }
    const { repo } = c.req.valid('query')
    const result = await validateRepo(repo, githubToken(c.env))
    return c.json(result, 200)
  })
}
