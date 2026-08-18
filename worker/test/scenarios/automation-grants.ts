/**
 * Sections 12-13: the shares a board grants on its own behalf.
 *
 * Activating a board auto-shares it with the automation runner named by
 * AUTOMATION_RUNNER_KEY_NAME, and connecting a repo shares it with that repo's
 * service key (§5.5, §7). Both degrade rather than throw when the name does not
 * resolve, and both are asserted functionally — over the agent flow the runner
 * actually uses — not just by reading the share row back.
 *
 * Runs after runCoreFlow and inherits the boards it left behind.
 */
import {
  AGGREGATOR,
  CONTRIB,
  LANES,
  OWNER,
  RUNNER,
  repoOfVia,
  type Ctx,
  type Res
} from './automation-context'

export async function runShareGrants(ctx: Ctx) {
  const { req, check, section, tasks, env } = ctx
  // Scratch response, reassigned per assertion — never read before it is set.
  let r: Res
  const repoOf = repoOfVia(ctx)

  // ---------------------------------------------------------------------
  section('12. Activation auto-shares the board with the automation runner (§7)')
  // ---------------------------------------------------------------------
  // The point of the feature: an automation board is useless to the runner until
  // it holds a share, and that hand-typed step is the one everyone forgot. So
  // prove the grant FUNCTIONALLY — the runner must be able to drive the board it
  // was never explicitly shared with.
  await req(OWNER, 'POST', '/task/api/boards', { id: 'auto', name: 'Auto' })
  await req(OWNER, 'POST', '/task/api', { id: 'a1', title: 'Runner target', boardId: 'auto' })

  r = await req(OWNER, 'POST', '/task/api/boards/auto/activate-automation', {
    lanes: LANES,
    dryRun: true
  })
  const autoDigest = r.json?.preview?.digest
  check(
    'a dry run reports no grant (it writes nothing, and resolves no registry)',
    r.status === 200 && r.json?.automationRunnerShare === undefined,
    JSON.stringify(r.json?.automationRunnerShare)
  )

  r = await req(OWNER, 'POST', '/task/api/boards/auto/activate-automation', {
    lanes: LANES,
    digest: autoDigest
  })
  check('commit → 200', r.status === 200, JSON.stringify(r.json))
  check(
    'commit granted the runner a share, resolved by registry NAME',
    r.json?.automationRunnerShare?.granted === true &&
      r.json?.automationRunnerShare?.name === 'tenhands-service-key' &&
      r.json?.automationRunnerShare?.granteeUserId === 'tenhands-uid',
    JSON.stringify(r.json?.automationRunnerShare)
  )

  // The share is real, at contributor, and named — not just a claim in a response.
  const autoHandle = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards?.find(
    b => b.id === 'auto'
  )?.handle
  r = await req(OWNER, 'GET', '/task/api/boards/auto/shares')
  const runnerShare = r.json?.shares?.find(s => s.granteeUserId === 'tenhands-uid')
  check(
    'the share row exists at contributor, annotated with the runner name',
    runnerShare?.level === 'contributor' && runnerShare?.name === 'tenhands-service-key',
    JSON.stringify(r.json?.shares)
  )
  check(
    'the dev-vault identity that shares the name stem was NOT granted anything',
    !r.json?.shares?.some(s => s.granteeUserId === 'devvault-uid'),
    JSON.stringify(r.json?.shares)
  )

  // Functional proof, over the real agent flow the runner actually uses: read the
  // board by handle, claim a task, set-lane it into an AGENT lane. Every one of
  // those needs a contributor share, and nobody granted one by hand.
  r = await req(RUNNER, 'GET', `/task/api/tasks?boardId=${autoHandle}`)
  check(
    'the runner can now READ the board it was never hand-shared',
    r.status === 200 && (r.json?.tasks ?? []).some(t => t.id === 'a1'),
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  r = await req(RUNNER, 'POST', '/task/api/agent/claim', {
    board: autoHandle,
    taskId: 'a1',
    agentId: 'tenhands'
  })
  const runnerToken = r.json?.token
  check(
    'the runner can CLAIM a task on it',
    r.status === 200 && !!runnerToken,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  r = await req(RUNNER, 'POST', '/task/api/agent/set-lane', {
    board: autoHandle,
    taskId: 'a1',
    token: runnerToken,
    lane: 'working'
  })
  check(
    'the runner can WRITE an agent lane on it',
    r.status === 200,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check(
    "the write landed in the OWNER's namespace",
    (await tasks(OWNER, 'auto')).find(t => t.id === 'a1')?.tag === 'working',
    JSON.stringify(await tasks(OWNER, 'auto'))
  )
  await req(RUNNER, 'POST', '/task/api/agent/release', {
    board: autoHandle,
    taskId: 'a1',
    token: runnerToken
  })

  // Re-activation is idempotent: it reports the existing row, it doesn't re-grant.
  r = await req(OWNER, 'POST', '/task/api/boards/auto/activate-automation', {
    lanes: LANES,
    dryRun: true
  })
  r = await req(OWNER, 'POST', '/task/api/boards/auto/activate-automation', {
    lanes: LANES,
    digest: r.json?.preview?.digest
  })
  check(
    're-activation reports already_shared, not a second grant',
    r.json?.automationRunnerShare?.granted === false &&
      r.json?.automationRunnerShare?.reason === 'already_shared',
    JSON.stringify(r.json?.automationRunnerShare)
  )

  // An owner who deliberately pins the runner to readonly must not have that
  // silently escalated back to contributor by the next activation. This is why the
  // insert is DO NOTHING and not the upsert the manual grant path uses.
  await req(OWNER, 'POST', '/task/api/boards/auto/shares', {
    name: 'tenhands-service-key',
    level: 'readonly'
  })
  r = await req(OWNER, 'POST', '/task/api/boards/auto/activate-automation', {
    lanes: LANES,
    dryRun: true
  })
  r = await req(OWNER, 'POST', '/task/api/boards/auto/activate-automation', {
    lanes: LANES,
    digest: r.json?.preview?.digest
  })
  r = await req(OWNER, 'GET', '/task/api/boards/auto/shares')
  check(
    "re-activation did NOT escalate the owner's deliberate readonly back to contributor",
    r.json?.shares?.find(s => s.granteeUserId === 'tenhands-uid')?.level === 'readonly',
    JSON.stringify(r.json?.shares)
  )
  r = await req(RUNNER, 'PATCH', '/task/api/a1', { tag: 'needs-plan', boardId: autoHandle })
  check(
    'and the readonly runner is genuinely refused the write → 403',
    r.status === 403,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // A CONTRIBUTOR upgrading an already-automated board must not be able to hand a
  // third identity access to a board it doesn't own — so it grants nothing. (It has
  // to be `auto`, not `flow`: section 10 deactivated flow, and converting a standard
  // board is owner-only, so a contributor would 403 before reaching the grant.)
  await req(OWNER, 'POST', '/task/api/boards/auto/shares', {
    key: 'contrib-key',
    level: 'contributor'
  })
  r = await req(CONTRIB, 'POST', `/task/api/boards/${autoHandle}/activate-automation`, {
    lanes: LANES,
    dryRun: true
  })
  r = await req(CONTRIB, 'POST', `/task/api/boards/${autoHandle}/activate-automation`, {
    lanes: LANES,
    digest: r.json?.preview?.digest
  })
  check(
    "a contributor's activation reports no grant (owner-only)",
    r.status === 200 && r.json?.automationRunnerShare === undefined,
    `status=${r.status} ${JSON.stringify(r.json?.automationRunnerShare)}`
  )

  // A registry with no row for the configured runner name is reported, not hidden:
  // activation still succeeds, and the response says exactly why nothing was granted.
  env.AUTOMATION_RUNNER_KEY_NAME = 'no-such-runner-key'
  await req(OWNER, 'POST', '/task/api/boards', { id: 'orphan', name: 'Orphan' })
  r = await req(OWNER, 'POST', '/task/api/boards/orphan/activate-automation', {
    lanes: LANES,
    dryRun: true
  })
  r = await req(OWNER, 'POST', '/task/api/boards/orphan/activate-automation', {
    lanes: LANES,
    digest: r.json?.preview?.digest
  })
  check(
    'an unresolvable runner name → activation still succeeds',
    r.status === 200 && r.json?.applied?.mode === 'automation',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check(
    '…and reports no_registry_row rather than silently skipping',
    r.json?.automationRunnerShare?.granted === false &&
      r.json?.automationRunnerShare?.reason === 'no_registry_row',
    JSON.stringify(r.json?.automationRunnerShare)
  )
  delete env.AUTOMATION_RUNNER_KEY_NAME

  // ---------------------------------------------------------------------
  section("13. Connecting a repo shares the board with that repo's service key (§5.5)")
  // ---------------------------------------------------------------------
  // The grantee is derived from the repo NAME by convention:
  // `<repo, minus a leading "hadoku-">-service-key`. The registry row carries no
  // `repo` field, so the name is the only link between a checkout mapping and an
  // identity — which makes this derivation worth pinning down precisely.
  await req(OWNER, 'POST', '/task/api/boards', { id: 'linked', name: 'Linked' })
  await req(OWNER, 'POST', '/task/api', { id: 'L1', title: 'Repo work', boardId: 'linked' })

  r = await req(OWNER, 'POST', '/task/api/boards/linked/repo', {
    repo: 'WolffM/hadoku-aggregator'
  })
  check(
    'hadoku-aggregator → aggregator-service-key, granted',
    r.status === 200 &&
      r.json?.serviceKeyShare?.granted === true &&
      r.json?.serviceKeyShare?.name === 'aggregator-service-key' &&
      r.json?.serviceKeyShare?.granteeUserId === 'aggregator-uid',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // Functional proof: the repo's own key can now reach the board it drives.
  const linkedHandle = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards?.find(
    b => b.id === 'linked'
  )?.handle
  r = await req(AGGREGATOR, 'GET', `/task/api/tasks?boardId=${linkedHandle}`)
  check(
    "the repo's service key can now READ the board it was never hand-shared",
    r.status === 200 && (r.json?.tasks ?? []).some(t => t.id === 'L1'),
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // A repo WITHOUT the hadoku- prefix keeps its whole name (this is the real shape
  // of tenhands' key, so the convention has to leave it alone).
  await req(OWNER, 'POST', '/task/api/boards', { id: 'plain', name: 'Plain' })
  r = await req(OWNER, 'POST', '/task/api/boards/plain/repo', { repo: 'WolffM/tenhands' })
  check(
    'a repo with no hadoku- prefix → tenhands-service-key, granted',
    r.json?.serviceKeyShare?.granted === true &&
      r.json?.serviceKeyShare?.name === 'tenhands-service-key',
    JSON.stringify(r.json?.serviceKeyShare)
  )

  // The owner segment is dropped, and a bare repo name works the same way.
  await req(OWNER, 'POST', '/task/api/boards', { id: 'bare', name: 'Bare' })
  r = await req(OWNER, 'POST', '/task/api/boards/bare/repo', { repo: 'hadoku-aggregator' })
  check(
    'a bare repo name (no owner segment) derives the same key',
    r.json?.serviceKeyShare?.name === 'aggregator-service-key' &&
      r.json?.serviceKeyShare?.granted === true,
    JSON.stringify(r.json?.serviceKeyShare)
  )

  // The separator after `hadoku` may be an underscore: WolffM/hadoku_site is a real
  // repo whose real key is `site-service-key`, and a hyphen-only trim misses it.
  await req(OWNER, 'POST', '/task/api/boards', { id: 'site', name: 'Site' })
  r = await req(OWNER, 'POST', '/task/api/boards/site/repo', { repo: 'WolffM/hadoku_site' })
  check(
    'hadoku_site (underscore prefix) → site-service-key, granted',
    r.json?.serviceKeyShare?.granted === true &&
      r.json?.serviceKeyShare?.name === 'site-service-key' &&
      r.json?.serviceKeyShare?.granteeUserId === 'site-uid',
    JSON.stringify(r.json?.serviceKeyShare)
  )

  // The prefix trim is case-insensitive, and resolution is too — so this lands on
  // the SAME identity that's already shared on `linked`.
  r = await req(OWNER, 'POST', '/task/api/boards/linked/repo', {
    repo: 'WolffM/HADOKU-Aggregator'
  })
  check(
    'the hadoku- trim is case-insensitive, and re-connecting reports already_shared',
    r.json?.serviceKeyShare?.granted === false &&
      r.json?.serviceKeyShare?.reason === 'already_shared',
    JSON.stringify(r.json?.serviceKeyShare)
  )

  // A repo whose key hasn't been minted yet must NOT cost the repo mapping.
  await req(OWNER, 'POST', '/task/api/boards', { id: 'unminted', name: 'Unminted' })
  r = await req(OWNER, 'POST', '/task/api/boards/unminted/repo', { repo: 'WolffM/hadoku-nothing' })
  check(
    'an unminted repo key → no_registry_row, and the repo still saves',
    r.status === 200 &&
      r.json?.repo === 'WolffM/hadoku-nothing' &&
      r.json?.serviceKeyShare?.granted === false &&
      r.json?.serviceKeyShare?.name === 'nothing-service-key' &&
      r.json?.serviceKeyShare?.reason === 'no_registry_row',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check(
    '…and it really persisted on the board',
    (await repoOf('unminted')) === 'WolffM/hadoku-nothing',
    String(await repoOf('unminted'))
  )

  // Clearing the repo attempts no grant — and must NOT revoke the existing one.
  // Taking access away is an explicit owner action, not a side effect of blanking
  // a field.
  r = await req(OWNER, 'POST', '/task/api/boards/linked/repo', { repo: '' })
  check(
    'clearing the repo reports no grant attempt at all',
    r.status === 200 && r.json?.repo === null && r.json?.serviceKeyShare === undefined,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  r = await req(OWNER, 'GET', '/task/api/boards/linked/shares')
  check(
    '…and the share it granted earlier is left intact, not silently revoked',
    r.json?.shares?.some(s => s.granteeUserId === 'aggregator-uid'),
    JSON.stringify(r.json?.shares)
  )

  // An activation that CONNECTS a repo earns the same grant, alongside the runner's.
  await req(OWNER, 'POST', '/task/api/boards', { id: 'both', name: 'Both' })
  r = await req(OWNER, 'POST', '/task/api/boards/both/activate-automation', {
    lanes: LANES,
    repo: 'WolffM/hadoku-aggregator',
    dryRun: true
  })
  r = await req(OWNER, 'POST', '/task/api/boards/both/activate-automation', {
    lanes: LANES,
    repo: 'WolffM/hadoku-aggregator',
    digest: r.json?.preview?.digest
  })
  check(
    'activating WITH a repo grants both the runner and the repo service key',
    r.json?.automationRunnerShare?.granted === true &&
      r.json?.automationRunnerShare?.name === 'tenhands-service-key' &&
      r.json?.repoServiceKeyShare?.granted === true &&
      r.json?.repoServiceKeyShare?.name === 'aggregator-service-key',
    JSON.stringify(r.json)
  )

  // A re-activation that omits `repo` connects nothing new (COALESCE keeps the
  // existing mapping), so it must not claim a repo grant it didn't attempt.
  r = await req(OWNER, 'POST', '/task/api/boards/both/activate-automation', {
    lanes: LANES,
    dryRun: true
  })
  r = await req(OWNER, 'POST', '/task/api/boards/both/activate-automation', {
    lanes: LANES,
    digest: r.json?.preview?.digest
  })
  check(
    'activating WITHOUT a repo reports no repo grant',
    r.status === 200 && r.json?.repoServiceKeyShare === undefined,
    JSON.stringify(r.json?.repoServiceKeyShare)
  )
}
