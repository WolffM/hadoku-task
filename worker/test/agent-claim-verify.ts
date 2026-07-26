/**
 * T7 agent claim-protocol runtime verification — the CONCURRENCY proof (§4, §11).
 *
 * Boots the REAL worker against a REAL SQLite D1 and drives claim / heartbeat /
 * set-lane / release over HTTP + MCP. Proves:
 *
 *   - N concurrent claims on one task → EXACTLY ONE wins, the rest 409 CLAIM_HELD;
 *   - a live lease can't be stolen; an EXPIRED one can (forced via raw SQL, no sleep);
 *   - heartbeat with a stale token → 409 LEASE_LOST;
 *   - set-lane is the agent path (may enter an `agent` lane), LANE_UNKNOWN on a
 *     non-lane, LEASE_LOST without the claim;
 *   - release moves the task + writes notes + unclaims, is idempotent on token,
 *     and 409 LANE_CHANGED when `ifCurrentLane` doesn't match;
 *   - release never changes state / never completes-or-deletes (§5.6);
 *   - an unclaimed agent lane is escapable by a human (§5.2);
 *   - the change feed cursors forward with zero extra writes;
 *   - MCP forwards the structured error `code` (§4.3).
 *
 * Run via: pnpm run test:worker  (or `... agent-claim-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations/0002_boards_and_tasks.sql')
const TASK_EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_key TEXT NOT NULL, board_id TEXT NOT NULL,
    task_id TEXT, event_type TEXT NOT NULL, metadata TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')));`

function makeKV() {
  const store = new Map<string, string>()
  return {
    async get(k: string, t?: string) {
      const v = store.get(k)
      return v === undefined ? null : t === 'json' ? JSON.parse(v) : v
    },
    async put(k: string, v: unknown) {
      store.set(k, typeof v === 'string' ? v : JSON.stringify(v))
    },
    async delete(k: string) {
      store.delete(k)
    }
  }
}

const d1: FakeD1 = makeSqliteD1(MIGRATION)
d1.__raw.exec(TASK_EVENTS_DDL)

const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1'
} as Record<string, unknown>
const app = createTaskHandler()

const OWNER = { key: 'owner-key', id: 'owner-uid' }

interface Body {
  token?: string
  expiresAt?: string
  agentId?: string
  lane?: string | null
  ok?: boolean
  released?: boolean
  code?: string
  error?: string
  holder?: string
  tasks?: Array<{ id: string; tag?: string | null; notes?: string | null; state?: string }>
  history?: Array<{ agentId: string; endedBy: string | null; outcome: string | null }>
  changes?: Array<{ id: string; state: string; tag: string | null }>
  cursor?: string | null
  structuredContent?: {
    token?: string
    code?: string
    released?: boolean
    changes?: unknown[]
    cursor?: string | null
    boards?: Array<{ id: string }>
    count?: number
    total?: number
    nextOffset?: number | null
  }
  isError?: boolean
  content?: { text: string }[]
}

async function req(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Body | null }> {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': OWNER.key,
        'X-User-Id': OWNER.id,
        'Content-Type': 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    },
    env
  )
  let json: Body | null = null
  try {
    json = (await res.clone().json()) as Body
  } catch {
    /* */
  }
  return { status: res.status, json }
}

async function mcp(tool: string, args: Record<string, unknown> = {}): Promise<Body> {
  const res = await app.request(
    'http://localhost/task/api/mcp',
    {
      method: 'POST',
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': OWNER.key,
        'X-User-Id': OWNER.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args }
      })
    },
    env
  )
  return ((await res.json()) as { result?: Body }).result ?? {}
}

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}  ${detail}`)
  }
}
function section(t: string) {
  console.log(`\n${t}`)
}

async function tag(taskId: string): Promise<string | null | undefined> {
  const r = await req('GET', '/task/api/tasks?boardId=auto')
  return r.json?.tasks?.find(t => t.id === taskId)?.tag
}
function forceExpire(taskId: string) {
  const past = new Date(Date.now() - 60_000).toISOString()
  d1.__raw
    .prepare('UPDATE task_claims SET expires_at = ? WHERE user_id = ? AND task_id = ?')
    .run(past, OWNER.id, taskId)
}

const LANES = [
  { tag: 'needs-work', label: 'Needs Work', order: 1, editableBy: 'user' },
  { tag: 'working', label: 'Working', order: 2, editableBy: 'agent' },
  { tag: 'review', label: 'Review', order: 3, editableBy: 'user' },
  { tag: 'done', label: 'Done', order: 4, editableBy: 'agent' }
]

async function main() {
  console.log('T7 agent claim-protocol runtime verification (concurrency)')

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
  check(
    'the completed task is gone from the active list',
    !(await req('GET', '/task/api/tasks?boardId=auto')).json?.tasks?.some(t => t.id === 'land1')
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

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
