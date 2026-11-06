/**
 * POST /task/api/batch/delete-boards (#86), against the REAL worker and a real
 * sqlite D1.
 *
 *   - several boards go in ONE request, each with all of its tasks and the
 *     owner's pin rows — the same rows the single `DELETE /boards/{id}` removes —
 *     and the board collection's version moves once, not once per board;
 *   - no task is left without its board (integrity.ts countOrphans);
 *   - an id that names no board is reported in `notFound`, not a failure;
 *   - another user's board with the same id is untouched;
 *   - `main`, an empty list and an oversized list are refused with nothing written;
 *   - a stale If-Match is a 409 with nothing written.
 *
 * Run via: pnpm run test:worker  (or `... batch-delete-boards-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { countOrphans } from '../src/integrity'
import { MAX_BATCH_DELETE_BOARDS } from '@wolffm/task/api'
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
const env = { TASKS_KV: makeKV(), DB: d1, EDGE_AUTH_SECRET: EDGE_SECRET } as Record<string, unknown>
const app = createTaskHandler()

async function req(
  userId: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: unknown; etag: string | null }> {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': `key-${userId}`,
        'X-User-Id': userId,
        'Content-Type': 'application/json',
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    },
    env
  )
  return { status: res.status, json: await res.json(), etag: res.headers.get('ETag') }
}

const count = async (sql: string, ...args: unknown[]) =>
  (
    (await d1
      .prepare(sql)
      .bind(...args)
      .first<{ n: number }>()) ?? { n: -1 }
  ).n

const version = (uid: string) => count('SELECT version AS n FROM board_meta WHERE user_id = ?', uid)

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

const OWNER = 'owner-uid'
const OTHER = 'other-uid'

async function seed(uid: string, boards: string[]) {
  for (const board of boards) {
    const r = await req(uid, 'POST', '/task/api/boards', { id: board, name: board })
    check(`${uid}: create board ${board}`, r.status === 200, `status=${r.status}`)
    for (const n of [1, 2]) {
      const t = await req(uid, 'POST', '/task/api', {
        id: `${uid}-${board}-${n}`,
        title: `${board} ${n}`,
        board
      })
      check(`${uid}: create task ${board} ${n}`, t.status === 200, `status=${t.status}`)
    }
  }
}

async function main() {
  section('0. Seed')
  await seed(OWNER, ['alpha', 'beta', 'gamma', 'keep'])
  await seed(OTHER, ['alpha'])
  const pin = await req(OWNER, 'PUT', '/task/api/boards/pinned', {
    order: ['alpha', 'beta', 'keep']
  })
  check('pin three boards (board_prefs rows)', pin.status === 200, `status=${pin.status}`)
  check(
    'pins landed',
    (await count('SELECT COUNT(*) AS n FROM board_prefs WHERE user_id = ?', OWNER)) >= 3
  )

  section('1. Refusals write nothing')
  const before = await version(OWNER)
  for (const [label, body] of [
    ['main in the list', { boardIds: ['alpha', 'main'] }],
    ['an empty list', { boardIds: [] }],
    [
      `more than ${MAX_BATCH_DELETE_BOARDS} ids`,
      { boardIds: Array.from({ length: MAX_BATCH_DELETE_BOARDS + 1 }, (_, i) => `b${i}`) }
    ],
    ['no boardIds at all', {}]
  ] as const) {
    const r = await req(OWNER, 'POST', '/task/api/batch/delete-boards', body)
    check(`${label} → 400`, r.status === 400, `status=${r.status} ${JSON.stringify(r.json)}`)
  }
  const stale = await req(
    OWNER,
    'POST',
    '/task/api/batch/delete-boards',
    { boardIds: ['alpha'] },
    { 'If-Match': `"${before - 1}"` }
  )
  check('a stale If-Match → 409', stale.status === 409, `status=${stale.status}`)
  check('the version did not move', (await version(OWNER)) === before)
  check(
    'every board is still there',
    (await count('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?', OWNER)) === 5
  )

  section('2. Several boards, one request')
  const del = await req(
    OWNER,
    'POST',
    '/task/api/batch/delete-boards',
    { boardIds: ['alpha', 'beta', 'gamma', 'ghost'] },
    { 'If-Match': `"${before}"` }
  )
  const body = del.json as { ok?: boolean; deleted?: string[]; notFound?: string[] }
  check('→ 200', del.status === 200, `status=${del.status} ${JSON.stringify(del.json)}`)
  check(
    'deleted names the three boards',
    JSON.stringify(body.deleted) === '["alpha","beta","gamma"]',
    JSON.stringify(body)
  )
  check(
    'an unknown id is reported, not a failure',
    JSON.stringify(body.notFound) === '["ghost"]',
    JSON.stringify(body)
  )
  check('the collection version moved ONCE', (await version(OWNER)) === before + 1)
  check('and is the ETag', del.etag === `"${before + 1}"`, String(del.etag))

  const remaining = await req(OWNER, 'GET', '/task/api/boards')
  const ids = ((remaining.json as { boards: Array<{ id: string }> }).boards ?? []).map(b => b.id)
  check(
    'GET /boards shows only main and keep',
    JSON.stringify(ids.sort()) === '["keep","main"]',
    JSON.stringify(ids)
  )
  for (const id of ['alpha', 'beta', 'gamma']) {
    check(
      `${id}: no tasks left`,
      (await count(
        'SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND board_id = ?',
        OWNER,
        id
      )) === 0
    )
    check(
      `${id}: no pin row left`,
      (await count(
        'SELECT COUNT(*) AS n FROM board_prefs WHERE user_id = ? AND board_id = ?',
        OWNER,
        id
      )) === 0
    )
  }
  check(
    "keep's tasks survive",
    (await count(
      'SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND board_id = ?',
      OWNER,
      'keep'
    )) === 2
  )
  check(
    "keep's pin survives",
    (await count(
      'SELECT COUNT(*) AS n FROM board_prefs WHERE user_id = ? AND board_id = ?',
      OWNER,
      'keep'
    )) === 1
  )

  section('3. Nothing orphaned, nobody else touched')
  const orphans = await countOrphans(d1 as unknown as Parameters<typeof countOrphans>[0])
  check('no task without a board', orphans.orphanTasks === 0, JSON.stringify(orphans))
  check('no sentinel rows', orphans.sentinelRows === 0, JSON.stringify(orphans))
  check(
    "the other user's alpha and its tasks are intact",
    (await count(
      'SELECT COUNT(*) AS n FROM boards WHERE user_id = ? AND id = ?',
      OTHER,
      'alpha'
    )) === 1 &&
      (await count(
        'SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND board_id = ?',
        OTHER,
        'alpha'
      )) === 2
  )

  section('4. Repeating it is harmless')
  const again = await req(OWNER, 'POST', '/task/api/batch/delete-boards', {
    boardIds: ['alpha', 'beta']
  })
  const againBody = again.json as { deleted?: string[]; notFound?: string[] }
  check(
    'every id comes back notFound, still 200',
    again.status === 200 &&
      JSON.stringify(againBody.deleted) === '[]' &&
      JSON.stringify(againBody.notFound) === '["alpha","beta"]',
    `status=${again.status} ${JSON.stringify(again.json)}`
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
