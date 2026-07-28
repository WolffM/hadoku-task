/**
 * Single-tag invariant runtime verification.
 *
 * A task carries AT MOST ONE tag. The UI enforces that at every control, but
 * the UI is not the only writer: the REST API, the MCP tools and any agent all
 * reach the same handlers, so a two-token tag string sent straight to the
 * backend would have persisted and shown up on a card as two tags. This boots
 * the REAL worker (createTaskHandler) with TASK_STORAGE=d1 against a REAL
 * SQLite DB built from the prod migrations, and proves over HTTP that:
 *
 *   - POST with "a b" stores ONE tag, the LAST one — the last tag applied wins
 *   - PATCH with several tags collapses the same way
 *   - a PATCH that doesn't mention `tag` leaves the stored tag alone
 *   - the batch tag endpoint (drag-and-drop's write path) collapses too
 *   - clearing still clears
 *
 * Assertions read straight out of SQLite, so they prove what was PERSISTED, not
 * what a response body happened to echo back.
 *
 * Run via: pnpm run test:worker  (or `... single-tag-verify`).
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')
const USER = 'sess-single-tag-user'

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

async function req(env: unknown, method: string, path: string, body?: unknown) {
  const res = await app.request(
    'http://localhost' + path,
    { method, headers: headers(), body: body !== undefined ? JSON.stringify(body) : undefined },
    env
  )
  let json: Record<string, unknown> | null = null
  try {
    json = await res.clone().json()
  } catch {
    /* non-json */
  }
  return { status: res.status, json }
}

/** The PERSISTED tag, read out of SQLite rather than echoed by a response. */
function storedTag(id: string): string {
  const row = d1.__raw
    .prepare('SELECT tag FROM tasks WHERE user_id = ? AND id = ?')
    .get(USER, id) as { tag: string | null } | undefined
  return row?.tag ?? ''
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
  console.log('Single-tag invariant runtime verification')
  const env = makeEnv()

  // ---------------------------------------------------------------------
  section('1. create collapses a multi-token tag to the last one')
  // ---------------------------------------------------------------------
  let r = await req(env, 'POST', '/task/api', { id: 'st-1', title: 'Many tags', tag: 'alpha beta' })
  check('create → 200', r.status === 200, `status=${r.status}`)
  check('stored tag is "beta"', storedTag('st-1') === 'beta', `tag="${storedTag('st-1')}"`)

  await req(env, 'POST', '/task/api', { id: 'st-2', title: 'One tag', tag: 'solo' })
  check('a single tag is untouched', storedTag('st-2') === 'solo', `tag="${storedTag('st-2')}"`)

  await req(env, 'POST', '/task/api', { id: 'st-3', title: 'No tag' })
  check('no tag stays empty', storedTag('st-3') === '', `tag="${storedTag('st-3')}"`)

  // ---------------------------------------------------------------------
  section('2. update collapses the same way, and leaves an untouched tag alone')
  // ---------------------------------------------------------------------
  r = await req(env, 'PATCH', '/task/api/st-2', { tag: 'one two three' })
  check('patch → 200', r.status === 200, `status=${r.status}`)
  check('stored tag is "three"', storedTag('st-2') === 'three', `tag="${storedTag('st-2')}"`)

  r = await req(env, 'PATCH', '/task/api/st-2', { title: 'Renamed only' })
  check(
    'a patch that omits `tag` does not disturb it',
    storedTag('st-2') === 'three',
    `tag="${storedTag('st-2')}"`
  )

  r = await req(env, 'PATCH', '/task/api/st-2', { tag: '' })
  check('clearing still clears', storedTag('st-2') === '', `tag="${storedTag('st-2')}"`)

  // ---------------------------------------------------------------------
  section('3. the batch endpoint — what drag-and-drop writes — collapses too')
  // ---------------------------------------------------------------------
  r = await req(env, 'POST', '/task/api/boards/main/tasks/batch/update-tags', {
    updates: [
      { taskId: 'st-1', tag: 'gamma delta' },
      { taskId: 'st-3', tag: 'epsilon' }
    ]
  })
  check('batch update → 200', r.status === 200, `status=${r.status}`)
  check(
    'batched multi-tag collapses to "delta"',
    storedTag('st-1') === 'delta',
    `tag="${storedTag('st-1')}"`
  )
  check(
    'batched single tag lands as-is',
    storedTag('st-3') === 'epsilon',
    `tag="${storedTag('st-3')}"`
  )

  // ---------------------------------------------------------------------
  section('4. whitespace noise never becomes a second tag')
  // ---------------------------------------------------------------------
  await req(env, 'POST', '/task/api', { id: 'st-4', title: 'Padded', tag: '  spaced  ' })
  check('padding is trimmed away', storedTag('st-4') === 'spaced', `tag="${storedTag('st-4')}"`)

  // Nothing on the board may hold more than one tag after all of the above.
  const rows = d1.__raw.prepare('SELECT id, tag FROM tasks WHERE user_id = ?').all(USER) as Array<{
    id: string
    tag: string | null
  }>
  const offenders = rows.filter(
    row => (row.tag ?? '').trim().split(/\s+/).filter(Boolean).length > 1
  )
  check(
    'no task on the board holds two tags',
    offenders.length === 0,
    offenders.map(o => `${o.id}="${o.tag}"`).join(', ')
  )

  // ---------------------------------------------------------------------
  section('5. migration 0006 cleans up rows written before the invariant')
  // ---------------------------------------------------------------------
  // Legacy rows are seeded through SQL, not the API — the handlers would
  // collapse them on the way in, which is exactly what the migration is for the
  // absence of. Then the REAL migration file runs against them.
  const legacy: Array<[string, string, string]> = [
    // id, stored tag, expected after collapse
    ['mig-1', 'alpha beta', 'beta'],
    ['mig-2', 'solo', 'solo'],
    ['mig-3', 'one two three', 'three'],
    ['mig-4', '  padded  ', 'padded'],
    ['mig-5', 'a  b', 'b'],
    // A tag that CONTAINS the one before it: the collapse is by offset, not by
    // pattern, so "plan plan-review" must not chew itself into fragments.
    ['mig-6', 'plan plan-review', 'plan-review'],
    ['mig-7', '   ', '']
  ]
  for (const [id, tag] of legacy) {
    d1.__raw
      .prepare(
        `INSERT INTO tasks (id, user_id, board_id, title, tag, state, created_at, updated_at)
         VALUES (?, ?, 'main', 'legacy', ?, 'Active', ?, ?)`
      )
      .run(id, USER, tag, new Date().toISOString(), new Date().toISOString())
  }
  check(
    'legacy rows really went in with their multi-token tags',
    storedTag('mig-1') === 'alpha beta',
    `tag="${storedTag('mig-1')}"`
  )

  d1.__raw.exec(readFileSync(join(MIGRATION, '0006_collapse_multi_tag.sql'), 'utf8'))

  for (const [id, before, after] of legacy) {
    check(`"${before}" → "${after}"`, storedTag(id) === after, `tag="${storedTag(id)}"`)
  }

  // Applying it twice must be a no-op, not a second bite out of the tag.
  d1.__raw.exec(readFileSync(join(MIGRATION, '0006_collapse_multi_tag.sql'), 'utf8'))
  for (const [id, before, after] of legacy) {
    check(
      `re-running leaves "${before}" at "${after}"`,
      storedTag(id) === after,
      `tag="${storedTag(id)}"`
    )
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
