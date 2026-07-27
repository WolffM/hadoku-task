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
 *   - deactivate restores the standard tag list.
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

const d1: FakeD1 = makeSqliteD1(MIGRATION)

const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  SESSIONS_KV: {
    async get(key: string) {
      return key === 'key:contrib-key' ? JSON.stringify({ userId: 'contrib-uid' }) : null
    },
    async put() {},
    async delete() {}
  }
} as Record<string, unknown>

const app = createTaskHandler()

interface User {
  key: string
  id: string
}
const OWNER: User = { key: 'owner-key', id: 'owner-uid' }
const CONTRIB: User = { key: 'contrib-key', id: 'contrib-uid' }

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
  }>
  preview?: {
    digest: string
    toInbox: number
    mapping: Array<{ tag: string; count: number; lands: string }>
    collisions: string[]
  }
  applied?: { mode: string; laneCount: number; tasksToInbox: number }
  ok?: boolean
  mode?: string
  restoredTags?: string[]
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

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
