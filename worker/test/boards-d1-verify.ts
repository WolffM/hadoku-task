/**
 * D1-storage runtime verification (post-cutover: D1 is the sole boards/tasks store).
 *
 * Boots the REAL worker (createTaskHandler) backed by a REAL SQLite database
 * (node:sqlite) loaded from the SAME migration SQL that ships to prod. Proves the
 * things typecheck/lint/build cannot:
 *
 *   A. Task optimistic-concurrency through D1 (the phase0 contract holds).
 *   C. Board create/delete round-trips + cascade.
 *   D. Board-collection OCC (stale If-Match -> 409).
 *   E. Atomic cross-board move (one db.batch).
 *   G. A brand-new user is scaffolded by ensureInitialized (default board, no orphans).
 *
 * Run via: pnpm run test:worker  (or `... boards-d1-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')

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

function makeEnv() {
  const { kv, store } = makeKV()
  const d1: FakeD1 = makeSqliteD1(MIGRATION)
  // TASKS_KV is still bound (prefs/session routes use it) but the boards/tasks
  // storage no longer reads or writes it — the D1 cutover is complete.
  const env = { TASKS_KV: kv, DB: d1, EDGE_AUTH_SECRET: EDGE_SECRET }
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
  tasks?: Array<{ id: string; title: string; tag?: string | null; state?: string }>
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
  // Completing retains the task (it renders struck through until its 24h window
  // elapses), so both t1 and t2 are still listed — t1 as Completed.
  check(
    'completed task is retained, not removed',
    r.json?.tasks?.length === 2,
    `len=${r.json?.tasks?.length}`
  )
  check(
    'completed task carries state=Completed',
    r.json?.tasks?.find(t => t.id === 't1')?.state === 'Completed',
    `state=${r.json?.tasks?.find(t => t.id === 't1')?.state}`
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

async function sectionE_atomicMove() {
  console.log('\nE. Atomic cross-board move (one db.batch)')
  const { env, d1 } = makeEnv()
  const sid = 'sess-test-123'

  await req(env, 'POST', '/task/api/boards', { body: { id: 'target', name: 'Target' } })
  await req(env, 'POST', '/task/api', { body: { id: 'm1', title: 'Movable', boardId: 'main' } })
  await req(env, 'POST', '/task/api', { body: { id: 'm2', title: 'Stays', boardId: 'main' } })

  const r = await req(env, 'POST', '/task/api/batch/move-tasks', {
    body: { sourceBoardId: 'main', targetBoardId: 'target', taskIds: ['m1'] }
  })
  check('move → 200', r.status === 200, `status=${r.status}`)

  // Source board keeps only m2; target board now holds m1.
  const src = await req(env, 'GET', '/task/api/tasks', { headers: {} })
  const srcIds = (src.json?.tasks ?? []).map(t => t.id)
  check(
    'm1 removed from source, m2 remains',
    !srcIds.includes('m1') && srcIds.includes('m2'),
    JSON.stringify(srcIds)
  )

  const tgt = await req(env, 'GET', '/task/api/tasks?boardId=target')
  const tgtIds = (tgt.json?.tasks ?? []).map(t => t.id)
  check('m1 present on target', tgtIds.includes('m1'), JSON.stringify(tgtIds))

  // Straight from SQLite: the moved row physically carries the new board_id, and
  // the task exists on exactly one board (no duplicate, no orphan).
  const boardOfM1 = d1.__raw
    .prepare('SELECT board_id FROM tasks WHERE user_id=? AND id=?')
    .get(sid, 'm1') as { board_id: string } | undefined
  check('m1 row board_id = target', boardOfM1?.board_id === 'target', JSON.stringify(boardOfM1))
  check(
    'exactly one m1 row exists',
    rowCount(d1, 'SELECT COUNT(*) n FROM tasks WHERE user_id=? AND id=?', sid, 'm1') === 1
  )
  // The atomicity property: source ends with exactly its remaining task, target
  // with exactly the moved one — no half-applied move (source emptied without
  // target filled, or a duplicated row).
  check(
    'source board has exactly 1 row (m2)',
    rowCount(d1, "SELECT COUNT(*) n FROM tasks WHERE user_id=? AND board_id='main'", sid) === 1
  )
  check(
    'target board has exactly 1 row (m1)',
    rowCount(d1, "SELECT COUNT(*) n FROM tasks WHERE user_id=? AND board_id='target'", sid) === 1
  )
  check(
    'move response reports moved:1',
    (r.json as { moved?: number })?.moved === 1,
    JSON.stringify(r.json)
  )
}

async function sectionG_newUser() {
  console.log('\nG. New user is scaffolded by ensureInitialized (no KV, no orphans)')
  const { env, d1 } = makeEnv()
  const sid = 'sess-test-123'

  // First read of a brand-new user: default board is present, board_meta exists.
  let r = await req(env, 'GET', '/task/api/boards')
  const ids = (r.json?.boards ?? []).map(b => b.id)
  check('new user sees default main board', ids.includes('main'), JSON.stringify(ids))
  check(
    'board_meta materialized',
    rowCount(d1, 'SELECT COUNT(*) n FROM board_meta WHERE user_id=?', sid) === 1
  )
  check(
    'main board row materialized',
    rowCount(d1, "SELECT COUNT(*) n FROM boards WHERE user_id=? AND id='main'", sid) === 1
  )

  // Create a task on the default board — it must not become an orphan (a task
  // row whose board_id has no boards row), which ensureInitialized prevents.
  r = await req(env, 'POST', '/task/api', { body: { id: 'n1', title: 'new task' } })
  check('create task on default board → 200', r.status === 200, `status=${r.status}`)
  check(
    'no orphan tasks',
    rowCount(
      d1,
      'SELECT COUNT(*) n FROM tasks t WHERE user_id=? AND NOT EXISTS (SELECT 1 FROM boards b WHERE b.user_id=t.user_id AND b.id=t.board_id)',
      sid
    ) === 0
  )
}

async function main() {
  console.log('D1-storage runtime verification (post-cutover)')
  await sectionA_taskOCC()
  await sectionC_boardCrud()
  await sectionD_boardOCC()
  await sectionE_atomicMove()
  await sectionG_newUser()
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
