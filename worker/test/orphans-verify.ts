/**
 * GET /task/api/admin/orphans (#109): rows no route can reach, counted against
 * the REAL worker and a real sqlite D1.
 *
 *   - zero on a healthy database, including after the ordinary board delete,
 *     which removes a board's tasks in the same batch;
 *   - a task whose board row is gone is counted and named in the sample (the
 *     tasks table has no foreign key to boards, which is how prod got three);
 *   - a row owned by the 'public' sentinel is counted (#107);
 *   - admin only.
 *
 * Run via: pnpm run test:worker  (or `... orphans-verify`).
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
const env = { TASKS_KV: makeKV(), DB: d1, EDGE_AUTH_SECRET: EDGE_SECRET } as Record<string, unknown>
const app = createTaskHandler()

interface Orphans {
  orphanTasks: number
  sample: Array<{ userId: string; boardId: string; taskId: string; createdAt: string }>
  sentinelRows: number
}

async function req(
  tier: string,
  userId: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: unknown }> {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': tier,
        'X-User-Key': `key-${userId}`,
        'X-User-Id': userId,
        'Content-Type': 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    },
    env
  )
  return { status: res.status, json: await res.json() }
}

const orphans = async () =>
  (await req('admin', 'admin-uid', 'GET', '/task/api/admin/orphans')).json as Orphans

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
  section('1. A healthy database counts zero')
  const OWNER = 'owner-uid'
  for (const board of ['work', 'gone']) {
    const r = await req('friend', OWNER, 'POST', '/task/api/boards', { id: board, name: board })
    check(`create board ${board}`, r.status === 200, `status=${r.status}`)
  }
  for (const [board, id] of [
    ['work', 'kept'],
    ['gone', 'deleted-with-board']
  ]) {
    const r = await req('friend', OWNER, 'POST', '/task/api', { id, title: id, board })
    check(`create task ${id}`, r.status === 200, `status=${r.status}`)
  }
  let o = await orphans()
  check('no orphans', o.orphanTasks === 0 && o.sample.length === 0, JSON.stringify(o))
  check('no sentinel rows', o.sentinelRows === 0, JSON.stringify(o))

  section('2. The ordinary board delete leaves none behind')
  const del = await req('friend', OWNER, 'DELETE', '/task/api/boards/gone')
  check(
    'delete board → 200',
    del.status === 200,
    `status=${del.status} ${JSON.stringify(del.json)}`
  )
  o = await orphans()
  check('still no orphans', o.orphanTasks === 0, JSON.stringify(o))

  section('3. A board row deleted underneath its tasks is reported')
  await d1.prepare('DELETE FROM boards WHERE user_id = ? AND id = ?').bind(OWNER, 'work').run()
  o = await orphans()
  check('one orphan counted', o.orphanTasks === 1, JSON.stringify(o))
  check(
    'and named, so it can be acted on',
    o.sample.length === 1 &&
      o.sample[0].userId === OWNER &&
      o.sample[0].boardId === 'work' &&
      o.sample[0].taskId === 'kept' &&
      typeof o.sample[0].createdAt === 'string',
    JSON.stringify(o.sample)
  )

  section("4. A row owned by the 'public' sentinel is reported")
  await d1
    .prepare('INSERT INTO board_meta (user_id, version, updated_at) VALUES (?, 1, ?)')
    .bind('public', new Date().toISOString())
    .run()
  o = await orphans()
  check('one sentinel row counted', o.sentinelRows === 1, JSON.stringify(o))

  section('5. Admin only')
  for (const tier of ['wife', 'service', 'friend']) {
    const r = await req(tier, `${tier}-uid`, 'GET', '/task/api/admin/orphans')
    check(`${tier} → 403`, r.status === 403, `status=${r.status}`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
