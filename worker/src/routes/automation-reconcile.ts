/**
 * `POST /boards/reconcile-shares` — backfill the automation-runner and
 * repo-service-key grants onto boards linked before those auto-grants existed.
 *
 * Deliberately not a blind insert from the board table: the repo is probed
 * against GitHub so a typo cannot mint a share, and the key name must resolve to
 * a live signed-in registry row. Anything failing either check is reported as
 * `skipped` with a reason rather than silently dropped.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { logRequest } from '../logger'
import { githubToken } from './board-automation'
import { validateRepo } from './github-repo'
import { grantContributor } from './share-grants'
import { liveRowsByName } from './share-registry'
import { automationRunnerName, repoServiceKeyName } from './share-naming'
import { tierAtLeast } from '@wolffm/worker-utils'
import {
  ReconcileSharesInputSchema,
  ReconcileBoardSchema,
  ReconcileSharesResponseSchema
} from '../schemas-agent'
import { forbidden } from './automation-shared'
import type { AppContext } from '../types'

export function registerReconcileRoute(app: OpenAPIHono<AppContext>) {
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
  app.openapi(reconcileRoute, async c => {
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
          code: 'FORBIDDEN' as const
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

    // Typed from the schema the route publishes, not `Record<string, unknown>`:
    // the report is the response body, so an untyped bag meant the compiler
    // could not tell whether what reconcile builds still matches what the spec
    // promises — including the `grants[].kind` and `outcome` enums.
    const report: Array<z.infer<typeof ReconcileBoardSchema>> = []
    const tally = { granted: 0, escalated: 0, alreadyShared: 0, skipped: 0 }

    for (const b of boards as Array<{
      user_id: string
      id: string
      repo: string | null
      mode: string
    }>) {
      const grants: z.infer<typeof ReconcileBoardSchema>['grants'] = []
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
        // A dry run goes through the SAME resolution, so the plan it prints is what
        // the commit will actually do — it just stops short of the write.
        const res = await grantContributor(c.env, ownerId, b.id, row.userId, effectiveForce, dryRun)
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
    return c.json(
      {
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
      },
      200
    )
  })
}
