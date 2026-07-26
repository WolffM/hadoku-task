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
import { listPresets } from './board-presets'
import { tierAtLeast } from '@wolffm/worker-utils'
import {
  ActivateInputSchema,
  ActivateResponseSchema,
  DeactivateResponseSchema,
  RepoValidateResponseSchema,
  ListPresetsResponseSchema,
  SetRepoInputSchema,
  SetRepoResponseSchema,
  ForbiddenErrorSchema,
  BoardNotFoundErrorSchema,
  DigestMismatchErrorSchema,
  LaneSetInvalidErrorSchema
} from '../schemas-agent'
import type { AppContext } from '../types'

/** Probe GitHub to validate a board's `repo` (owner/name). 404 is ambiguous —
 * GitHub returns it for both "no such repo" and "private repo the token can't
 * see" (it won't leak private-repo existence), so the caller phrases it as both. */
async function validateRepo(
  repo: string,
  token: string | undefined
): Promise<{
  repo: string
  valid: boolean
  reason: string
  private?: boolean
  defaultBranch?: string
  message?: string
}> {
  const trimmed = repo.trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return {
      repo: trimmed,
      valid: false,
      reason: 'bad_format',
      message: 'Use the "owner/repo" form.'
    }
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hadoku-task'
  }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(`https://api.github.com/repos/${trimmed}`, { headers })
    if (res.status === 200) {
      const data = (await res.json()) as {
        private?: boolean
        default_branch?: string
        full_name?: string
      }
      return {
        repo: data.full_name ?? trimmed,
        valid: true,
        reason: 'ok',
        private: data.private,
        defaultBranch: data.default_branch
      }
    }
    if (res.status === 404) {
      return {
        repo: trimmed,
        valid: false,
        reason: 'not_found_or_no_access',
        message: token
          ? 'No such repo, or it is private and our GitHub token lacks access — grant the WolffM token access to it, then re-check.'
          : 'No such public repo (private-repo validation needs the GitHub token binding).'
      }
    }
    if (res.status === 401 || res.status === 403) {
      return {
        repo: trimmed,
        valid: false,
        reason: 'token',
        message: 'GitHub rejected our token (scope/rate limit).'
      }
    }
    return {
      repo: trimmed,
      valid: false,
      reason: 'error',
      message: `GitHub returned ${res.status}.`
    }
  } catch {
    return { repo: trimmed, valid: false, reason: 'error', message: 'Could not reach GitHub.' }
  }
}

// Narrowed to the codes each (route, status) can actually emit — see agent.ts.
const forbidden = { 'application/json': { schema: ForbiddenErrorSchema } }
const boardNotFound = { 'application/json': { schema: BoardNotFoundErrorSchema } }
const digestMismatch = { 'application/json': { schema: DigestMismatchErrorSchema } }
const laneSetInvalid = { 'application/json': { schema: LaneSetInvalidErrorSchema } }
const refParam = z.object({
  ref: z.string().openapi({ param: { name: 'ref', in: 'path' }, example: 'main' })
})

export function createAutomationRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // The lane contracts our configured providers publish, fetched live so a board
  // is activated from the provider's current schema rather than a JSON blob some
  // human pasted months ago. Signed-in only (a public visitor can't activate
  // anything, so there's nothing for them to pick).
  const presetsRoute = createRoute({
    method: 'get',
    path: '/automation/presets',
    tags: ['Automation'],
    summary: 'Lane contracts published by configured providers',
    description:
      'Fetched server-side from each provider in AUTOMATION_PRESET_SOURCES and validated with the same lane-set validator activation uses. Revalidated with If-None-Match, so an unchanged contract costs a 304. `sources` reports each provider individually — an empty `presets` with a failing source means "provider down", not "none exist".',
    responses: {
      200: {
        description: 'Presets + per-source status',
        content: { 'application/json': { schema: ListPresetsResponseSchema } }
      }
    }
  })
  app.openapi(presetsRoute, (async (c: any) => {
    const auth = c.get('authContext')
    if (!tierAtLeast(auth, 'friend')) return c.json({ presets: [], sources: [] })
    const result = await listPresets(c.env.AUTOMATION_PRESET_SOURCES)
    return c.json(result)
  }) as never)

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
  app.openapi(setRepoRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can set the repo', code: 'FORBIDDEN' }, 403)
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
      return c.json({ error: `Board ${ref} not found`, code: 'BOARD_NOT_FOUND' }, 404)
    }
    logRequest('POST', `/task/api/boards/${ref}/repo`, { board: ctx.boardId, repo })
    return c.json({ ok: true, repo })
  }) as never)

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
  app.openapi(repoValidateRoute, (async (c: any) => {
    const auth = c.get('authContext')
    if (!tierAtLeast(auth, 'friend')) {
      return c.json({
        repo: '',
        valid: false,
        reason: 'token',
        message: 'Sign in to validate repos.'
      })
    }
    const { repo } = c.req.valid('query')
    const result = await validateRepo(repo, c.env.GITHUB_READ_TOKEN)
    return c.json(result)
  }) as never)

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
  app.openapi(activateRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    // Readonly never writes. Owner vs contributor is decided INSIDE
    // activateAutomation, which is where the preview exists: a contributor may
    // upgrade an already-automated board when the new lane set strands nothing.
    if (ctx.access === 'readonly') {
      return c.json({ error: 'Read-only access to this board', code: 'FORBIDDEN' }, 403)
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
      200: {
        description: 'Restored to standard',
        content: { 'application/json': { schema: DeactivateResponseSchema } }
      },
      403: { description: 'Not the owner (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(deactivateRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
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
  }) as never)

  return app
}
