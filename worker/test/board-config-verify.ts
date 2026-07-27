/**
 * T2 board-config runtime verification.
 *
 * Boots the REAL worker (createTaskHandler) with TASK_STORAGE=d1 against a REAL
 * SQLite DB loaded from the prod migration SQL, and proves the T2 contract:
 *
 *   - More than 5 boards can be created and all come back on read.
 *   - Boards default to unpinned; PUT /boards/pinned sets the pinned set AND its
 *     order in one write; the order survives a re-read (board_prefs round-trip).
 *   - Unpinning (omitting a board from the order) clears its pin.
 *   - PATCH renames a board.
 *   - Reorder/pin goes through board-collection OCC: a stale If-Match → 409 and
 *     the losing write is NOT applied.
 *   - Deleting a board removes its board_prefs row (no orphaned pins).
 *
 * Run via: pnpm run test:worker  (or `... board-config-verify`).
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

// task_events predates the migration files; the stats path reads it on every
// board read, so the harness DB must have it (empty is enough).
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
const USER = 'sess-t2-user'

function headers(extra: Record<string, string> = {}) {
  return {
    'X-Edge-Auth': EDGE_SECRET,
    'X-Hadoku-Tier': 'friend',
    'X-User-Key': USER,
    'Content-Type': 'application/json',
    ...extra
  }
}

interface Board {
  id: string
  name: string
  pinned?: boolean
  position?: number
}
interface ResponseBody {
  version?: number
  currentVersion?: number
  code?: string
  boards?: Board[]
  ok?: boolean
}

async function req(
  env: unknown,
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {}
) {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: headers(opts.headers),
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
function section(t: string) {
  console.log(`\n${t}`)
}

/** Fetch the board list. */
async function getBoards(env: unknown): Promise<Board[]> {
  const r = await req(env, 'GET', '/task/api/boards')
  return r.json?.boards ?? []
}
/** Current board-collection version, for If-Match. */
async function boardVersion(env: unknown): Promise<number> {
  const r = await req(env, 'GET', '/task/api/boards')
  return r.json?.version ?? 1
}

async function main() {
  console.log('T2 board-config runtime verification')

  // ---------------------------------------------------------------------
  section('1. More than 5 boards can be created and all return')
  // ---------------------------------------------------------------------
  const env = makeEnv()
  // main exists by default; add 7 more → 8 total (>5).
  for (let i = 1; i <= 7; i++) {
    const r = await req(env, 'POST', '/task/api/boards', {
      body: { id: `board-${i}`, name: `Board ${i}` }
    })
    if (r.status !== 200) check(`create board-${i}`, false, `status=${r.status}`)
  }
  let boards = await getBoards(env)
  check('8 boards exist (>5, server never capped)', boards.length === 8, `n=${boards.length}`)
  check(
    'all default to unpinned',
    boards.every(b => !b.pinned),
    JSON.stringify(boards.map(b => b.pinned))
  )

  // ---------------------------------------------------------------------
  section('2. PUT /boards/pinned sets the pinned set AND its order')
  // ---------------------------------------------------------------------
  // Pin three, in a deliberate order that is NOT creation order.
  let r = await req(env, 'PUT', '/task/api/boards/pinned', {
    body: { order: ['board-3', 'main', 'board-1'] }
  })
  check('PUT pinned → 200', r.status === 200, `status=${r.status}`)
  boards = await getBoards(env)
  const pinned = boards.filter(b => b.pinned)
  check('exactly 3 pinned', pinned.length === 3, `n=${pinned.length}`)
  check(
    'pinned come first, in the requested order',
    boards[0].id === 'board-3' && boards[1].id === 'main' && boards[2].id === 'board-1',
    JSON.stringify(boards.slice(0, 3).map(b => b.id))
  )
  check(
    'positions are 0,1,2 in order',
    boards[0].position === 0 && boards[1].position === 1 && boards[2].position === 2,
    JSON.stringify(boards.slice(0, 3).map(b => b.position))
  )
  check(
    'unpinned boards keep pinned=false',
    boards.slice(3).every(b => !b.pinned)
  )

  // ---------------------------------------------------------------------
  section('3. Pin order + state survive a re-read (board_prefs persisted)')
  // ---------------------------------------------------------------------
  boards = await getBoards(env)
  check(
    'second read still shows board-3, main, board-1 pinned in order',
    boards[0].id === 'board-3' && boards[1].id === 'main' && boards[2].id === 'board-1',
    JSON.stringify(boards.slice(0, 3).map(b => b.id))
  )

  // ---------------------------------------------------------------------
  section('4. Re-pinning a different set unpins the old ones')
  // ---------------------------------------------------------------------
  r = await req(env, 'PUT', '/task/api/boards/pinned', { body: { order: ['board-1', 'board-2'] } })
  check('re-pin → 200', r.status === 200, `status=${r.status}`)
  boards = await getBoards(env)
  const nowPinned = boards.filter(b => b.pinned).map(b => b.id)
  check(
    'exactly board-1, board-2 pinned now',
    JSON.stringify(nowPinned) === JSON.stringify(['board-1', 'board-2']),
    JSON.stringify(nowPinned)
  )
  check(
    'board-3 + main are unpinned again',
    !boards.find(b => b.id === 'board-3')?.pinned && !boards.find(b => b.id === 'main')?.pinned
  )

  // ---------------------------------------------------------------------
  section('5. PATCH renames a board')
  // ---------------------------------------------------------------------
  r = await req(env, 'PATCH', '/task/api/boards/board-1', { body: { name: 'Renamed One' } })
  check('PATCH rename → 200', r.status === 200, `status=${r.status}`)
  boards = await getBoards(env)
  check(
    'board-1 name updated',
    boards.find(b => b.id === 'board-1')?.name === 'Renamed One',
    JSON.stringify(boards.find(b => b.id === 'board-1'))
  )

  // ---------------------------------------------------------------------
  section('6. Reorder goes through board-collection OCC (stale If-Match → 409)')
  // ---------------------------------------------------------------------
  const v = await boardVersion(env)
  // A correct If-Match succeeds and bumps the version.
  r = await req(env, 'PUT', '/task/api/boards/pinned', {
    body: { order: ['board-2', 'board-1'] },
    headers: { 'If-Match': `"${v}"` }
  })
  check('reorder with correct If-Match → 200', r.status === 200, `status=${r.status}`)
  // A stale If-Match (the version we just consumed) → 409, not applied.
  r = await req(env, 'PUT', '/task/api/boards/pinned', {
    body: { order: ['main'] },
    headers: { 'If-Match': `"${v}"` }
  })
  check('reorder with STALE If-Match → 409', r.status === 409, `status=${r.status}`)
  boards = await getBoards(env)
  check(
    'the losing write was NOT applied (main still unpinned)',
    !boards.find(b => b.id === 'main')?.pinned,
    JSON.stringify(boards.filter(b => b.pinned).map(b => b.id))
  )

  // ---------------------------------------------------------------------
  section('7. Deleting a board removes its board_prefs row')
  // ---------------------------------------------------------------------
  // board-2 is currently pinned; delete it and confirm no orphan pin lingers.
  r = await req(env, 'DELETE', '/task/api/boards/board-2')
  check('delete board-2 → 200', r.status === 200, `status=${r.status}`)
  const prefRows = (env.DB as FakeD1).__raw
    .prepare('SELECT COUNT(*) AS n FROM board_prefs WHERE user_id = ? AND board_id = ?')
    .get(USER, 'board-2') as { n: number }
  check('board_prefs row for board-2 is gone', prefRows.n === 0, `rows=${prefRows.n}`)
  boards = await getBoards(env)
  check('board-2 no longer in the list', !boards.some(b => b.id === 'board-2'))

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
