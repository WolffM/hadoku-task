/**
 * Automation-board activation routes (§5.4).
 *
 * `activate-automation` is a destructive migration, not a toggle: it replaces a
 * board's freeform tags with a fixed lane set and locks the structure. The first
 * conversion of a standard board is OWNER-ONLY; a contributor may only upgrade a
 * board that is already automated, and only with a lane set that strands nothing
 * (the split lives in `activateAutomation`, where the preview exists). Either way
 * it mandates a `dryRun` preview whose digest the committing call echoes back.
 *
 * An owner's committing activation also auto-grants the automation runner
 * `contributor` on the board — see `grantAutomationRunnerShare`.
 *
 * Declared with createRoute so the routes validate and appear in the OpenAPI spec.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { activateAutomation, deactivateAutomation, githubToken } from './board-automation'
import {
  grantAutomationRunnerShare,
  grantRepoServiceKeyShare,
  repoServiceKeyName,
  automationRunnerName,
  liveRowsByName,
  grantContributor
} from './shares'
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
  ReconcileSharesInputSchema,
  ReconcileSharesResponseSchema,
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
    return c.json({ ok: true, repo, ...(serviceKeyShare && { serviceKeyShare }) })
  }) as never)

  // One-time (and re-runnable) reconcile of every link on the caller's OWN boards.
  //
  // The auto-grants only fire on the write that creates the link, so every board
  // connected BEFORE they shipped is still missing its shares. This is the backfill,
  // and it stays useful afterwards as a drift check.
  //
  // Both names are verified before anything is granted, which is the whole point of
  // doing this deliberately rather than blind-inserting from the boards table:
  //   - the REPO is probed against GitHub, so a typo'd mapping can't mint a share;
  //   - the KEY NAME must resolve to a live, signed-in registry row.
  // Anything that fails either check is reported as `skipped` with a reason.
  const reconcileRoute = createRoute({
    method: 'post',
    path: '/boards/reconcile-shares',
    tags: ['Sharing'],
    summary: 'Backfill repo + automation shares (yours, or every owner at service tier)',
    description:
      'For every linked board: a `repo` grants that repo\'s service key (`<repo minus a leading "hadoku-"/"hadoku_">-service-key`), and an automation board grants the automation runner. Both the repo (probed against GitHub) and the derived key name (resolved in the registry) must check out first. Defaults to your own boards; `allOwners: true` sweeps everyone\'s and needs a service-tier key. `dryRun` defaults to TRUE — pass `false` to write.',
    request: {
      body: { content: { 'application/json': { schema: ReconcileSharesInputSchema } } }
    },
    responses: {
      200: {
        description: 'What was reconciled (or would be)',
        content: { 'application/json': { schema: ReconcileSharesResponseSchema } }
      },
      403: {
        description: 'allOwners without a service-tier key (FORBIDDEN)',
        content: forbidden
      }
    }
  })
  app.openapi(reconcileRoute, (async (c: any) => {
    const auth = c.get('authContext')
    const body = (c.req.valid('json') ?? {}) as {
      dryRun?: boolean
      force?: boolean
      allOwners?: boolean
    }
    // Both default to TRUE: a bulk grant must be asked for explicitly (dryRun), and
    // an operator running a reconcile is asking for these links to exist (force).
    const dryRun = body.dryRun !== false
    const force = body.force !== false

    // A cross-owner sweep needs SERVICE tier. It isn't privileged information —
    // the grantee is fully determined by the board's own repo (or the fixed
    // runner), so a caller cannot choose who gets access and this can only ever
    // create the shares the system would have made automatically. What it must not
    // do is let one owner's agent overwrite ANOTHER owner's deliberate level, so
    // `force` is dropped on boards the caller doesn't own (see below).
    const allOwners = body.allOwners === true
    if (allOwners && !tierAtLeast(auth, 'service')) {
      return c.json(
        {
          error: "Reconciling every owner's boards needs a service-tier key.",
          code: 'FORBIDDEN'
        },
        403
      )
    }

    // Only boards that actually carry a link are candidates, filtered in SQL so a
    // full sweep doesn't drag every board in the system through the worker.
    const linked = `(repo IS NOT NULL AND TRIM(repo) != '') OR mode = 'automation'`
    const { results: boards } = allOwners
      ? await c.env.DB.prepare(
          `SELECT user_id, id, repo, mode FROM boards WHERE ${linked} ORDER BY user_id, id`
        ).all()
      : await c.env.DB.prepare(
          `SELECT user_id, id, repo, mode FROM boards WHERE user_id = ? AND (${linked}) ORDER BY id`
        )
          .bind(auth.sessionId)
          .all()

    // Resolve the registry ONCE for the whole run — per-name lookups each cost a
    // full `key:` scan, which over N boards is the difference between one pass and
    // 2N of them.
    const registry = await liveRowsByName(c.env)

    // Probe each DISTINCT repo once; several boards often share one checkout.
    const repos = [
      ...new Set(
        (boards as Array<{ repo: string | null }>).map(b => b.repo?.trim()).filter(Boolean)
      )
    ] as string[]
    const validated = new Map<string, { valid: boolean; reason: string; message?: string }>()
    await Promise.all(
      repos.map(async repo => {
        validated.set(repo, await validateRepo(repo, githubToken(c.env)))
      })
    )

    const report: Array<Record<string, unknown>> = []
    const tally = { granted: 0, escalated: 0, alreadyShared: 0, skipped: 0 }

    for (const b of boards as Array<{
      user_id: string
      id: string
      repo: string | null
      mode: string
    }>) {
      const grants: Array<Record<string, unknown>> = []
      // In a cross-owner sweep the owner is the ROW's, not the caller's.
      const ownerId = b.user_id
      const isOwn = ownerId === auth.sessionId
      // Never let one caller overwrite ANOTHER owner's deliberate level. Creating a
      // missing share is deterministic and safe; changing one someone set by hand
      // is that owner's call, so force applies only to your own boards.
      const effectiveForce = force && isOwn

      const boardRepo = b.repo?.trim() || null
      const targets: Array<{ kind: 'repo' | 'automation-runner'; name: string | null }> = []
      if (boardRepo) targets.push({ kind: 'repo', name: repoServiceKeyName(boardRepo) })
      if (b.mode === 'automation') {
        targets.push({ kind: 'automation-runner', name: automationRunnerName(c.env) })
      }

      for (const t of targets) {
        // Check the repo BEFORE the key: a bad mapping is the more actionable
        // finding, and it's the one that must never result in a grant.
        if (t.kind === 'repo') {
          const v = boardRepo ? validated.get(boardRepo) : undefined
          if (!v?.valid) {
            grants.push({
              kind: t.kind,
              name: t.name ?? '(underivable)',
              outcome: 'skipped',
              reason: `repo did not validate (${v?.reason ?? 'unknown'})${v?.message ? `: ${v.message}` : ''}`
            })
            tally.skipped++
            continue
          }
        }
        if (!t.name) {
          grants.push({
            kind: t.kind,
            name: '(underivable)',
            outcome: 'skipped',
            reason: 'no key name could be derived from that repo'
          })
          tally.skipped++
          continue
        }
        const row = registry.get(t.name.toLowerCase())
        if (!row) {
          grants.push({
            kind: t.kind,
            name: t.name,
            outcome: 'skipped',
            reason: 'no live registry row with that display name'
          })
          tally.skipped++
          continue
        }
        if (row.userId === ownerId) {
          grants.push({
            kind: t.kind,
            name: t.name,
            outcome: 'skipped',
            reason: 'that key already owns this board'
          })
          tally.skipped++
          continue
        }
        if (dryRun) {
          grants.push({
            kind: t.kind,
            name: t.name,
            outcome: 'granted',
            granteeUserId: row.userId
          })
          tally.granted++
          continue
        }
        const res = await grantContributor(c.env, ownerId, b.id, row.userId, effectiveForce)
        grants.push({
          kind: t.kind,
          name: t.name,
          outcome: res.outcome,
          granteeUserId: row.userId,
          ...(res.previousLevel && { previousLevel: res.previousLevel }),
          // Say so rather than letting it read as a plain no-op: force was asked
          // for and deliberately not applied, because this board is someone else's.
          ...(force &&
            !isOwn &&
            res.outcome === 'already_shared' &&
            res.previousLevel !== 'contributor' && {
              reason: "left alone: force does not apply to another owner's board"
            })
        })
        if (res.outcome === 'granted') tally.granted++
        else if (res.outcome === 'escalated') tally.escalated++
        else tally.alreadyShared++
      }

      if (grants.length) {
        report.push({
          boardId: b.id,
          repo: b.repo ?? null,
          mode: b.mode,
          ...(allOwners && { ownerId }),
          grants
        })
      }
    }

    logRequest('POST', '/task/api/boards/reconcile-shares', {
      dryRun,
      allOwners,
      boards: boards.length,
      granted: tally.granted,
      escalated: tally.escalated,
      skipped: tally.skipped
    })
    return c.json({
      dryRun,
      allOwners,
      summary: {
        boardsScanned: boards.length,
        boardsWithWork: report.length,
        granted: tally.granted,
        escalated: tally.escalated,
        alreadyShared: tally.alreadyShared,
        skipped: tally.skipped
      },
      boards: report
    })
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
    const result = await validateRepo(repo, githubToken(c.env))
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
      return c.json({
        ...result,
        automationRunnerShare: share,
        ...(repoShare && { repoServiceKeyShare: repoShare })
      })
    }
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
