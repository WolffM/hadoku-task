/**
 * Sections 1-13: the claim lease itself (§4).
 *
 * N concurrent claims settle on exactly one winner; a live lease is not
 * stealable and an expired one is; heartbeat extends a good token and rejects a
 * stale one; release guards on the lane it was told to expect, then moves the
 * task and unclaims it, idempotently. Plus the two rules the lease exists to
 * enforce — agents write lanes through set-lane, humans may escape an agent
 * lane but never enter one — and the history and change-feed records it leaves.
 */
import { LANES, type Ctx } from './agent-claim-context'

export async function runClaimProtocol(ctx: Ctx) {
  const { req, check, section, tag, forceExpire } = ctx

  // ---------------------------------------------------------------------
  section('1. Set up an automation board with a task in a user lane')
  // ---------------------------------------------------------------------
  await req('POST', '/task/api/boards', { id: 'auto', name: 'Auto' })
  await req('POST', '/task/api', { id: 't1', title: 'Work me', boardId: 'auto', tag: 'needs-work' })
  const pv = await req('POST', '/task/api/boards/auto/activate-automation', {
    lanes: LANES,
    schemaId: 's',
    schemaVersion: 1,
    dryRun: true
  })
  const digest = (pv.json as { preview?: { digest?: string } } | null)?.preview?.digest
  await req('POST', '/task/api/boards/auto/activate-automation', {
    lanes: LANES,
    schemaId: 's',
    schemaVersion: 1,
    digest
  })
  check('board activated', (await req('GET', '/task/api/boards')).json !== null)

  // ---------------------------------------------------------------------
  section('2. N concurrent claims → exactly one winner (§4.1)')
  // ---------------------------------------------------------------------
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      req('POST', '/task/api/agent/claim', { board: 'auto', taskId: 't1', agentId: `agent-${i}` })
    )
  )
  const wins = results.filter(r => r.status === 200)
  const held = results.filter(r => r.status === 409 && r.json?.code === 'CLAIM_HELD')
  check('exactly one claim won', wins.length === 1, `wins=${wins.length}`)
  check('the other four → 409 CLAIM_HELD', held.length === 4, `held=${held.length}`)
  const token = wins[0].json?.token
  check('winner got a token', !!token, JSON.stringify(wins[0].json))
  check('CLAIM_HELD names the holder', typeof held[0].json?.holder === 'string')

  // ---------------------------------------------------------------------
  section('3. A live lease is not stealable')
  // ---------------------------------------------------------------------
  let r = await req('POST', '/task/api/agent/claim', {
    board: 'auto',
    taskId: 't1',
    agentId: 'thief'
  })
  check(
    're-claim while live → 409 CLAIM_HELD',
    r.status === 409 && r.json?.code === 'CLAIM_HELD',
    `status=${r.status}`
  )

  // ---------------------------------------------------------------------
  section('4. heartbeat: good token extends, stale token → LEASE_LOST')
  // ---------------------------------------------------------------------
  r = await req('POST', '/task/api/agent/heartbeat', { board: 'auto', taskId: 't1', token })
  check(
    'heartbeat with the live token → 200',
    r.status === 200 && r.json?.ok === true,
    JSON.stringify(r.json)
  )
  r = await req('POST', '/task/api/agent/heartbeat', {
    board: 'auto',
    taskId: 't1',
    token: 'not-the-token'
  })
  check(
    'heartbeat with a stale token → 409 LEASE_LOST',
    r.status === 409 && r.json?.code === 'LEASE_LOST',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // ---------------------------------------------------------------------
  section('5. set-lane is the agent path (§5.2)')
  // ---------------------------------------------------------------------
  r = await req('POST', '/task/api/agent/set-lane', {
    board: 'auto',
    taskId: 't1',
    token,
    lane: 'working'
  })
  check('set-lane into an AGENT lane → 200 (agent path)', r.status === 200, JSON.stringify(r.json))
  check('task is now in the agent lane', (await tag('t1')) === 'working')
  r = await req('POST', '/task/api/agent/set-lane', {
    board: 'auto',
    taskId: 't1',
    token,
    lane: 'bogus'
  })
  check(
    'set-lane to a non-lane → 422 LANE_UNKNOWN',
    r.status === 422 && r.json?.code === 'LANE_UNKNOWN',
    `status=${r.status}`
  )
  r = await req('POST', '/task/api/agent/set-lane', {
    board: 'auto',
    taskId: 't1',
    token: 'stale',
    lane: 'review'
  })
  check(
    'set-lane without the claim → 409 LEASE_LOST',
    r.status === 409 && r.json?.code === 'LEASE_LOST',
    `status=${r.status}`
  )

  // ---------------------------------------------------------------------
  section('6. Human cannot enter, but CAN escape, an agent lane (§5.2)')
  // ---------------------------------------------------------------------
  // Task sits in 'working' (agent). A human PATCH INTO another agent lane is refused…
  r = await req('PATCH', '/task/api/t1?boardId=auto', { tag: 'done' })
  check(
    'human into an agent lane → 403 LANE_NOT_EDITABLE',
    r.status === 403 && r.json?.code === 'LANE_NOT_EDITABLE',
    `status=${r.status}`
  )
  // …but the task is claimed, so it stays put; the escape hatch is tested after release.

  // ---------------------------------------------------------------------
  section('7. release: LANE_CHANGED guard, then move + notes + unclaim (§4.2)')
  // ---------------------------------------------------------------------
  // ifCurrentLane guard: task is in 'working', claim it as 'review' → mismatch.
  r = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 't1',
    token,
    lane: 'review',
    ifCurrentLane: 'needs-work'
  })
  check(
    'release with a stale ifCurrentLane → 409 LANE_CHANGED',
    r.status === 409 && r.json?.code === 'LANE_CHANGED',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check('LANE_CHANGED wrote nothing — still in working', (await tag('t1')) === 'working')
  // Correct release → moves to 'review', writes notes, unclaims.
  r = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 't1',
    token,
    lane: 'review',
    notes: 'the plan',
    outcome: 'ok',
    ifCurrentLane: 'working'
  })
  check(
    'release → 200 released',
    r.status === 200 && r.json?.released === true,
    JSON.stringify(r.json)
  )
  check('task moved to the release lane', (await tag('t1')) === 'review')
  const t1 = (await req('GET', '/task/api/tasks?boardId=auto')).json?.tasks?.find(
    t => t.id === 't1'
  )
  check('release wrote the notes', t1?.notes === 'the plan')
  check('release did NOT change state (§5.6)', t1?.state === undefined || t1?.state === 'Active')

  // ---------------------------------------------------------------------
  section('8. release is idempotent on token (§4.2)')
  // ---------------------------------------------------------------------
  r = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 't1',
    token,
    lane: 'done'
  })
  check(
    'replayed release → 200 no-op (released:false)',
    r.status === 200 && r.json?.released === false,
    JSON.stringify(r.json)
  )
  check('idempotent replay did NOT move the task again', (await tag('t1')) === 'review')

  // ---------------------------------------------------------------------
  section('9. After release the task is claimable again')
  // ---------------------------------------------------------------------
  r = await req('POST', '/task/api/agent/claim', {
    board: 'auto',
    taskId: 't1',
    agentId: 'agent-B'
  })
  check('claim after release → 200', r.status === 200, JSON.stringify(r.json))
  const token2 = r.json?.token

  // ---------------------------------------------------------------------
  section('10. An EXPIRED lease is stealable; the old token is dead')
  // ---------------------------------------------------------------------
  forceExpire('t1')
  r = await req('POST', '/task/api/agent/claim', {
    board: 'auto',
    taskId: 't1',
    agentId: 'agent-C'
  })
  check('claim an expired lease → 200 (stolen)', r.status === 200, JSON.stringify(r.json))
  const token3 = r.json?.token
  check('a fresh token was minted', !!token3 && token3 !== token2)
  r = await req('POST', '/task/api/agent/heartbeat', { board: 'auto', taskId: 't1', token: token2 })
  check(
    'the stolen-from token → 409 LEASE_LOST',
    r.status === 409 && r.json?.code === 'LEASE_LOST',
    `status=${r.status}`
  )
  // Release with the new token to free the task.
  await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 't1',
    token: token3,
    lane: 'working'
  })

  // ---------------------------------------------------------------------
  section('11. An unclaimed agent lane is escapable by a human (§5.2)')
  // ---------------------------------------------------------------------
  check('task rests in an agent lane, unclaimed', (await tag('t1')) === 'working')
  r = await req('PATCH', '/task/api/t1?boardId=auto', { tag: '' })
  check('human clears an unclaimed agent-lane task → 200', r.status === 200, JSON.stringify(r.json))
  check('task escaped to the Inbox', !(await tag('t1')))

  // ---------------------------------------------------------------------
  section('12. Claim history records each attempt (§5.7)')
  // ---------------------------------------------------------------------
  r = await req('GET', '/task/api/agent/history?board=auto&task=t1')
  check('history has rows', (r.json?.history?.length ?? 0) >= 2, JSON.stringify(r.json?.history))
  check(
    'a released claim recorded ended_by=release',
    r.json?.history?.some(h => h.endedBy === 'release') === true
  )

  // ---------------------------------------------------------------------
  section('13. Change feed cursors forward with zero extra writes (§4.4)')
  // ---------------------------------------------------------------------
  const feed1 = await req('GET', '/task/api/changes')
  const cursor = feed1.json?.cursor ?? ''
  check('feed returns a cursor', !!cursor, JSON.stringify(feed1.json?.cursor))
  // Make one change, then poll since the cursor — only the changed task appears.
  await req('POST', '/task/api', { id: 't2', title: 'new one', boardId: 'auto' })
  const feed2 = await req('GET', `/task/api/changes?since=${encodeURIComponent(cursor)}`)
  check(
    'poll since cursor sees the new task',
    feed2.json?.changes?.some(c => c.id === 't2') === true,
    JSON.stringify(feed2.json?.changes)
  )
  check(
    'poll since cursor does NOT replay old tasks',
    !feed2.json?.changes?.some(c => c.id === 't1'),
    JSON.stringify(feed2.json?.changes)
  )
}
