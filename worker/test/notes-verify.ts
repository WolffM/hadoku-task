/**
 * T3 notes runtime verification.
 *
 * Boots the REAL worker (createTaskHandler) with TASK_STORAGE=d1 against a REAL
 * SQLite DB from the prod migration, and proves the §6 notes contract over HTTP:
 *
 *   - create_task with `notes` persists it; GET returns it.
 *   - PATCH /:id with `notes` updates it; clearing with "" works.
 *   - notes survive a round-trip that doesn't touch them (patching the title
 *     must not drop notes — the KV path used to).
 *   - notes over the 64 KB cap → 413 NOTES_TOO_LARGE, on both create and update,
 *     and the oversized write is NOT applied.
 *
 * Run via: pnpm run test:worker  (or `... notes-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations/0002_boards_and_tasks.sql')

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

const TASK_EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_key TEXT NOT NULL, board_id TEXT NOT NULL,
    task_id TEXT, event_type TEXT NOT NULL, metadata TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')));`

function makeEnv() {
  const d1: FakeD1 = makeSqliteD1(MIGRATION)
  d1.__raw.exec(TASK_EVENTS_DDL)
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
    'X-User-Key': 'sess-t3-user',
    'Content-Type': 'application/json'
  }
}

interface TaskShape {
  id: string
  title: string
  notes?: string | null
}
interface Body {
  code?: string
  tasks?: TaskShape[]
  id?: string
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

async function getTask(env: unknown, id: string): Promise<TaskShape | undefined> {
  const r = await req(env, 'GET', '/task/api/tasks')
  return r.json?.tasks?.find(t => t.id === id)
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

async function main() {
  console.log('T3 notes runtime verification')
  const env = makeEnv()

  // ---------------------------------------------------------------------
  section('1. create_task with notes persists; GET returns it')
  // ---------------------------------------------------------------------
  let r = await req(env, 'POST', '/task/api', {
    id: 'task-1',
    title: 'Plan the thing',
    notes: '## Plan\n- step one\n- step two'
  })
  check('create with notes → 200', r.status === 200, `status=${r.status}`)
  let t = await getTask(env, 'task-1')
  check(
    'notes returned on read',
    t?.notes === '## Plan\n- step one\n- step two',
    JSON.stringify(t?.notes)
  )

  // ---------------------------------------------------------------------
  section('2. PATCH updates notes; empty string clears')
  // ---------------------------------------------------------------------
  r = await req(env, 'PATCH', '/task/api/task-1', { notes: 'revised plan' })
  check('PATCH notes → 200', r.status === 200, `status=${r.status}`)
  t = await getTask(env, 'task-1')
  check('notes updated', t?.notes === 'revised plan', JSON.stringify(t?.notes))

  r = await req(env, 'PATCH', '/task/api/task-1', { notes: '' })
  check('PATCH empty notes → 200', r.status === 200, `status=${r.status}`)
  t = await getTask(env, 'task-1')
  check('notes cleared (empty)', !t?.notes, JSON.stringify(t?.notes))

  // ---------------------------------------------------------------------
  section('3. Notes survive an unrelated update (title patch)')
  // ---------------------------------------------------------------------
  await req(env, 'PATCH', '/task/api/task-1', { notes: 'keep me' })
  r = await req(env, 'PATCH', '/task/api/task-1', { title: 'Renamed' })
  check('PATCH title → 200', r.status === 200, `status=${r.status}`)
  t = await getTask(env, 'task-1')
  check('notes NOT dropped by a title-only patch', t?.notes === 'keep me', JSON.stringify(t?.notes))
  check('title updated', t?.title === 'Renamed', JSON.stringify(t?.title))

  // ---------------------------------------------------------------------
  section('4. Oversized notes → 413 NOTES_TOO_LARGE, not applied')
  // ---------------------------------------------------------------------
  const huge = 'x'.repeat(64 * 1024 + 1) // 1 byte over the cap
  r = await req(env, 'POST', '/task/api', { id: 'task-big', title: 'Big', notes: huge })
  check('create oversized notes → 413', r.status === 413, `status=${r.status}`)
  check('create 413 → NOTES_TOO_LARGE', r.json?.code === 'NOTES_TOO_LARGE', JSON.stringify(r.json))
  check('oversized task was NOT created', (await getTask(env, 'task-big')) === undefined)

  r = await req(env, 'PATCH', '/task/api/task-1', { notes: huge })
  check('update oversized notes → 413', r.status === 413, `status=${r.status}`)
  t = await getTask(env, 'task-1')
  check(
    'the oversized update was NOT applied (notes still "keep me")',
    t?.notes === 'keep me',
    JSON.stringify(t?.notes)
  )

  // ---------------------------------------------------------------------
  section('5. Exactly at the cap is allowed')
  // ---------------------------------------------------------------------
  const atCap = 'y'.repeat(64 * 1024)
  r = await req(env, 'PATCH', '/task/api/task-1', { notes: atCap })
  check('notes exactly at 64 KB → 200', r.status === 200, `status=${r.status}`)
  t = await getTask(env, 'task-1')
  check('at-cap notes persisted', t?.notes?.length === 64 * 1024, `len=${t?.notes?.length}`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
