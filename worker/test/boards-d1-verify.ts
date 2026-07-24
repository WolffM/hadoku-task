/**
 * T1 D1-storage runtime verification.
 *
 * Boots the REAL worker (createTaskHandler) with TASK_STORAGE=d1, backed by a
 * REAL SQLite database (node:sqlite) loaded from the SAME migration SQL that
 * ships to prod. Proves the three things typecheck/lint/build cannot:
 *
 *   A. The KV→D1 storage swap preserves task optimistic-concurrency byte-for-byte
 *      (the phase0 contract still holds through D1).
 *   B. Lazy read-repair: a user whose data is in KV is migrated into D1 on first
 *      read, the rows land field-for-field, and the KV entries are deleted.
 *   C. Board create/delete round-trips through D1.
 *
 * Run via: pnpm run test:worker  (or `... boards-d1-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { boardsKey, tasksKey } from '../src/kv-keys'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations/0002_boards_and_tasks.sql')

function makeKV() {
  const store = new Map<string, string>()
  return {
    kv: {
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
    },
    store
  }
}

// task_events predates the migration files (created manually in prod via
// `wrangler d1 execute`; migration 0001 only mutates it). The stats path reads
// it on every board read, so the harness DB must have it — empty is enough,
// this suite doesn't assert on stats.
const TASK_EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS task_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key   TEXT NOT NULL,
    board_id   TEXT NOT NULL,
    task_id    TEXT,
    event_type TEXT NOT NULL,
    metadata   TEXT,
    timestamp  TEXT NOT NULL DEFAULT (datetime('now'))
  );`

function makeEnv() {
  const { kv, store } = makeKV()
  const d1: FakeD1 = makeSqliteD1(MIGRATION)
  d1.__raw.exec(TASK_EVENTS_DDL)
  const env = { TASKS_KV: kv, DB: d1, EDGE_AUTH_SECRET: EDGE_SECRET, TASK_STORAGE: 'd1' }
  return { env, kvStore: store, d1 }
}

const app = createTaskHandler()

function headers(userKey: string, extra: Record<string, string> = {}) {
  return {
    'X-Edge-Auth': EDGE_SECRET,
    'X-Hadoku-Tier': 'friend',
    'X-User-Key': userKey,
    'Content-Type': 'application/json',
    ...extra
  }
}

interface ResponseBody {
  version?: number
  currentVersion?: number
  code?: string
  tasks?: Array<{ id: string; title: string; tag?: string | null }>
  boards?: Array<{ id: string; name: string; tasks?: unknown[] }>
}

async function req(
  env: unknown,
  method: string,
  path: string,
  opts: { body?: unknown; userKey?: string; headers?: Record<string, string> } = {}
) {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: headers(opts.userKey ?? 'sess-test-123', opts.headers),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    },
    env
  )
  let json: ResponseBody | null = null
  try {
    json = await res.clone().json()
  } catch {
    /* non-json */
  }
  return { status: res.status, etag: res.headers.get('ETag'), json }
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

/** Count rows in a table for a user, straight from SQLite. */
function rowCount(d1: FakeD1, sql: string, ...args: unknown[]): number {
  const row = d1.__raw.prepare(sql).get(...(args as never[])) as { n: number } | undefined
  return row ? Number(row.n) : 0
}

async function sectionA_taskOCC() {
  console.log('\nA. Task optimistic-concurrency through D1')
  const { env } = makeEnv()

  let r = await req(env, 'GET', '/task/api/tasks')
  check('GET empty board → 200', r.status === 200, `status=${r.status}`)
  check('GET returns version 1', r.json?.version === 1, `version=${r.json?.version}`)
  check('GET sets ETag "1"', r.etag === '"1"', `etag=${r.etag}`)

  r = await req(env, 'DELETE', '/task/api/does-not-exist')
  check('DELETE missing → 404 (not 500)', r.status === 404, `status=${r.status}`)
  check(
    'DELETE missing → TASK_NOT_FOUND',
    r.json?.code === 'TASK_NOT_FOUND',
    JSON.stringify(r.json)
  )

  r = await req(env, 'POST', '/task/api', { body: { id: 't1', title: 'first task' } })
  check('create (no If-Match) → 200', r.status === 200, `status=${r.status}`)
  check('create → version 2', r.json?.version === 2, `version=${r.json?.version}`)
  check('create sets ETag "2"', r.etag === '"2"', `etag=${r.etag}`)

  r = await req(env, 'GET', '/task/api/tasks')
  check('GET shows 1 task', r.json?.tasks?.length === 1, `len=${r.json?.tasks?.length}`)
  check('GET version now 2', r.json?.version === 2, `version=${r.json?.version}`)

  r = await req(env, 'POST', '/task/api', {
    body: { id: 't2', title: 'second' },
    headers: { 'If-Match': '"1"' }
  })
  check('stale If-Match → 409', r.status === 409, `status=${r.status}`)
  check('409 → VERSION_CONFLICT', r.json?.code === 'VERSION_CONFLICT', JSON.stringify(r.json))
  check('409 → currentVersion 2', r.json?.currentVersion === 2, `cv=${r.json?.currentVersion}`)

  r = await req(env, 'GET', '/task/api/tasks')
  check(
    'stale write rejected (1 task, v2)',
    r.json?.tasks?.length === 1 && r.json?.version === 2,
    `len=${r.json?.tasks?.length} v=${r.json?.version}`
  )

  r = await req(env, 'POST', '/task/api', {
    body: { id: 't2', title: 'second' },
    headers: { 'If-Match': '2' }
  })
  check(
    'correct If-Match → 200 version 3',
    r.status === 200 && r.json?.version === 3,
    `v=${r.json?.version}`
  )

  r = await req(env, 'PATCH', '/task/api/t1', {
    body: { title: 'renamed' },
    headers: { 'If-Match': '3' }
  })
  check(
    'patch (If-Match 3) → version 4',
    r.status === 200 && r.json?.version === 4,
    `v=${r.json?.version}`
  )

  r = await req(env, 'GET', '/task/api/tasks')
  const renamed = r.json?.tasks?.find(t => t.id === 't1')
  check('patch persisted title', renamed?.title === 'renamed', JSON.stringify(renamed))

  r = await req(env, 'POST', '/task/api/t1/complete', { headers: { 'If-Match': '4' } })
  check(
    'complete (If-Match 4) → version 5',
    r.status === 200 && r.json?.version === 5,
    `v=${r.json?.version}`
  )

  r = await req(env, 'GET', '/task/api/tasks')
  check(
    'completed task left active list',
    r.json?.tasks?.length === 1,
    `len=${r.json?.tasks?.length}`
  )

  r = await req(env, 'DELETE', '/task/api/t2', { headers: { 'If-Match': '5' } })
  check(
    'delete active (If-Match 5) → version 6',
    r.status === 200 && r.json?.version === 6,
    `v=${r.json?.version}`
  )

  r = await req(env, 'DELETE', '/task/api/t1', { headers: { 'If-Match': '1' } })
  check('delete stale If-Match → 409', r.status === 409, `status=${r.status}`)
}

async function sectionB_migration() {
  console.log('\nB. Lazy KV→D1 read-repair')
  const { env, kvStore, d1 } = makeEnv()
  const sid = 'sess-test-123'

  // Seed KV as the legacy blob store: two boards, tasks on each.
  kvStore.set(
    boardsKey(sid),
    JSON.stringify({
      version: 4,
      updatedAt: '2026-07-01T00:00:00.000Z',
      boards: [
        { id: 'main', name: 'main', tags: ['work'], tasks: [] },
        { id: 'side', name: 'Side Project', tags: [], tasks: [] }
      ]
    })
  )
  kvStore.set(
    tasksKey(sid, 'main'),
    JSON.stringify({
      version: 3,
      updatedAt: '2026-07-01T00:00:00.000Z',
      tasks: [
        {
          id: 'm1',
          title: 'Main task',
          tag: 'work',
          state: 'Active',
          createdAt: '2026-06-01T00:00:00.000Z'
        }
      ]
    })
  )
  kvStore.set(
    tasksKey(sid, 'side'),
    JSON.stringify({
      version: 2,
      updatedAt: '2026-07-01T00:00:00.000Z',
      tasks: [
        { id: 's1', title: 'Side task', state: 'Active', createdAt: '2026-06-02T00:00:00.000Z' },
        { id: 's2', title: 'Side two', state: 'Active', createdAt: '2026-06-03T00:00:00.000Z' }
      ]
    })
  )

  // First read triggers the migration.
  const r = await req(env, 'GET', '/task/api/boards')
  check('GET /boards → 200', r.status === 200, `status=${r.status}`)
  check('migrated both boards', r.json?.boards?.length === 2, `n=${r.json?.boards?.length}`)
  const main = r.json?.boards?.find(b => b.id === 'main')
  const side = r.json?.boards?.find(b => b.id === 'side')
  check('main hydrated with its task', main?.tasks?.length === 1, `n=${main?.tasks?.length}`)
  check('side hydrated with 2 tasks', side?.tasks?.length === 2, `n=${side?.tasks?.length}`)
  check('collection version preserved (4)', r.json?.version === 4, `v=${r.json?.version}`)

  // Rows landed in D1, field-for-field.
  check(
    'D1 has 2 board rows',
    rowCount(d1, 'SELECT COUNT(*) n FROM boards WHERE user_id=?', sid) === 2
  )
  check(
    'D1 has 3 task rows',
    rowCount(d1, 'SELECT COUNT(*) n FROM tasks WHERE user_id=?', sid) === 3
  )
  check(
    "main's tasks_version preserved (3)",
    rowCount(d1, "SELECT tasks_version n FROM boards WHERE user_id=? AND id='main'", sid) === 3
  )
  const m1 = d1.__raw
    .prepare("SELECT title, tag FROM tasks WHERE user_id=? AND id='m1'")
    .get(sid) as { title: string; tag: string } | undefined
  check(
    'task fields preserved',
    m1?.title === 'Main task' && m1?.tag === 'work',
    JSON.stringify(m1)
  )

  // KV entries deleted after migration.
  check('KV boards blob deleted', !kvStore.has(boardsKey(sid)), `keys=${[...kvStore.keys()]}`)
  check('KV main tasks blob deleted', !kvStore.has(tasksKey(sid, 'main')))
  check('KV side tasks blob deleted', !kvStore.has(tasksKey(sid, 'side')))

  // Second read is D1-authoritative and identical.
  const r2 = await req(env, 'GET', '/task/api/boards')
  check(
    '2nd read identical (2 boards, v4)',
    r2.json?.boards?.length === 2 && r2.json?.version === 4
  )
}

async function sectionB2_legacyNamespace() {
  console.log('\nB2. Read-repair from the pre-flip raw-credential namespace')
  const { env, kvStore } = makeEnv()
  const rawKey = 'raw-cred-xyz'
  const userId = 'uid-stable-123'

  // Data lives under the RAW credential; the request arrives flipped (X-User-Id
  // present) so sessionId=userId and legacyId=rawKey.
  kvStore.set(
    tasksKey(rawKey, 'main'),
    JSON.stringify({
      version: 5,
      updatedAt: '2026-07-01T00:00:00.000Z',
      tasks: [
        { id: 'leg1', title: 'Legacy task', state: 'Active', createdAt: '2026-06-01T00:00:00.000Z' }
      ]
    })
  )

  const r = await req(env, 'GET', '/task/api/tasks', {
    userKey: rawKey,
    headers: { 'X-User-Id': userId }
  })
  check('legacy task migrated via legacyId', r.json?.tasks?.length === 1, JSON.stringify(r.json))
  check('legacy tasks_version preserved (5)', r.json?.version === 5, `v=${r.json?.version}`)
  check('legacy KV blob deleted', !kvStore.has(tasksKey(rawKey, 'main')))
}

async function sectionC_boardCrud() {
  console.log('\nC. Board create / delete through D1')
  const { env, d1 } = makeEnv()
  const sid = 'sess-test-123'

  let r = await req(env, 'POST', '/task/api/boards', { body: { id: 'work', name: 'Work' } })
  check('create board → 200', r.status === 200, `status=${r.status}`)

  r = await req(env, 'GET', '/task/api/boards')
  const ids = (r.json?.boards ?? []).map(b => b.id).sort()
  check(
    'board list includes work + main',
    ids.includes('work') && ids.includes('main'),
    JSON.stringify(ids)
  )
  check(
    'new board has a ULID handle',
    rowCount(d1, "SELECT LENGTH(handle) n FROM boards WHERE user_id=? AND id='work'", sid) >= 20
  )

  // Seed a task on the board, then delete the board and confirm cascade.
  await req(env, 'POST', '/task/api', { body: { id: 'w1', title: 'work task', boardId: 'work' } })
  r = await req(env, 'DELETE', '/task/api/boards/work')
  check('delete board → 200', r.status === 200, `status=${r.status}`)

  r = await req(env, 'GET', '/task/api/boards')
  check(
    'board gone from list',
    !(r.json?.boards ?? []).some(b => b.id === 'work'),
    JSON.stringify(r.json?.boards?.map(b => b.id))
  )
  check(
    'board row deleted',
    rowCount(d1, "SELECT COUNT(*) n FROM boards WHERE user_id=? AND id='work'", sid) === 0
  )
  check(
    'board tasks cascaded',
    rowCount(d1, "SELECT COUNT(*) n FROM tasks WHERE user_id=? AND board_id='work'", sid) === 0
  )
}

async function sectionD_boardOCC() {
  console.log('\nD. Board-collection optimistic concurrency')
  const { env } = makeEnv()

  let r = await req(env, 'GET', '/task/api/boards')
  check('GET /boards → version 1', r.json?.version === 1, `v=${r.json?.version}`)
  check('GET /boards sets ETag "1"', r.etag === '"1"', `etag=${r.etag}`)

  // Correct If-Match → applies and bumps the collection version.
  r = await req(env, 'POST', '/task/api/boards', {
    body: { id: 'a', name: 'A' },
    headers: { 'If-Match': '1' }
  })
  check(
    'create (If-Match 1) → 200 version 2',
    r.status === 200 && r.json?.version === 2,
    `s=${r.status} v=${r.json?.version}`
  )
  check('create sets ETag "2"', r.etag === '"2"', `etag=${r.etag}`)

  // Stale If-Match → 409, and the write must NOT apply.
  r = await req(env, 'POST', '/task/api/boards', {
    body: { id: 'b', name: 'B' },
    headers: { 'If-Match': '1' }
  })
  check('stale If-Match → 409', r.status === 409, `status=${r.status}`)
  check('409 → VERSION_CONFLICT', r.json?.code === 'VERSION_CONFLICT', JSON.stringify(r.json))
  check('409 → currentVersion 2', r.json?.currentVersion === 2, `cv=${r.json?.currentVersion}`)

  r = await req(env, 'GET', '/task/api/boards')
  const ids = (r.json?.boards ?? []).map(b => b.id)
  check(
    'stale create rejected (a present, b absent)',
    ids.includes('a') && !ids.includes('b'),
    JSON.stringify(ids)
  )
  check('version still 2 after rejected write', r.json?.version === 2, `v=${r.json?.version}`)

  // Correct If-Match "2" → applies.
  r = await req(env, 'POST', '/task/api/boards', {
    body: { id: 'b', name: 'B' },
    headers: { 'If-Match': '2' }
  })
  check(
    'create (If-Match 2) → 200 version 3',
    r.status === 200 && r.json?.version === 3,
    `s=${r.status} v=${r.json?.version}`
  )

  // Delete with correct If-Match → applies and bumps.
  r = await req(env, 'DELETE', '/task/api/boards/a', { headers: { 'If-Match': '3' } })
  check(
    'delete (If-Match 3) → 200 version 4',
    r.status === 200 && r.json?.version === 4,
    `s=${r.status} v=${r.json?.version}`
  )

  // No If-Match → last-write-wins, no 409 (web-client path).
  r = await req(env, 'POST', '/task/api/boards', { body: { id: 'c', name: 'C' } })
  check('create (no If-Match) → 200 (last-write-wins)', r.status === 200, `status=${r.status}`)
  check('no-If-Match write still bumps version to 5', r.json?.version === 5, `v=${r.json?.version}`)
}

async function main() {
  console.log('T1 D1-storage runtime verification')
  await sectionA_taskOCC()
  await sectionB_migration()
  await sectionB2_legacyNamespace()
  await sectionC_boardCrud()
  await sectionD_boardOCC()
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
