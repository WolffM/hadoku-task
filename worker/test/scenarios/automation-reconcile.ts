/**
 * Sections 14-15: repairing the boards that predate the auto-grants.
 *
 * `reconcile-shares` backfills the runner and service-key shares onto links
 * made before sections 12-13's behaviour existed — seeded here by writing the
 * legacy row straight into D1, the only honest way to produce a shape no
 * current code path can. `allOwners` then sweeps every owner from a
 * service-tier key, which must not let that key escalate a board it does not
 * own.
 *
 * Runs after runShareGrants.
 */
import {
  AGGREGATOR,
  LANES,
  OWNER,
  RUNNER,
  type Body,
  type Ctx,
  type Res,
  type User
} from './automation-context'

export async function runReconcile(ctx: Ctx) {
  const { req, reqTier, check, section, d1 } = ctx
  // Scratch response, reassigned per assertion — never read before it is set.
  let r: Res

  // ---------------------------------------------------------------------
  section('14. Reconcile backfills links made BEFORE the auto-grants shipped')
  // ---------------------------------------------------------------------
  // Simulate legacy rows the only way that's honest: write the link straight into
  // D1 and leave no share behind, exactly as a board connected before the feature
  // existed looks today.
  const legacy = (id: string, repo: string | null, mode: string) => {
    d1.__raw
      .prepare(
        `INSERT INTO boards (user_id, id, handle, name, tags, mode, repo, lanes, created_at, updated_at)
                VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)`
      )
      .run(
        OWNER.id,
        id,
        `LEGACY${id.toUpperCase().replace(/[^A-Z0-9]/g, '')}`,
        id,
        mode,
        repo,
        mode === 'automation' ? JSON.stringify(LANES) : null,
        new Date().toISOString(),
        new Date().toISOString()
      )
  }
  legacy('old-repo', 'WolffM/hadoku-aggregator', 'standard')
  legacy('old-auto', null, 'automation')
  legacy('old-both', 'WolffM/hadoku_site', 'automation')
  legacy('old-typo', 'WolffM/not-a-real-repo', 'standard')

  const sharesOn = async (board: string) => {
    const r = await req(OWNER, 'GET', `/task/api/boards/${board}/shares`)
    return r.json?.shares ?? []
  }
  const planFor = (body: Body | null, board: string) =>
    body?.boards?.find(b => b.boardId === board)?.grants ?? []

  // A dry run is the DEFAULT — a bulk grant across every board you own must be
  // asked for, never stumbled into.
  r = await req(OWNER, 'POST', '/task/api/boards/reconcile-shares', {})
  check(
    'reconcile defaults to a dry run',
    r.status === 200 && r.json?.dryRun === true,
    `status=${r.status} ${JSON.stringify(r.json?.summary)}`
  )
  check(
    'the dry run plans the repo key for a legacy repo link',
    planFor(r.json, 'old-repo').some(
      g => g.kind === 'repo' && g.name === 'aggregator-service-key' && g.outcome === 'granted'
    ),
    JSON.stringify(planFor(r.json, 'old-repo'))
  )
  check(
    'the dry run plans the runner for a legacy automation board',
    planFor(r.json, 'old-auto').some(
      g => g.kind === 'automation-runner' && g.name === 'tenhands-service-key'
    ),
    JSON.stringify(planFor(r.json, 'old-auto'))
  )
  check(
    'a board that is BOTH linked and automated plans both grants',
    planFor(r.json, 'old-both').length === 2 &&
      planFor(r.json, 'old-both').some(g => g.name === 'site-service-key') &&
      planFor(r.json, 'old-both').some(g => g.name === 'tenhands-service-key'),
    JSON.stringify(planFor(r.json, 'old-both'))
  )
  check(
    'a repo that does NOT validate against GitHub is skipped, not granted',
    planFor(r.json, 'old-typo').every(g => g.outcome === 'skipped') &&
      planFor(r.json, 'old-typo')[0]?.reason?.includes('did not validate'),
    JSON.stringify(planFor(r.json, 'old-typo'))
  )
  check('the dry run wrote NOTHING', (await sharesOn('old-repo')).length === 0)

  // Commit.
  r = await req(OWNER, 'POST', '/task/api/boards/reconcile-shares', { dryRun: false })
  check(
    'the commit reports dryRun false and grants',
    r.json?.dryRun === false && (r.json?.summary?.granted ?? 0) >= 4,
    JSON.stringify(r.json?.summary)
  )
  check(
    'the legacy repo link is now really shared with its repo key',
    (await sharesOn('old-repo')).some(
      s => s.name === 'aggregator-service-key' && s.level === 'contributor'
    ),
    JSON.stringify(await sharesOn('old-repo'))
  )
  check(
    'the legacy automation board is now really shared with the runner',
    (await sharesOn('old-auto')).some(
      s => s.name === 'tenhands-service-key' && s.level === 'contributor'
    ),
    JSON.stringify(await sharesOn('old-auto'))
  )
  check(
    'the unvalidated repo got NO share at all',
    (await sharesOn('old-typo')).length === 0,
    JSON.stringify(await sharesOn('old-typo'))
  )

  // Functional proof, not just rows: the repo's key can drive a board it was never
  // hand-shared, through the backfill alone.
  const oldRepoHandle = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards?.find(
    b => b.id === 'old-repo'
  )?.handle
  await req(OWNER, 'POST', '/task/api', { id: 'OR1', title: 'legacy task', boardId: 'old-repo' })
  r = await req(AGGREGATOR, 'GET', `/task/api/tasks?boardId=${oldRepoHandle}`)
  check(
    "the repo's key can now read the backfilled board",
    r.status === 200 && (r.json?.tasks ?? []).some(t => t.id === 'OR1'),
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // Re-running is safe: nothing new, and the counts say so.
  r = await req(OWNER, 'POST', '/task/api/boards/reconcile-shares', { dryRun: false })
  check(
    're-running grants nothing new — every link reports already_shared',
    r.json?.summary?.granted === 0 &&
      r.json?.summary?.escalated === 0 &&
      (r.json?.summary?.alreadyShared ?? 0) >= 4,
    JSON.stringify(r.json?.summary)
  )

  // force (the default) repairs a share that sits below contributor, and says so.
  await req(OWNER, 'POST', '/task/api/boards/old-repo/shares', {
    name: 'aggregator-service-key',
    level: 'readonly'
  })
  r = await req(OWNER, 'POST', '/task/api/boards/reconcile-shares', { dryRun: false, force: false })
  check(
    'force:false leaves a readonly share alone',
    (await sharesOn('old-repo')).find(s => s.name === 'aggregator-service-key')?.level ===
      'readonly',
    JSON.stringify(await sharesOn('old-repo'))
  )
  r = await req(OWNER, 'POST', '/task/api/boards/reconcile-shares', { dryRun: false })
  check(
    'force (the default) escalates it back to contributor and NAMES the level it replaced',
    planFor(r.json, 'old-repo').some(
      g => g.outcome === 'escalated' && g.previousLevel === 'readonly'
    ),
    JSON.stringify(planFor(r.json, 'old-repo'))
  )
  check(
    '…and the share really is contributor now',
    (await sharesOn('old-repo')).find(s => s.name === 'aggregator-service-key')?.level ===
      'contributor',
    JSON.stringify(await sharesOn('old-repo'))
  )

  // THE DRY RUN'S PLAN MUST EQUAL WHAT THE COMMIT DOES. It used to report every
  // target as `granted` without looking for an existing row, so a prod sweep
  // previewed 13 grants and then made 7 — a preview you can't act on. Run the two
  // back to back on a fully-reconciled state and demand identical tallies.
  const previewSummary = (await req(OWNER, 'POST', '/task/api/boards/reconcile-shares', {})).json
    ?.summary
  const commitSummary = (
    await req(OWNER, 'POST', '/task/api/boards/reconcile-shares', { dryRun: false })
  ).json?.summary
  check(
    'a dry run over already-reconciled boards reports already_shared, NOT granted',
    previewSummary?.granted === 0 && (previewSummary?.alreadyShared ?? 0) > 0,
    JSON.stringify(previewSummary)
  )
  check(
    'and the dry run tally matches the commit tally exactly',
    JSON.stringify(previewSummary) === JSON.stringify(commitSummary),
    `preview=${JSON.stringify(previewSummary)} commit=${JSON.stringify(commitSummary)}`
  )

  // A standard board with no repo is not "work" — it must not appear in the report.
  check(
    'boards with no link at all are left out of the report entirely',
    !r.json?.boards?.some(b => b.boardId === 'plain-none'),
    JSON.stringify(r.json?.boards?.map(b => b.boardId))
  )

  // ---------------------------------------------------------------------
  section('15. allOwners: a service-tier sweep across every owner (§7)')
  // ---------------------------------------------------------------------
  // A SECOND owner with a legacy link the caller can't otherwise touch.
  const OTHER: User = { key: 'other-key', id: 'other-uid' }
  d1.__raw
    .prepare(
      `INSERT INTO boards (user_id, id, handle, name, tags, mode, repo, created_at, updated_at)
              VALUES (?, 'their-board', 'LEGACYTHEIRS', 'Theirs', '[]', 'standard', ?, ?, ?)`
    )
    .run(OTHER.id, 'WolffM/hadoku-aggregator', new Date().toISOString(), new Date().toISOString())

  const theirShares = async () => {
    const r = await req(OTHER, 'GET', '/task/api/boards/their-board/shares')
    return r.json?.shares ?? []
  }

  // Own-scope can't see it — that's the whole reason allOwners exists.
  r = await req(OWNER, 'POST', '/task/api/boards/reconcile-shares', { dryRun: false })
  check(
    "an own-scope reconcile never touches another owner's board",
    (await theirShares()).length === 0,
    JSON.stringify(await theirShares())
  )

  // friend tier is refused the sweep.
  r = await req(OWNER, 'POST', '/task/api/boards/reconcile-shares', { allOwners: true })
  check(
    'allOwners from a friend-tier caller → 403 FORBIDDEN',
    r.status === 403 && r.json?.code === 'FORBIDDEN',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // A service-tier caller may sweep. RUNNER is registered tier:'service'.
  r = await reqTier(RUNNER, 'service', 'POST', '/task/api/boards/reconcile-shares', {
    allOwners: true
  })
  check(
    'allOwners from a service-tier caller → 200, and reports it',
    r.status === 200 && r.json?.allOwners === true && r.json?.dryRun === true,
    `status=${r.status} ${JSON.stringify(r.json?.summary)}`
  )
  const theirPlan = r.json?.boards?.find(b => b.boardId === 'their-board')
  check(
    "the sweep plans the other owner's board and names whose it is",
    theirPlan?.ownerId === OTHER.id &&
      theirPlan?.grants?.some(g => g.name === 'aggregator-service-key'),
    JSON.stringify(theirPlan)
  )
  check('that dry run still wrote nothing', (await theirShares()).length === 0)

  r = await reqTier(RUNNER, 'service', 'POST', '/task/api/boards/reconcile-shares', {
    allOwners: true,
    dryRun: false
  })
  check(
    "the committed sweep really shares the OTHER owner's board",
    (await theirShares()).some(
      s => s.name === 'aggregator-service-key' && s.level === 'contributor'
    ),
    JSON.stringify(await theirShares())
  )

  // The boundary that matters: a service caller must NOT overwrite a level another
  // owner set by hand, even with force (the default).
  await req(OTHER, 'POST', '/task/api/boards/their-board/shares', {
    name: 'tenhands-service-key',
    level: 'readonly'
  })
  d1.__raw
    .prepare("UPDATE boards SET mode = 'automation', lanes = ? WHERE user_id = ? AND id = ?")
    .run(JSON.stringify(LANES), OTHER.id, 'their-board')
  r = await reqTier(RUNNER, 'service', 'POST', '/task/api/boards/reconcile-shares', {
    allOwners: true,
    dryRun: false
  })
  check(
    "force does NOT escalate another owner's deliberate readonly",
    (await theirShares()).find(s => s.name === 'tenhands-service-key')?.level === 'readonly',
    JSON.stringify(await theirShares())
  )
  check(
    '…and the report says so rather than looking like a plain no-op',
    r.json?.boards
      ?.find(b => b.boardId === 'their-board')
      ?.grants?.some(g => g.reason?.includes("another owner's board")),
    JSON.stringify(r.json?.boards?.find(b => b.boardId === 'their-board'))
  )
  // But the owner themselves still can.
  r = await req(OTHER, 'POST', '/task/api/boards/reconcile-shares', { dryRun: false })
  check(
    'the board OWNER can still escalate it themselves',
    (await theirShares()).find(s => s.name === 'tenhands-service-key')?.level === 'contributor',
    JSON.stringify(await theirShares())
  )
}
