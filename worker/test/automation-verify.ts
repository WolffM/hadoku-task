/**
 * T6 automation-board runtime verification (§5).
 *
 * Boots the REAL worker against a REAL SQLite D1 and drives it over HTTP + MCP.
 * Proves activation-as-migration and lane enforcement:
 *
 *   - dryRun previews the tag->lane migration + a digest and writes NOTHING;
 *   - a commit echoing the digest applies it: mapped tags kept, unmapped tags
 *     cleared to the Inbox with the original preserved in metadata;
 *   - a stale/bogus digest -> 409 DIGEST_MISMATCH;
 *   - the human path (HTTP PATCH + MCP update_task) may land a task only in a
 *     `user` lane: an `agent` lane -> 403 LANE_NOT_EDITABLE, a non-lane -> 422
 *     LANE_INVALID, clearing to Inbox is allowed;
 *   - the lane structure is locked: createTag/deleteTag/batchClearTag -> 409;
 *   - a bad lane set -> 422 LANE_SET_INVALID; activation is owner-only;
 *   - re-activation clears tasks in removed lanes to the Inbox;
 *   - deactivate restores the standard tag list;
 *   - an owner's committing activation auto-shares the board with the automation
 *     runner (resolved by registry NAME), proven functionally: the runner reads,
 *     claims and set-lanes a board nobody hand-shared. Idempotent, never escalates
 *     an owner's deliberate `readonly`, owner-only, and reports why when it can't;
 *   - connecting a repo shares the board with THAT repo's service key, derived by
 *     the `<repo minus "hadoku->-service-key` convention: owner segment dropped,
 *     trim case-insensitive, an unminted key can't cost the repo mapping, and
 *     clearing the repo neither grants nor revokes;
 *   - POST /boards/reconcile-shares backfills links made BEFORE the auto-grants
 *     existed (legacy rows written straight into D1): dry run by default, both the
 *     repo (GitHub-probed, stubbed here) and the key name verified before any
 *     grant, force repairs a sub-contributor share and names what it replaced,
 *     and re-running grants nothing new.
 *
 * Run via: pnpm run test:worker  (or `... automation-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')

function makeKV() {
  const store = new Map<string, string>()
  return {
    async get(key: string, type?: string) {
      const v = store.get(key)
      if (v === undefined) return null
      return type === 'json' ? JSON.parse(v) : v
    },
    async put(key: string, val: unknown) {
      store.set(key, typeof val === 'string' ? val : JSON.stringify(val))
    },
    async delete(key: string) {
      store.delete(key)
    }
  }
}

// Mock the read-only key registry: key:{rawKey} → { userId, name, tier }. `list` is
// needed as well as `get` because resolving a grantee by NAME (which is how the
// automation runner is found) scans the `key:` prefix.
function makeSessionsKV(
  entries: Record<string, { userId?: string; name?: string; tier?: string; retiredAt?: number }>
) {
  const store = new Map<string, string>()
  for (const [rawKey, rec] of Object.entries(entries)) {
    store.set(`key:${rawKey}`, JSON.stringify(rec))
  }
  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async list({ prefix }: { prefix: string } = { prefix: '' }) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }
    },
    async put() {},
    async delete() {}
  }
}

const d1: FakeD1 = makeSqliteD1(MIGRATION)

const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  SESSIONS_KV: makeSessionsKV({
    'contrib-key': { userId: 'contrib-uid' },
    // The automation runner's real prod identity (§7): the name auto-share resolves.
    'tenhands-key': { userId: 'tenhands-uid', name: 'tenhands-service-key', tier: 'service' },
    // The operator-side dev-vault caller shares the stem but must never be picked.
    'tenhands-devvault-key': { userId: 'devvault-uid', name: 'tenhands-devvault', tier: 'service' },
    // A repo's own service key, named by the convention
    // `<repo, minus a leading "hadoku-">-service-key` (§5.5).
    'aggregator-key': { userId: 'aggregator-uid', name: 'aggregator-service-key', tier: 'service' },
    // The real key for WolffM/hadoku_site — the one repo that spells the prefix
    // with an underscore, which a hyphen-only trim would fail to resolve.
    'site-key': { userId: 'site-uid', name: 'site-service-key', tier: 'service' }
  })
} as Record<string, unknown>

/**
 * Stub GitHub, so the reconcile's repo probe is deterministic and offline. Only
 * api.github.com is intercepted; `app.request()` doesn't route through global
 * fetch, so nothing else in the harness is affected.
 */
const GITHUB_KNOWN = new Set([
  'WolffM/hadoku-aggregator',
  'WolffM/hadoku_site',
  'WolffM/tenhands',
  'WolffM/hadoku-task'
])
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const m = url.match(/^https:\/\/api\.github\.com\/repos\/(.+)$/)
  if (!m) return realFetch(input as RequestInfo, init)
  const full = m[1]
  if (!GITHUB_KNOWN.has(full)) return new Response('{}', { status: 404 })
  return new Response(JSON.stringify({ full_name: full, private: true, default_branch: 'main' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}) as typeof fetch

const app = createTaskHandler()

interface User {
  key: string
  id: string
}
const OWNER: User = { key: 'owner-key', id: 'owner-uid' }
const CONTRIB: User = { key: 'contrib-key', id: 'contrib-uid' }
const RUNNER: User = { key: 'tenhands-key', id: 'tenhands-uid' }
const AGGREGATOR: User = { key: 'aggregator-key', id: 'aggregator-uid' }

interface Lane {
  tag: string
  label: string
  order: number
  editableBy: 'user' | 'agent'
  [k: string]: unknown
}
interface Body {
  tasks?: Array<{ id: string; tag?: string | null; metadata?: Record<string, unknown> | null }>
  boards?: Array<{
    id: string
    mode?: string
    lanes?: Lane[] | null
    tags?: string[]
    handle?: string
    // reconcile report rows reuse this field with a different shape
    boardId?: string
    grants?: Array<{
      kind: string
      name: string
      outcome: string
      previousLevel?: string
      reason?: string
    }>
  }>
  preview?: {
    digest: string
    toInbox: number
    mapping: Array<{ tag: string; count: number; lands: string }>
    collisions: string[]
  }
  applied?: { mode: string; laneCount: number; tasksToInbox: number }
  ok?: boolean
  token?: string
  mode?: string
  restoredTags?: string[]
  automationRunnerShare?: {
    granted: boolean
    name: string
    granteeUserId?: string
    reason?: string
  }
  repoServiceKeyShare?: { granted: boolean; name: string; reason?: string }
  dryRun?: boolean
  summary?: {
    boardsScanned: number
    boardsWithWork: number
    granted: number
    escalated: number
    alreadyShared: number
    skipped: number
  }
  serviceKeyShare?: { granted: boolean; name: string; granteeUserId?: string; reason?: string }
  repo?: string | null
  shares?: Array<{ granteeUserId: string; level: string; name: string | null }>
  code?: string
  error?: string
  structuredContent?: { boards?: Array<{ id: string; mode?: string; lanes?: Lane[] }> }
  isError?: boolean
  content?: { text: string }[]
}

async function req(
  user: User,
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
        'X-User-Key': user.key,
        'X-User-Id': user.id,
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
    /* non-json */
  }
  return { status: res.status, json }
}

async function mcp(
  user: User,
  tool: string,
  toolArgs: Record<string, unknown> = {}
): Promise<Body> {
  const res = await app.request(
    'http://localhost/task/api/mcp',
    {
      method: 'POST',
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': user.key,
        'X-User-Id': user.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: toolArgs }
      })
    },
    env
  )
  const b = (await res.json()) as { result?: Body }
  return b.result ?? {}
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

async function tasks(user: User, board: string) {
  const r = await req(user, 'GET', `/task/api/tasks?boardId=${encodeURIComponent(board)}`)
  return r.json?.tasks ?? []
}

const LANES: Lane[] = [
  { tag: 'needs-plan', label: 'Needs Plan', order: 1, editableBy: 'user' },
  { tag: 'working', label: 'Working', order: 2, editableBy: 'agent', tenhandsStage: 4 },
  { tag: 'review', label: 'Review', order: 3, editableBy: 'user' }
]

async function main() {
  console.log('T6 automation-board runtime verification')

  // ---------------------------------------------------------------------
  section('1. Owner sets up a standard board with mixed tags')
  // ---------------------------------------------------------------------
  await req(OWNER, 'POST', '/task/api/boards', { id: 'flow', name: 'Flow' })
  await req(OWNER, 'POST', '/task/api', {
    id: 't1',
    title: 'Has a lane tag',
    boardId: 'flow',
    tag: 'needs-plan'
  })
  await req(OWNER, 'POST', '/task/api', {
    id: 't2',
    title: 'Unmapped tag',
    boardId: 'flow',
    tag: 'random'
  })
  await req(OWNER, 'POST', '/task/api', { id: 't3', title: 'Untagged already', boardId: 'flow' })
  check('board starts with 3 tasks', (await tasks(OWNER, 'flow')).length === 3)

  // ---------------------------------------------------------------------
  section('2. dryRun previews the migration and writes nothing')
  // ---------------------------------------------------------------------
  let r = await req(OWNER, 'POST', '/task/api/boards/flow/activate-automation', {
    schemaId: 'tenhands',
    schemaVersion: 1,
    lanes: LANES,
    dryRun: true
  })
  check('dryRun → 200', r.status === 200, `status=${r.status}`)
  const digest = r.json?.preview?.digest
  check('preview carries a digest', !!digest, JSON.stringify(r.json?.preview))
  check(
    'preview: 1 task bound for the Inbox (the unmapped tag)',
    r.json?.preview?.toInbox === 1,
    JSON.stringify(r.json?.preview)
  )
  const mapRandom = r.json?.preview?.mapping.find(m => m.tag === 'random')
  check('preview: "random" lands in inbox', mapRandom?.lands === 'inbox')
  const mapPlan = r.json?.preview?.mapping.find(m => m.tag === 'needs-plan')
  check('preview: "needs-plan" lands in a lane', mapPlan?.lands === 'lane')
  // Nothing changed: still a standard board, t2 still tagged 'random'.
  let boards = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards ?? []
  check(
    'dryRun changed nothing — board still standard',
    boards.find(b => b.id === 'flow')?.mode === 'standard'
  )
  check(
    'dryRun changed nothing — t2 still tagged',
    (await tasks(OWNER, 'flow')).find(t => t.id === 't2')?.tag === 'random'
  )

  // ---------------------------------------------------------------------
  section('3. Commit with a stale/bogus digest is refused')
  // ---------------------------------------------------------------------
  r = await req(OWNER, 'POST', '/task/api/boards/flow/activate-automation', {
    schemaId: 'tenhands',
    schemaVersion: 1,
    lanes: LANES,
    digest: 'deadbeef'
  })
  check(
    'bogus digest → 409 DIGEST_MISMATCH',
    r.status === 409 && r.json?.code === 'DIGEST_MISMATCH',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // ---------------------------------------------------------------------
  section('4. Commit with the real digest applies the migration')
  // ---------------------------------------------------------------------
  r = await req(OWNER, 'POST', '/task/api/boards/flow/activate-automation', {
    schemaId: 'tenhands',
    schemaVersion: 1,
    lanes: LANES,
    digest
  })
  check('commit → 200', r.status === 200, JSON.stringify(r.json))
  check('applied: mode automation', r.json?.applied?.mode === 'automation')
  check('applied: 3 lanes', r.json?.applied?.laneCount === 3)
  const flowTasks = await tasks(OWNER, 'flow')
  check('t1 kept its lane tag', flowTasks.find(t => t.id === 't1')?.tag === 'needs-plan')
  const t2 = flowTasks.find(t => t.id === 't2')
  check('t2 cleared to Inbox (tag null)', !t2?.tag, JSON.stringify(t2))
  check(
    't2 preserved its original tag in metadata',
    t2?.metadata?.preAutomationTags === 'random',
    JSON.stringify(t2?.metadata)
  )

  // ---------------------------------------------------------------------
  section('5. GET /boards + MCP expose mode + lanes')
  // ---------------------------------------------------------------------
  boards = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards ?? []
  const flow = boards.find(b => b.id === 'flow')
  check('board mode is automation', flow?.mode === 'automation')
  check('board carries the 3 lanes', (flow?.lanes?.length ?? 0) === 3, JSON.stringify(flow?.lanes))
  check(
    'lane provider extras preserved verbatim',
    flow?.lanes?.find(l => l.tag === 'working')?.tenhandsStage === 4
  )
  const mcpBoards = (await mcp(OWNER, 'list_boards')).structuredContent?.boards ?? []
  check(
    'MCP list_boards shows automation mode + lanes',
    mcpBoards.find(b => b.id === 'flow')?.lanes?.length === 3
  )

  // ---------------------------------------------------------------------
  section('6. Human-path lane enforcement (§5.2)')
  // ---------------------------------------------------------------------
  // Into a USER lane → allowed.
  r = await req(OWNER, 'PATCH', '/task/api/t1?boardId=flow', { tag: 'review' })
  check('move into a user lane → 200', r.status === 200, JSON.stringify(r.json))
  // Into an AGENT lane → 403 LANE_NOT_EDITABLE.
  r = await req(OWNER, 'PATCH', '/task/api/t1?boardId=flow', { tag: 'working' })
  check(
    'move into an agent lane → 403 LANE_NOT_EDITABLE',
    r.status === 403 && r.json?.code === 'LANE_NOT_EDITABLE',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  // A non-lane free label → 422 LANE_INVALID.
  r = await req(OWNER, 'PATCH', '/task/api/t1?boardId=flow', { tag: 'whatever' })
  check(
    'move into a non-lane → 422 LANE_INVALID',
    r.status === 422 && r.json?.code === 'LANE_INVALID',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  // Clearing to Inbox (empty tag) → allowed.
  r = await req(OWNER, 'PATCH', '/task/api/t1?boardId=flow', { tag: '' })
  check('clear to Inbox → 200', r.status === 200, JSON.stringify(r.json))
  check('t1 is now in the Inbox', !(await tasks(OWNER, 'flow')).find(t => t.id === 't1')?.tag)
  // The agent lane wasn't reached — the enforced writes didn't apply.
  check(
    'agent-lane write did NOT apply',
    (await tasks(OWNER, 'flow')).find(t => t.id === 't1')?.tag !== 'working'
  )

  // Create straight into an agent lane → refused too.
  r = await req(OWNER, 'POST', '/task/api', {
    id: 't4',
    title: 'sneak',
    boardId: 'flow',
    tag: 'working'
  })
  check(
    'create into an agent lane → 403',
    r.status === 403 && r.json?.code === 'LANE_NOT_EDITABLE',
    `status=${r.status}`
  )
  check('the refused task was not created', !(await tasks(OWNER, 'flow')).find(t => t.id === 't4'))

  // MCP update_task is the human path too.
  const mUp = await mcp(OWNER, 'update_task', { id: 't2', board: 'flow', tag: 'working' })
  check(
    'MCP update into an agent lane → isError',
    mUp.isError === true,
    JSON.stringify(mUp.content)
  )
  const mOk = await mcp(OWNER, 'update_task', { id: 't2', board: 'flow', tag: 'review' })
  check('MCP update into a user lane → ok', !mOk.isError, JSON.stringify(mOk.content))

  // ---------------------------------------------------------------------
  section('7. The lane structure is locked (§5.2)')
  // ---------------------------------------------------------------------
  r = await req(OWNER, 'POST', '/task/api/tags', { boardId: 'flow', tag: 'sneaky' })
  check(
    'createTag on an automation board → 409 BOARD_SCHEMA_LOCKED',
    r.status === 409 && r.json?.code === 'BOARD_SCHEMA_LOCKED',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  r = await req(OWNER, 'POST', '/task/api/tags/delete', { boardId: 'flow', tag: 'review' })
  check(
    'deleteTag on an automation board → 409',
    r.status === 409 && r.json?.code === 'BOARD_SCHEMA_LOCKED',
    `status=${r.status}`
  )
  r = await req(OWNER, 'POST', '/task/api/batch-clear-tag', {
    boardId: 'flow',
    tag: 'review',
    taskIds: ['t2']
  })
  check(
    'batchClearTag on an automation board → 409',
    r.status === 409 && r.json?.code === 'BOARD_SCHEMA_LOCKED',
    `status=${r.status}`
  )

  // ---------------------------------------------------------------------
  section('8. Lane-set validation + owner-only activation')
  // ---------------------------------------------------------------------
  r = await req(OWNER, 'POST', '/task/api/boards/flow/activate-automation', {
    lanes: [
      { tag: 'a', label: 'A', order: 1, editableBy: 'user' },
      { tag: 'a', label: 'A2', order: 2, editableBy: 'user' }
    ],
    dryRun: true
  })
  check(
    'duplicate lane tags → 422 LANE_SET_INVALID',
    r.status === 422 && r.json?.code === 'LANE_SET_INVALID',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  r = await req(OWNER, 'POST', '/task/api/boards/flow/activate-automation', {
    lanes: [{ tag: 'a', label: 'A', order: 1, editableBy: 'nobody' }],
    dryRun: true
  })
  check(
    'bad editableBy → 422 LANE_SET_INVALID',
    r.status === 422 && r.json?.code === 'LANE_SET_INVALID',
    `status=${r.status}`
  )
  // A CONTRIBUTOR may upgrade the schema of an already-automated board, but only
  // when the new lane set strands nothing. That's what lets a provider ship a
  // version bump without a human; anything that would displace tasks still needs
  // the owner. Share the board, then drive it as the grantee (by handle).
  await req(OWNER, 'POST', '/task/api/boards/flow/shares', {
    key: 'contrib-key',
    level: 'contributor'
  })
  const flowHandle = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards?.find(
    b => b.id === 'flow'
  )?.handle

  // A dry run writes nothing, so a contributor may always run one — it is how
  // they discover whether the commit will be allowed.
  r = await req(CONTRIB, 'POST', `/task/api/boards/${flowHandle}/activate-automation`, {
    lanes: LANES,
    dryRun: true
  })
  check(
    'contributor CAN dry-run (writes nothing)',
    r.status === 200,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check('dry run reports it strands nothing', r.json?.preview?.toInbox === 0)

  // The upgrade case: same lanes, re-ordered + relabelled + a version bump.
  const UPGRADED: Lane[] = [
    { tag: 'needs-plan', label: 'Needs Plan v2', order: 0, editableBy: 'user' },
    { tag: 'working', label: 'Working v2', order: 1, editableBy: 'agent', tenhandsStage: 4 },
    { tag: 'review', label: 'Review v2', order: 2, editableBy: 'user' }
  ]
  r = await req(CONTRIB, 'POST', `/task/api/boards/${flowHandle}/activate-automation`, {
    lanes: UPGRADED,
    schemaId: 'flow-schema',
    schemaVersion: 2,
    dryRun: true
  })
  const upgradeDigest = r.json?.preview?.digest
  check('contributor upgrade previews cleanly', r.status === 200 && r.json?.preview?.toInbox === 0)
  r = await req(CONTRIB, 'POST', `/task/api/boards/${flowHandle}/activate-automation`, {
    lanes: UPGRADED,
    schemaId: 'flow-schema',
    schemaVersion: 2,
    digest: upgradeDigest
  })
  check(
    'contributor CAN commit an upgrade that strands nothing → 200',
    r.status === 200,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  const upgraded = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards?.find(
    b => b.id === 'flow'
  )
  check(
    'the upgrade applied (schemaVersion bumped)',
    upgraded?.schemaVersion === 2,
    JSON.stringify(upgraded?.schemaVersion)
  )
  check('lanes were relabelled', upgraded?.lanes?.[0]?.label === 'Needs Plan v2')

  // The destructive case stays owner-only: drop a lane that holds tasks.
  const DESTRUCTIVE: Lane[] = [
    { tag: 'needs-plan', label: 'Needs Plan', order: 0, editableBy: 'user' }
  ]
  r = await req(CONTRIB, 'POST', `/task/api/boards/${flowHandle}/activate-automation`, {
    lanes: DESTRUCTIVE,
    dryRun: true
  })
  const destructiveStrands = r.json?.preview?.toInbox
  check(
    'the destructive preview shows tasks would be stranded',
    destructiveStrands > 0,
    `toInbox=${destructiveStrands}`
  )
  r = await req(CONTRIB, 'POST', `/task/api/boards/${flowHandle}/activate-automation`, {
    lanes: DESTRUCTIVE,
    digest: r.json?.preview?.digest
  })
  check(
    'contributor CANNOT commit a lane set that strands tasks → 403',
    r.status === 403 && r.json?.code === 'FORBIDDEN',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check(
    'the refusal explains it needs the owner',
    /strand/i.test(String(r.json?.error)),
    JSON.stringify(r.json?.error)
  )
  const afterRefusal = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards?.find(
    b => b.id === 'flow'
  )
  check(
    'the refused activation wrote nothing',
    afterRefusal?.lanes?.length === 3,
    JSON.stringify(afterRefusal?.lanes?.length)
  )

  // ---------------------------------------------------------------------
  section('9. Re-activation clears tasks in removed lanes to the Inbox')
  // ---------------------------------------------------------------------
  // Put t2 in 'review', then re-activate WITHOUT 'review'. t2 must fall to Inbox.
  await req(OWNER, 'PATCH', '/task/api/t2?boardId=flow', { tag: 'review' })
  check(
    't2 parked in review',
    (await tasks(OWNER, 'flow')).find(t => t.id === 't2')?.tag === 'review'
  )
  const NEW_LANES: Lane[] = [
    { tag: 'needs-plan', label: 'Needs Plan', order: 1, editableBy: 'user' },
    { tag: 'working', label: 'Working', order: 2, editableBy: 'agent' }
  ]
  const pv = await req(OWNER, 'POST', '/task/api/boards/flow/activate-automation', {
    lanes: NEW_LANES,
    schemaId: 'tenhands',
    schemaVersion: 2,
    dryRun: true
  })
  const d2 = pv.json?.preview?.digest
  r = await req(OWNER, 'POST', '/task/api/boards/flow/activate-automation', {
    lanes: NEW_LANES,
    schemaId: 'tenhands',
    schemaVersion: 2,
    digest: d2
  })
  check('re-activation → 200', r.status === 200, JSON.stringify(r.json))
  check(
    't2 cleared from the removed "review" lane to Inbox',
    !(await tasks(OWNER, 'flow')).find(t => t.id === 't2')?.tag
  )
  const flow2 = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards?.find(
    b => b.id === 'flow'
  )
  check('board now has 2 lanes', flow2?.lanes?.length === 2)

  // ---------------------------------------------------------------------
  section('10. Deactivate restores the standard tag list')
  // ---------------------------------------------------------------------
  r = await req(OWNER, 'POST', '/task/api/boards/flow/deactivate-automation')
  check('deactivate → 200', r.status === 200, JSON.stringify(r.json))
  check('mode back to standard', r.json?.mode === 'standard')
  const flow3 = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards?.find(
    b => b.id === 'flow'
  )
  check('board mode is standard again', flow3?.mode === 'standard')
  check('lanes cleared', !flow3?.lanes || flow3.lanes.length === 0, JSON.stringify(flow3?.lanes))
  // Now the schema lock is lifted — a createTag succeeds again.
  r = await req(OWNER, 'POST', '/task/api/tags', { boardId: 'flow', tag: 'freeform-again' })
  check(
    'createTag works again after deactivate',
    r.status === 200,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // ---------------------------------------------------------------------
  section('11. POST /boards/{ref}/repo — the board → checkout mapping (§5.5)')
  // ---------------------------------------------------------------------
  // This route was a plain app.post (absent from the OpenAPI spec) with no test
  // at all until it was converted to createRoute. These lock in the behaviour
  // the conversion had to preserve.
  const repoOf = async (id: string) =>
    (await req(OWNER, 'GET', '/task/api/boards')).json?.boards?.find(b => b.id === id)?.repo

  r = await req(OWNER, 'POST', '/task/api/boards/flow/repo', { repo: 'WolffM/hadoku-task' })
  check('owner sets repo → 200', r.status === 200, `status=${r.status} ${JSON.stringify(r.json)}`)
  check('response echoes the repo', r.json?.repo === 'WolffM/hadoku-task', JSON.stringify(r.json))
  check('repo persisted on the board', (await repoOf('flow')) === 'WolffM/hadoku-task')

  // Surrounding whitespace is trimmed, not stored.
  r = await req(OWNER, 'POST', '/task/api/boards/flow/repo', { repo: '  WolffM/other  ' })
  check('repo is trimmed', (await repoOf('flow')) === 'WolffM/other', String(await repoOf('flow')))

  // Blank clears it — that's how the UI clears, by emptying the field on blur.
  r = await req(OWNER, 'POST', '/task/api/boards/flow/repo', { repo: '' })
  check('empty string → 200', r.status === 200, `status=${r.status}`)
  check(
    'empty string CLEARS the repo (null, not "")',
    (await repoOf('flow')) === null,
    JSON.stringify(await repoOf('flow'))
  )

  // Explicit null clears too.
  await req(OWNER, 'POST', '/task/api/boards/flow/repo', { repo: 'WolffM/hadoku-task' })
  r = await req(OWNER, 'POST', '/task/api/boards/flow/repo', { repo: null })
  check(
    'null → 200 and clears',
    r.status === 200 && (await repoOf('flow')) === null,
    `status=${r.status} repo=${JSON.stringify(await repoOf('flow'))}`
  )

  // Owner-only: a contributor drives work through a board, it can't remap one.
  r = await req(CONTRIB, 'POST', `/task/api/boards/${flowHandle}/repo`, { repo: 'evil/repo' })
  check(
    'contributor setting repo → 403 FORBIDDEN',
    r.status === 403 && r.json?.code === 'FORBIDDEN',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check('the refused write changed nothing', (await repoOf('flow')) === null)

  r = await req(OWNER, 'POST', '/task/api/boards/no-such-board/repo', { repo: 'a/b' })
  check(
    'unknown board → 404 BOARD_NOT_FOUND',
    r.status === 404 && r.json?.code === 'BOARD_NOT_FOUND',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

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

  // A standard board with no repo is not "work" — it must not appear in the report.
  check(
    'boards with no link at all are left out of the report entirely',
    !r.json?.boards?.some(b => b.boardId === 'plain-none'),
    JSON.stringify(r.json?.boards?.map(b => b.boardId))
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
