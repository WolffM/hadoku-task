/**
 * Task lifecycle runtime verification.
 *
 * Boots the REAL worker (createTaskHandler) with TASK_STORAGE=d1 against a REAL
 * SQLite DB built from the prod migrations, and proves the completed/closed
 * contract over HTTP:
 *
 *   - completing does NOT remove the task; it comes back state='Completed'
 *   - completing again REOPENS it (the ✓ is a toggle), and counters.completed
 *     nets back to 0 rather than counting the flip twice
 *   - × on a completed task dismisses it immediately (soft: the row survives)
 *   - a completed task past its 24h window falls out of view on its own, with
 *     no sweeper having run
 *   - THE BIG ONE: a subsequent write must not hard-delete closed or deleted
 *     rows. The old reconcile ("delete anything not in the file") would wipe
 *     them the moment they left the read window.
 *   - the ingest-once index only constrains ACTIVE rows, so a completed
 *     calendar task doesn't block re-ingest of the same source event
 *
 * Run via: pnpm run test:worker  (or `... task-lifecycle-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')
const USER = 'sess-lifecycle-user'

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

let d1: FakeD1

function makeEnv() {
  d1 = makeSqliteD1(MIGRATION)
  return {
    TASKS_KV: makeKV(),
    DB: d1,
    EDGE_AUTH_SECRET: EDGE_SECRET,
    TASK_STORAGE: 'd1',
    TASK_STORAGE_PRUNE_KV: '1'
  } as Record<string, unknown>
}

const app = createTaskHandler()

function headers() {
  return {
    'X-Edge-Auth': EDGE_SECRET,
    'X-Hadoku-Tier': 'friend',
    'X-User-Key': USER,
    'Content-Type': 'application/json'
  }
}

interface TaskShape {
  id: string
  title: string
  state?: string
  closedAt?: string | null
}
interface Body {
  code?: string
  tasks?: TaskShape[]
  id?: string
  state?: string
  counters?: { created: number; completed: number; edited: number; deleted: number }
}

async function req(env: unknown, method: string, path: string, body?: unknown) {
  const res = await app.request(
    'http://localhost' + path,
    { method, headers: headers(), body: body !== undefined ? JSON.stringify(body) : undefined },
    env
  )
  let json: Body | null = null
  try {
    json = await res.clone().json()
  } catch {
    /* non-json */
  }
  return { status: res.status, json }
}

async function visibleTasks(env: unknown): Promise<TaskShape[]> {
  const r = await req(env, 'GET', '/task/api/tasks')
  return r.json?.tasks ?? []
}

async function getVisible(env: unknown, id: string): Promise<TaskShape | undefined> {
  return (await visibleTasks(env)).find(t => t.id === id)
}

/** Read straight from SQLite — proves what SURVIVED, not what's merely visible. */
function rowOf(id: string): { id: string; state: string; closed_at: string | null } | undefined {
  return d1.__raw
    .prepare('SELECT id, state, closed_at FROM tasks WHERE user_id = ? AND id = ?')
    .get(USER, id) as { id: string; state: string; closed_at: string | null } | undefined
}

/** Backdate a close so the 24h window has demonstrably elapsed. */
function backdateClose(id: string, msAgo: number) {
  d1.__raw
    .prepare('UPDATE tasks SET closed_at = ? WHERE user_id = ? AND id = ?')
    .run(new Date(Date.now() - msAgo).toISOString(), USER, id)
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

const DAY_MS = 24 * 60 * 60 * 1000

async function main() {
  console.log('Task lifecycle runtime verification')
  const env = makeEnv()

  // ---------------------------------------------------------------------
  section('1. completing retains the task, struck through rather than removed')
  // ---------------------------------------------------------------------
  await req(env, 'POST', '/task/api', { id: 'lc-1', title: 'Ship the thing' })
  let r = await req(env, 'POST', '/task/api/lc-1/complete')
  check('complete → 200', r.status === 200, `status=${r.status}`)
  check('response reports state=Completed', r.json?.state === 'Completed', `state=${r.json?.state}`)

  let t = await getVisible(env, 'lc-1')
  check('task is STILL returned by GET /tasks', !!t, 'task vanished on completion')
  check('…and carries state=Completed', t?.state === 'Completed', `state=${t?.state}`)
  check('…with a closedAt stamp', !!t?.closedAt, `closedAt=${t?.closedAt}`)

  // ---------------------------------------------------------------------
  section('2. completing an already-completed task reopens it (the ✓ toggle)')
  // ---------------------------------------------------------------------
  r = await req(env, 'POST', '/task/api/lc-1/complete')
  check('second complete → 200', r.status === 200, `status=${r.status}`)
  check('response reports state=Active', r.json?.state === 'Active', `state=${r.json?.state}`)
  t = await getVisible(env, 'lc-1')
  check('task is Active again', t?.state === 'Active', `state=${t?.state}`)
  check('closedAt cleared on reopen', !t?.closedAt, `closedAt=${t?.closedAt}`)

  // ---------------------------------------------------------------------
  section('3. counters.completed is NET — a complete/reopen flip is not 2')
  // ---------------------------------------------------------------------
  r = await req(env, 'GET', '/task/api/stats')
  check(
    'completed nets back to 0 after complete+reopen',
    r.json?.counters?.completed === 0,
    `completed=${r.json?.counters?.completed}`
  )
  await req(env, 'POST', '/task/api/lc-1/complete')
  r = await req(env, 'GET', '/task/api/stats')
  check(
    'completed is 1 after re-completing',
    r.json?.counters?.completed === 1,
    `completed=${r.json?.counters?.completed}`
  )

  // ---------------------------------------------------------------------
  section('4. a completed task closes out of view once its window elapses')
  // ---------------------------------------------------------------------
  check('still visible inside the window', !!(await getVisible(env, 'lc-1')), 'closed too early')
  backdateClose('lc-1', DAY_MS + 60_000)
  check(
    'gone from view after 24h, with NO sweeper run',
    !(await getVisible(env, 'lc-1')),
    'aged task still visible'
  )
  check('…but the row survives as history', rowOf('lc-1')?.state === 'Completed', 'row destroyed')

  // ---------------------------------------------------------------------
  section('5. THE REGRESSION GUARD: a later write must not wipe closed rows')
  // ---------------------------------------------------------------------
  // The old reconcile deleted every row absent from the written file. Now that
  // getTasks returns a WINDOW, that rule would hard-delete all history on the
  // very next write. Force a write and prove the aged row is untouched.
  await req(env, 'POST', '/task/api', { id: 'lc-2', title: 'Unrelated later task' })
  check(
    'aged-out completed row survives an unrelated write',
    rowOf('lc-1')?.state === 'Completed',
    'reconcile hard-deleted closed history'
  )
  await req(env, 'PATCH', '/task/api/lc-2', { title: 'Renamed' })
  check(
    '…and survives an update too',
    rowOf('lc-1')?.state === 'Completed',
    'reconcile hard-deleted closed history on update'
  )

  // ---------------------------------------------------------------------
  section('6. × dismisses immediately; the record is soft-deleted, not destroyed')
  // ---------------------------------------------------------------------
  await req(env, 'POST', '/task/api', { id: 'lc-3', title: 'Dismiss me' })
  await req(env, 'POST', '/task/api/lc-3/complete')
  check('completed task is visible', !!(await getVisible(env, 'lc-3')), 'not visible')
  r = await req(env, 'DELETE', '/task/api/lc-3')
  check('delete → 200', r.status === 200, `status=${r.status}`)
  check(
    'gone from view immediately (no 24h wait)',
    !(await getVisible(env, 'lc-3')),
    'still visible after delete'
  )
  check(
    'row retained as state=Deleted',
    rowOf('lc-3')?.state === 'Deleted',
    `row=${rowOf('lc-3')?.state}`
  )

  await req(env, 'POST', '/task/api', { id: 'lc-4', title: 'Force another write' })
  check(
    'deleted row survives a later write',
    rowOf('lc-3')?.state === 'Deleted',
    'reconcile destroyed a soft-deleted row'
  )

  // ---------------------------------------------------------------------
  section('7. ingest-once constrains ACTIVE rows only')
  // ---------------------------------------------------------------------
  // A completed calendar task must not squat on (user_id, source, source_id)
  // and block the provider re-adding that event.
  await req(env, 'POST', '/task/api', {
    id: 'lc-5',
    title: 'Standup',
    source: 'gcal',
    sourceId: 'evt-999'
  })
  await req(env, 'POST', '/task/api/lc-5/complete')
  r = await req(env, 'POST', '/task/api', {
    id: 'lc-6',
    title: 'Standup (next occurrence)',
    source: 'gcal',
    sourceId: 'evt-999'
  })
  check('re-ingest of a completed event → 200', r.status === 200, `status=${r.status}`)
  check('the re-ingested task is visible', !!(await getVisible(env, 'lc-6')), 'not created')

  // ---------------------------------------------------------------------
  section('8. a live task is never touched by any of this')
  // ---------------------------------------------------------------------
  const live = await getVisible(env, 'lc-2')
  check('unrelated active task still Active', live?.state === 'Active', `state=${live?.state}`)
  check('…and has no closedAt', !live?.closedAt, `closedAt=${live?.closedAt}`)

  // ---------------------------------------------------------------------
  section('9. the migrations left task_events usable, not merely present')
  // ---------------------------------------------------------------------
  // 0004 rebuilds task_events, and its first version silently dropped every
  // index: renaming a table carries its indexes along, so the names were still
  // taken and `CREATE INDEX IF NOT EXISTS` matched the backup's copies and
  // skipped. The migration reported success while leaving the live table
  // unindexed, and nothing here noticed — the whole suite passed. Assert the
  // shape, not just that queries return rows.
  const idxRows = d1.__raw
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='task_events' AND name NOT LIKE 'sqlite_%'`
    )
    .all() as Array<{ name: string }>
  const idx = new Set(idxRows.map(r => r.name))
  for (const want of ['idx_user_board', 'idx_user', 'idx_timestamp', 'idx_task']) {
    check(`index ${want} is on the LIVE table`, idx.has(want), `have=${[...idx].join(',')}`)
  }

  const ddl = (
    d1.__raw.prepare(`SELECT sql FROM sqlite_master WHERE name='task_events'`).get() as {
      sql: string
    }
  ).sql
  check('CHECK admits uncompleted', ddl.includes("'uncompleted'"), ddl)

  // The backup 0004 leaves behind must still hold the history it copied from.
  const backup = d1.__raw
    .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name='task_events_backup_0004'`)
    .get() as { n: number }
  check('0004 kept a backup rather than dropping the original', backup.n === 1)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
