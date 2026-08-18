/**
 * Sections 14-19: the same protocol as the outside world reaches it.
 *
 * MCP drives claim/heartbeat/release and forwards the structured error code
 * rather than flattening it to a message; pagination and create_board round out
 * the T8 surface; the TenHands blockers (hydrated GET /boards/:ref, the cancel
 * path) and the §6 confirmations are asserted here. Then two ceilings that bind
 * the agent path specifically: the service-tier throttle and the 64 KB notes cap.
 *
 * Runs after runClaimProtocol and inherits the board it left behind.
 */
import { type Ctx, type Res } from './agent-claim-context'

export async function runAgentSurface(ctx: Ctx) {
  const { req, mcp, check, section, tag, app, env, EDGE_SECRET } = ctx
  // Scratch response, reassigned per assertion — never read before it is set.
  let r: Res

  // ---------------------------------------------------------------------
  section('14. MCP drives the protocol + forwards the structured code (§4.3)')
  // ---------------------------------------------------------------------
  await req('POST', '/task/api', {
    id: 't3',
    title: 'mcp task',
    boardId: 'auto',
    tag: 'needs-work'
  })
  const mc = await mcp('claim_task', { taskId: 't3', board: 'auto', lane: 'working' })
  check('MCP claim_task → token', !!mc.structuredContent?.token, JSON.stringify(mc))
  const mcpToken = mc.structuredContent?.token
  const mc2 = await mcp('claim_task', { taskId: 't3', board: 'auto' })
  check(
    'MCP double-claim → isError with CLAIM_HELD code',
    mc2.isError === true && mc2.structuredContent?.code === 'CLAIM_HELD',
    JSON.stringify(mc2)
  )
  const mcRel = await mcp('release_claim', {
    taskId: 't3',
    board: 'auto',
    token: mcpToken,
    lane: 'review',
    notes: 'done via mcp'
  })
  check(
    'MCP release_claim → released',
    mcRel.structuredContent?.released === true,
    JSON.stringify(mcRel)
  )
  const mcChanges = await mcp('list_changes', {})
  check(
    'MCP list_changes returns a cursor',
    mcChanges.structuredContent?.cursor !== undefined,
    JSON.stringify(mcChanges)
  )

  // ---------------------------------------------------------------------
  section('15. T8 hardening: pagination + create_board over MCP')
  // ---------------------------------------------------------------------
  const paged = await mcp('list_tasks', { board: 'auto', limit: 1 })
  const pc = paged.structuredContent as
    | { count?: number; total?: number; nextOffset?: number | null }
    | undefined
  check('list_tasks honours limit', pc?.count === 1, JSON.stringify(pc))
  check('list_tasks reports total ≥ count', (pc?.total ?? 0) >= 1)
  check(
    'list_tasks paginates (nextOffset set when more remain)',
    (pc?.total ?? 0) > 1 ? pc?.nextOffset === 1 : pc?.nextOffset === null,
    JSON.stringify(pc)
  )
  const cb = await mcp('create_board', { id: 'made-by-mcp', name: 'Made by MCP' })
  check(
    'MCP create_board → ok',
    !cb.isError && (cb.structuredContent as { ok?: boolean } | undefined)?.ok === true,
    JSON.stringify(cb)
  )
  const boardsAfter = (await mcp('list_boards')).structuredContent?.boards ?? []
  check(
    'the new board appears in list_boards',
    boardsAfter.some(b => b.id === 'made-by-mcp')
  )

  // ---------------------------------------------------------------------
  section('16. TenHands blockers: hydrated GET /boards/:ref + cancel path')
  // ---------------------------------------------------------------------
  // Set repo on the board so the hydrated view returns it (via re-activation).
  await req('POST', '/task/api', {
    id: 'h1',
    title: 'to hydrate',
    boardId: 'auto',
    tag: 'needs-work'
  })
  const claimH = await req('POST', '/task/api/agent/claim', {
    board: 'auto',
    taskId: 'h1',
    agentId: 'hydrater'
  })
  const hToken = claimH.json?.token
  const full = await req('GET', '/task/api/boards/auto')
  const fb = full.json as unknown as {
    board?: { mode?: string; lanes?: unknown[]; repo?: string | null }
    tasks?: Array<{ id: string; claimed?: boolean }>
  }
  check(
    'GET /boards/:ref → hydrated board with mode + lanes',
    fb.board?.mode === 'automation' && (fb.board?.lanes?.length ?? 0) === 4,
    JSON.stringify(fb.board)
  )
  check(
    'hydrated tasks carry a `claimed` flag',
    fb.tasks?.find(t => t.id === 'h1')?.claimed === true,
    JSON.stringify(fb.tasks?.find(t => t.id === 'h1'))
  )
  check('an unclaimed task shows claimed:false', fb.tasks?.some(t => t.claimed === false) === true)
  // Owner cancels the claim → the holder's heartbeat then → LEASE_LOST.
  const cancel = await req('POST', '/task/api/agent/cancel', { board: 'auto', taskId: 'h1' })
  check(
    'owner cancel → dropped',
    cancel.status === 200 && (cancel.json as unknown as { dropped?: boolean }).dropped === true,
    JSON.stringify(cancel.json)
  )
  const hbAfter = await req('POST', '/task/api/agent/heartbeat', {
    board: 'auto',
    taskId: 'h1',
    token: hToken
  })
  check(
    'the cancelled agent heartbeat → 409 LEASE_LOST',
    hbAfter.status === 409 && hbAfter.json?.code === 'LEASE_LOST',
    `status=${hbAfter.status}`
  )
  check(
    'cancel is idempotent (second cancel drops nothing)',
    (await req('POST', '/task/api/agent/cancel', { board: 'auto', taskId: 'h1' })).json !== null
  )
  // MCP parity: get_board + cancel_claim.
  const mgb = await mcp('get_board', { board: 'auto' })
  check(
    'MCP get_board returns hydrated tasks',
    Array.isArray((mgb.structuredContent as { tasks?: unknown[] } | undefined)?.tasks),
    JSON.stringify(mgb).slice(0, 120)
  )

  // ---------------------------------------------------------------------
  section('17. §6 confirmations: metadata-on-release, Inbox-claim, complete-on-release')
  // ---------------------------------------------------------------------
  // Confirmation 2: claim an UNTAGGED Inbox task naming a destination lane in the
  // same write → it lands in that lane (untagged isn't a lane, so this is how a
  // runner protects it).
  await req('POST', '/task/api', { id: 'inbox1', title: 'untagged capture', boardId: 'auto' })
  const claimInbox = await req('POST', '/task/api/agent/claim', {
    board: 'auto',
    taskId: 'inbox1',
    agentId: 'planner',
    lane: 'working'
  })
  check(
    'claim an untagged Inbox task with a lane → 200',
    claimInbox.status === 200,
    JSON.stringify(claimInbox.json)
  )
  check(
    'the Inbox task moved into the named lane on claim',
    (await tag('inbox1')) === 'working',
    `tag=${await tag('inbox1')}`
  )
  const inboxToken = claimInbox.json?.token

  // Confirmation 1: a claim holder writes metadata on release (agent path, claim-gated).
  const relMeta = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 'inbox1',
    token: inboxToken,
    lane: 'review',
    metadata: { pr: 42, sha: 'abc' }
  })
  check('release with metadata → 200', relMeta.status === 200, JSON.stringify(relMeta.json))
  const inboxTask = (await req('GET', '/task/api/tasks?boardId=auto')).json?.tasks?.find(
    t => t.id === 'inbox1'
  ) as { metadata?: { pr?: number } } | undefined
  check(
    'the metadata was written on release',
    inboxTask?.metadata?.pr === 42,
    JSON.stringify(inboxTask?.metadata)
  )

  // Confirmation 3: complete-on-release archives the task (removes from active).
  await req('POST', '/task/api', {
    id: 'land1',
    title: 'ends in landed',
    boardId: 'auto',
    tag: 'needs-work'
  })
  const claimLand = await req('POST', '/task/api/agent/claim', {
    board: 'auto',
    taskId: 'land1',
    agentId: 'lander'
  })
  const relDone = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 'land1',
    token: claimLand.json?.token,
    lane: 'done',
    complete: true
  })
  check(
    'release with complete:true → completed',
    relDone.status === 200 &&
      (relDone.json as unknown as { completed?: boolean }).completed === true,
    JSON.stringify(relDone.json)
  )
  // An agent completing a task marks it Completed; it is NOT removed. It stays
  // on the board struck through for its 24h window (see task-lifecycle-verify),
  // so the owner can see what the agent finished — and reopen it if the agent
  // got it wrong.
  const landed = (await req('GET', '/task/api/tasks?boardId=auto')).json?.tasks?.find(
    t => t.id === 'land1'
  )
  check('the agent-completed task is still listed', !!landed, 'task vanished on agent completion')
  check(
    '…marked Completed rather than removed',
    (landed as unknown as { state?: string })?.state === 'Completed',
    `state=${(landed as unknown as { state?: string })?.state}`
  )

  // ---------------------------------------------------------------------
  section('18. Service tier is throttled at its own ceiling, not a human cap')
  // ---------------------------------------------------------------------
  // A service-tier request goes THROUGH the throttle (unlike friend/admin, which
  // bypass) but is far under the 600/min ceiling, so normal operation is allowed.
  const svc = await app.request(
    'http://localhost/task/api/tasks?boardId=auto',
    {
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'service',
        'X-User-Key': 'svc-key',
        'X-User-Id': 'svc-uid'
      }
    },
    env
  )
  check(
    'a service-tier request under the ceiling → 200 (not blacklisted like public)',
    svc.status === 200,
    `status=${svc.status}`
  )

  // ---------------------------------------------------------------------
  section('19. The 64 KB notes cap binds the AGENT path too (§6)')
  // ---------------------------------------------------------------------
  // The human path always enforced this; release did not — and release is the
  // path that receives machine-generated plans, so the exemption made the cap
  // decorative. A rejected release must write NOTHING and keep the lease, so the
  // runner can truncate and retry instead of losing its claim.
  // Untagged: on an automation board the human path may only write a `user`
  // lane, so an arbitrary tag here would be refused as LANE_INVALID.
  await req('POST', '/task/api', { id: 'cap1', title: 'cap probe', boardId: 'auto' })
  const capClaim = await req('POST', '/task/api/agent/claim', {
    board: 'auto',
    taskId: 'cap1',
    agentId: 'planner',
    lane: 'working'
  })
  const capToken = capClaim.json?.token
  check('claimed the cap probe', capClaim.status === 200, JSON.stringify(capClaim.json))

  const over = 'x'.repeat(64 * 1024 + 1)
  r = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 'cap1',
    token: capToken,
    lane: 'review',
    notes: over
  })
  check(
    'release with oversized notes → 413 NOTES_TOO_LARGE',
    r.status === 413 && r.json?.code === 'NOTES_TOO_LARGE',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check('the rejected release moved nothing — still in working', (await tag('cap1')) === 'working')
  const capTask = () =>
    req('GET', '/task/api/tasks?boardId=auto').then(x => x.json?.tasks?.find(t => t.id === 'cap1'))
  check('the rejected release wrote no notes', !(await capTask())?.notes)

  // Byte-counted, not length-counted: 4-byte astral chars go over the cap at a
  // quarter of the string length. A .length check would have let this through.
  r = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 'cap1',
    token: capToken,
    lane: 'review',
    notes: '𝄞'.repeat(17 * 1024) // 17k chars ≈ 68 KB encoded
  })
  check(
    'multibyte notes under the CHARACTER count but over the BYTE cap → 413',
    r.status === 413 && r.json?.code === 'NOTES_TOO_LARGE',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // The lease survived both rejections — that's what makes 413 retryable.
  r = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 'cap1',
    token: capToken,
    lane: 'review',
    notes: 'z'.repeat(64 * 1024) // exactly at the cap
  })
  check(
    'the SAME token still works after a 413 → the claim was never dropped',
    r.status === 200 && r.json?.released === true,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check('notes exactly at the cap are accepted', (await capTask())?.notes?.length === 64 * 1024)
  check('and the retry landed the task in its lane', (await tag('cap1')) === 'review')

  // ---------------------------------------------------------------------
  section('13. An agent cannot write two tags — on ANY board type (§5.2)')
  // ---------------------------------------------------------------------
  // The claim routes write `tag` with direct SQL, so they bypass the handlers'
  // single-tag collapse and need their own. On an automation board the lane
  // vocabulary already rejects a multi-token lane; a STANDARD board has no
  // vocabulary to check against, which is the hole this closes.
  await req('POST', '/task/api/boards', { id: 'plain', name: 'Plain' })
  await req('POST', '/task/api', { id: 'p1', title: 'Free tagged', boardId: 'plain', tag: 'alpha' })

  const plainTag = async () =>
    (await req('GET', '/task/api/tasks?boardId=plain')).json?.tasks?.find(t => t.id === 'p1')?.tag

  r = await req('POST', '/task/api/agent/claim', {
    board: 'plain',
    taskId: 'p1',
    agentId: 'agent-plain',
    lane: 'beta gamma'
  })
  check('claim with a two-token lane → 200', r.status === 200, JSON.stringify(r.json))
  check(
    '…and the task holds ONE tag, the last one',
    (await plainTag()) === 'gamma',
    `tag="${await plainTag()}"`
  )

  const plainToken = (r.json as { token?: string } | null)?.token as string
  r = await req('POST', '/task/api/agent/set-lane', {
    board: 'plain',
    taskId: 'p1',
    token: plainToken,
    lane: 'delta epsilon'
  })
  check('set-lane with a two-token lane → 200', r.status === 200, JSON.stringify(r.json))
  check(
    '…and set-lane also collapses to the last tag',
    (await plainTag()) === 'epsilon',
    `tag="${await plainTag()}"`
  )

  r = await req('POST', '/task/api/agent/release', {
    board: 'plain',
    taskId: 'p1',
    token: plainToken,
    lane: 'zeta eta'
  })
  check('release with a two-token lane → 200', r.status === 200, JSON.stringify(r.json))
  check(
    '…and release also collapses to the last tag',
    (await plainTag()) === 'eta',
    `tag="${await plainTag()}"`
  )
}
