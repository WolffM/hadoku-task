/**
 * Batch task create runtime verification.
 *
 * `POST /boards/{boardId}/tasks/batch` exists so an integrator putting a list on
 * a board (whattocook: one task per ingredient) pays ONE board read-modify-write
 * instead of one per task. This boots the REAL worker against a REAL SQLite DB
 * built from the prod migrations, with a mocked key registry for sharing, and
 * proves over HTTP that:
 *
 *   - a batch lands every item as the task POST / would have made (tag
 *     collapse, date derivation), returns ids in request order + the new
 *     version as body and ETag, keeps request order under age sorting, and
 *     logs one 'created' event per task
 *   - it is all-or-nothing: a bad item (schema, notes size, duplicate id, over
 *     the cap) writes no task and no event
 *   - a duplicate source/sourceId — inside the batch, against a live task on
 *     the same board, or against one on ANOTHER board (caught by the unique
 *     index) — is a clean 409 DUPLICATE_SOURCE naming the sourceId, never a 500,
 *     and POST / now answers the same way
 *   - sharing is honoured: a contributor writes by handle into the owner's
 *     board, a readonly grantee is refused, a stranger's handle is a 404
 *   - a stale If-Match is a 409 VERSION_CONFLICT
 *
 * Assertions read SQLite directly, so they prove what was PERSISTED.
 *
 * Run via: pnpm run test:worker  (or `... batch-create-verify`).
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

// The read-only key registry sharing resolves grantees through.
function makeSessionsKV(entries: Record<string, { userId: string; name?: string; tier?: string }>) {
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
  TASK_STORAGE_PRUNE_KV: '1',
  SESSIONS_KV: makeSessionsKV({
    'contrib-key': { userId: 'contrib-uid', name: 'Helper', tier: 'friend' },
    'reader-key': { userId: 'reader-uid', name: 'Reader', tier: 'friend' }
  })
} as Record<string, unknown>

const app = createTaskHandler()

interface User {
  key: string
  id: string
}
const OWNER: User = { key: 'owner-key', id: 'owner-uid' }
const CONTRIB: User = { key: 'contrib-key', id: 'contrib-uid' }
const READER: User = { key: 'reader-key', id: 'reader-uid' }
const STRANGER: User = { key: 'stranger-key', id: 'stranger-uid' }

interface Body {
  ok?: boolean
  ids?: string[]
  version?: number
  code?: string
  error?: string
  source?: string
  sourceId?: string
  taskId?: string
  currentVersion?: number
  boards?: Array<{ id: string; handle?: string }>
}

async function req(
  user: User,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; json: Body | null; etag: string | null }> {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': user.key,
        'X-User-Id': user.id,
        'Content-Type': 'application/json',
        ...extraHeaders
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
  return { status: res.status, json, etag: res.headers.get('ETag') }
}

interface Row {
  id: string
  board_id: string
  tag: string | null
  date: string | null
  state: string
  created_at: string
  source: string | null
  source_id: string | null
}
function rows(userId: string): Row[] {
  return d1.__raw
    .prepare(
      'SELECT id, board_id, tag, date, state, created_at, source, source_id FROM tasks WHERE user_id = ?'
    )
    .all(userId) as unknown as Row[]
}
function row(userId: string, id: string): Row | undefined {
  return rows(userId).find(r => r.id === id)
}
function createdEvents(): Map<string, number> {
  const all = d1.__raw
    .prepare("SELECT task_id FROM task_events WHERE event_type = 'created'")
    .all() as Array<{ task_id: string }>
  const n = new Map<string, number>()
  for (const r of all) n.set(r.task_id, (n.get(r.task_id) ?? 0) + 1)
  return n
}
function eventCount(): number {
  return (d1.__raw.prepare('SELECT COUNT(*) AS n FROM task_events').get() as { n: number }).n
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

const BATCH = '/task/api/boards/main/tasks/batch'

/** Nothing landed: same rows, same events as the snapshot. */
function assertNothingWritten(label: string, before: { rows: number; events: number }) {
  check(
    `${label}: no task written`,
    rows(OWNER.id).length === before.rows,
    `rows=${rows(OWNER.id).length}`
  )
  check(`${label}: no event logged`, eventCount() === before.events, `events=${eventCount()}`)
}
function snapshot() {
  return { rows: rows(OWNER.id).length, events: eventCount() }
}

async function main() {
  console.log('Batch task create runtime verification')

  // ---------------------------------------------------------------------
  section('1. a batch lands every item, in order, in one write')
  // ---------------------------------------------------------------------
  // A board version to compare against: one ordinary create first.
  let r = await req(OWNER, 'POST', '/task/api', { id: 'pre-1', title: 'Before the batch' })
  check('single create → 200', r.status === 200, JSON.stringify(r.json))
  const versionBefore = r.json?.version as number

  r = await req(OWNER, 'POST', BATCH, {
    tasks: [
      {
        id: 'b-1',
        title: 'Flour',
        tag: 'groceries baking',
        source: 'whattocook',
        sourceId: 'r1:flour'
      },
      {
        id: 'b-2',
        title: 'Eggs',
        startTime: '2026-11-02T09:00:00.000Z',
        source: 'whattocook',
        sourceId: 'r1:eggs'
      },
      { id: 'b-3', title: 'Butter', notes: '## unsalted', board: 'ignored-board' }
    ]
  })
  check('batch → 200', r.status === 200, JSON.stringify(r.json))
  check('ok: true', r.json?.ok === true)
  check(
    'ids in request order',
    JSON.stringify(r.json?.ids) === JSON.stringify(['b-1', 'b-2', 'b-3']),
    JSON.stringify(r.json?.ids)
  )
  check(
    'ONE write: version advanced by exactly one',
    r.json?.version === versionBefore + 1,
    `before=${versionBefore} after=${r.json?.version}`
  )
  check('ETag carries the version', r.etag === `"${r.json?.version}"`, `etag=${r.etag}`)
  check(
    'multi-token tag collapses like POST /',
    row(OWNER.id, 'b-1')?.tag === 'baking',
    `tag=${row(OWNER.id, 'b-1')?.tag}`
  )
  check(
    'date derived from startTime like POST /',
    row(OWNER.id, 'b-2')?.date === '2026-11-02',
    `date=${row(OWNER.id, 'b-2')?.date}`
  )
  check(
    'an item board ref is ignored: the path names the board',
    row(OWNER.id, 'b-3')?.board_id === 'main',
    `board=${row(OWNER.id, 'b-3')?.board_id}`
  )
  check('source/sourceId stored', row(OWNER.id, 'b-1')?.source_id === 'r1:flour')
  const ages = ['b-1', 'b-2', 'b-3'].map(id => row(OWNER.id, id)?.created_at ?? '')
  check(
    'createdAt strictly ascending in request order (age sort keeps it)',
    ages[0] < ages[1] && ages[1] < ages[2],
    JSON.stringify(ages)
  )
  const ev = createdEvents()
  check(
    "one 'created' event per task",
    ['b-1', 'b-2', 'b-3'].every(id => ev.get(id) === 1),
    JSON.stringify([...ev])
  )
  check("the earlier single create still has exactly one 'created' event", ev.get('pre-1') === 1)

  const listed = await req(OWNER, 'GET', '/task/api/tasks?board=main')
  const listedIds = ((listed.json as { tasks?: Array<{ id: string }> })?.tasks ?? []).map(t => t.id)
  check(
    'GET /tasks returns all four',
    ['pre-1', 'b-1', 'b-2', 'b-3'].every(id => listedIds.includes(id)),
    JSON.stringify(listedIds)
  )

  // ---------------------------------------------------------------------
  section('2. all-or-nothing: a bad item writes nothing')
  // ---------------------------------------------------------------------
  let before = snapshot()
  r = await req(OWNER, 'POST', BATCH, {
    tasks: [{ id: 'x-1', title: 'Fine' }, { id: 'x-2' }]
  })
  check('item missing its title → 400', r.status === 400, `status=${r.status}`)
  assertNothingWritten('missing title', before)

  before = snapshot()
  r = await req(OWNER, 'POST', BATCH, {
    tasks: [
      { id: 'x-3', title: 'Fine' },
      { id: 'x-4', title: 'Huge', notes: 'x'.repeat(64 * 1024 + 1) }
    ]
  })
  check('item notes over the limit → 413', r.status === 413, `status=${r.status}`)
  check('413 code NOTES_TOO_LARGE', r.json?.code === 'NOTES_TOO_LARGE', JSON.stringify(r.json))
  assertNothingWritten('oversized notes', before)

  before = snapshot()
  r = await req(OWNER, 'POST', BATCH, {
    tasks: [
      { id: 'x-5', title: 'One' },
      { id: 'x-5', title: 'Same id' }
    ]
  })
  check('duplicate id within the batch → 400', r.status === 400, `status=${r.status}`)
  assertNothingWritten('duplicate id', before)

  r = await req(OWNER, 'POST', BATCH, { tasks: [] })
  check('empty batch → 400', r.status === 400, `status=${r.status}`)
  r = await req(OWNER, 'POST', BATCH, {
    tasks: Array.from({ length: 101 }, (_, i) => ({ id: `cap-${i}`, title: `t${i}` }))
  })
  check('101 items (over the cap) → 400', r.status === 400, `status=${r.status}`)
  assertNothingWritten('empty / over cap', before)

  // ---------------------------------------------------------------------
  section('3. a duplicate source/sourceId is a clean 409 naming it')
  // ---------------------------------------------------------------------
  before = snapshot()
  r = await req(OWNER, 'POST', BATCH, {
    tasks: [
      { id: 'd-1', title: 'Milk', source: 'whattocook', sourceId: 'r2:milk' },
      { id: 'd-2', title: 'Milk again', source: 'whattocook', sourceId: 'r2:milk' }
    ]
  })
  check('two items share a sourceId → 409', r.status === 409, `status=${r.status}`)
  check('code DUPLICATE_SOURCE', r.json?.code === 'DUPLICATE_SOURCE', JSON.stringify(r.json))
  check(
    'names the sourceId',
    r.json?.sourceId === 'r2:milk' && (r.json?.error ?? '').includes('r2:milk'),
    JSON.stringify(r.json)
  )
  check(
    'no holder task for an in-batch clash',
    r.json?.taskId === undefined,
    JSON.stringify(r.json)
  )
  assertNothingWritten('in-batch clash', before)

  before = snapshot()
  r = await req(OWNER, 'POST', BATCH, {
    tasks: [
      { id: 'd-3', title: 'New thing', source: 'whattocook', sourceId: 'r9:new' },
      { id: 'd-4', title: 'Flour again', source: 'whattocook', sourceId: 'r1:flour' }
    ]
  })
  check('clash with a live task on the same board → 409', r.status === 409, `status=${r.status}`)
  check('code DUPLICATE_SOURCE', r.json?.code === 'DUPLICATE_SOURCE', JSON.stringify(r.json))
  check(
    'names the sourceId and the holder',
    r.json?.sourceId === 'r1:flour' && r.json?.taskId === 'b-1',
    JSON.stringify(r.json)
  )
  assertNothingWritten('same-board clash', before)

  // A live task on ANOTHER board holds a pair: only the unique index sees that.
  await req(OWNER, 'POST', '/task/api/boards', { id: 'pantry', name: 'Pantry' })
  r = await req(OWNER, 'POST', '/task/api', {
    id: 'p-1',
    title: 'Salt',
    board: 'pantry',
    source: 'whattocook',
    sourceId: 'r3:salt'
  })
  check('setup: sourced task on another board → 200', r.status === 200, JSON.stringify(r.json))
  before = snapshot()
  r = await req(OWNER, 'POST', BATCH, {
    tasks: [
      { id: 'd-5', title: 'Pepper', source: 'whattocook', sourceId: 'r3:pepper' },
      { id: 'd-6', title: 'Salt', source: 'whattocook', sourceId: 'r3:salt' }
    ]
  })
  check(
    'clash with a live task on another board → 409 (not 500)',
    r.status === 409,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check('code DUPLICATE_SOURCE', r.json?.code === 'DUPLICATE_SOURCE', JSON.stringify(r.json))
  check(
    'names the sourceId and the holder',
    r.json?.sourceId === 'r3:salt' && r.json?.taskId === 'p-1',
    JSON.stringify(r.json)
  )
  assertNothingWritten('cross-board clash', before)

  before = snapshot()
  r = await req(OWNER, 'POST', '/task/api', {
    id: 'd-7',
    title: 'Salt via POST /',
    source: 'whattocook',
    sourceId: 'r3:salt'
  })
  check(
    'POST / cross-board clash → 409 (was a bare 500)',
    r.status === 409,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  check(
    'POST / names the sourceId',
    r.json?.code === 'DUPLICATE_SOURCE' && r.json?.sourceId === 'r3:salt',
    JSON.stringify(r.json)
  )
  assertNothingWritten('POST / clash', before)

  r = await req(OWNER, 'POST', '/task/api', {
    id: 'b-1',
    title: 'Flour (retried)',
    source: 'whattocook',
    sourceId: 'r1:flour'
  })
  check(
    're-sending a task under its own id still succeeds',
    r.status === 200,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // Only LIVE tasks hold a pair: once b-2 is completed its sourceId is free.
  await req(OWNER, 'POST', '/task/api/b-2/complete?board=main')
  r = await req(OWNER, 'POST', BATCH, {
    tasks: [{ id: 'd-8', title: 'Eggs, next week', source: 'whattocook', sourceId: 'r1:eggs' }]
  })
  check(
    'a completed task does not hold its sourceId',
    r.status === 200,
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // ---------------------------------------------------------------------
  section('4. sharing: contributor writes, readonly refused, stranger 404')
  // ---------------------------------------------------------------------
  const ownerBoards = (await req(OWNER, 'GET', '/task/api/boards')).json?.boards ?? []
  const handle = ownerBoards.find(b => b.id === 'pantry')?.handle as string
  check('pantry has a handle', !!handle, JSON.stringify(ownerBoards))
  r = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    key: 'contrib-key',
    level: 'contributor'
  })
  check('grant contributor → 200', r.status === 200, JSON.stringify(r.json))
  r = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    key: 'reader-key',
    level: 'readonly'
  })
  check('grant readonly → 200', r.status === 200, JSON.stringify(r.json))

  r = await req(CONTRIB, 'POST', `/task/api/boards/${handle}/tasks/batch`, {
    tasks: [
      { id: 'c-1', title: 'Rice' },
      { id: 'c-2', title: 'Beans' }
    ]
  })
  check('contributor batch by handle → 200', r.status === 200, JSON.stringify(r.json))
  check(
    "contributor's tasks landed on the OWNER's board",
    row(OWNER.id, 'c-1')?.board_id === 'pantry' && row(OWNER.id, 'c-2')?.board_id === 'pantry',
    JSON.stringify([row(OWNER.id, 'c-1'), row(OWNER.id, 'c-2')])
  )
  check('nothing landed in the contributor namespace', rows(CONTRIB.id).length === 0)

  before = snapshot()
  r = await req(READER, 'POST', `/task/api/boards/${handle}/tasks/batch`, {
    tasks: [{ id: 'r-1', title: 'Refused' }]
  })
  check('readonly grantee → 403', r.status === 403, `status=${r.status}`)
  check('code FORBIDDEN', r.json?.code === 'FORBIDDEN', JSON.stringify(r.json))
  assertNothingWritten('readonly', before)

  r = await req(STRANGER, 'POST', `/task/api/boards/${handle}/tasks/batch`, {
    tasks: [{ id: 's-1', title: 'Refused' }]
  })
  check('stranger by handle → 404', r.status === 404, `status=${r.status}`)
  check('stranger wrote nothing anywhere', !row(OWNER.id, 's-1') && rows(STRANGER.id).length === 0)

  // ---------------------------------------------------------------------
  section('5. If-Match')
  // ---------------------------------------------------------------------
  before = snapshot()
  r = await req(
    OWNER,
    'POST',
    BATCH,
    { tasks: [{ id: 'v-1', title: 'Stale' }] },
    { 'If-Match': '"1"' }
  )
  check('stale If-Match → 409', r.status === 409, `status=${r.status}`)
  check('code VERSION_CONFLICT', r.json?.code === 'VERSION_CONFLICT', JSON.stringify(r.json))
  assertNothingWritten('stale If-Match', before)

  const current = Number((await req(OWNER, 'GET', '/task/api/tasks?board=main')).json?.version)
  r = await req(
    OWNER,
    'POST',
    BATCH,
    { tasks: [{ id: 'v-2', title: 'Fresh' }] },
    { 'If-Match': `"${current}"` }
  )
  check('current If-Match → 200', r.status === 200, `status=${r.status} ${JSON.stringify(r.json)}`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
