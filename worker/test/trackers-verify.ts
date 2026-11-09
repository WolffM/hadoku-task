/**
 * Tracker-board runtime verification.
 *
 * Boots the REAL worker against a REAL SQLite DB built from worker/migrations
 * and drives it as users at different tiers. Proves:
 *
 *   1. Only wife tier and up can create or use a tracker board; a friend gets
 *      403 FORBIDDEN on every route.
 *   2. A tracker board is a board row with mode 'tracker' (GET /boards says so),
 *      and the tracker routes refuse a standard board with BOARD_NOT_TRACKER.
 *   3. Counter entries add, subtract and reset; every change is a history row
 *      whose `value` is the tracker's value after it. Deleting an entry undoes it.
 *   4. A value tracker records each value, refuses a bare delta, and falls back
 *      to the newest remaining entry when one is deleted.
 *   5. Concurrent hits never lose a count.
 *   6. Sharing: a readonly grantee reads but cannot log; a contributor logs and
 *      is recorded as the actor.
 *   7. Deleting the board, or erasing the account, removes trackers + history.
 *
 * Run via: pnpm run test:worker trackers-verify
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { eraseAccountData } from '../src/account-erase'
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

interface User {
  key: string
  id: string
  tier: string
}
const OWNER: User = { key: 'owner-key', id: 'owner-uid', tier: 'wife' }
const ADMIN: User = { key: 'admin-key', id: 'admin-uid', tier: 'admin' }
const VIEWER: User = { key: 'viewer-key', id: 'viewer-uid', tier: 'admin' }
const FRIEND: User = { key: 'friend-key', id: 'friend-uid', tier: 'friend' }

const d1: FakeD1 = makeSqliteD1(MIGRATION)
const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  SESSIONS_KV: makeSessionsKV({
    [ADMIN.key]: { userId: ADMIN.id, name: 'Admin', tier: 'admin' },
    [VIEWER.key]: { userId: VIEWER.id, name: 'Viewer', tier: 'admin' }
  })
} as Record<string, unknown>
const app = createTaskHandler()

interface Tracker {
  id: string
  name: string
  kind: string
  unit: string | null
  value: number
}
interface Entry {
  id: string
  trackerId: string
  delta: number | null
  value: number
  source: string
  actorId: string | null
  note: string | null
}
interface Body {
  ok?: boolean
  code?: string
  error?: string
  canWrite?: boolean
  tracker?: Tracker
  trackers?: Tracker[]
  entry?: Entry
  entries?: Entry[]
  boards?: Array<{ id: string; mode?: string | null; handle?: string }>
}

async function req(user: User, method: string, path: string, body?: unknown) {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': user.tier,
        'X-User-Key': user.key,
        'X-User-Id': user.id,
        'Content-Type': 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    },
    env
  )
  let json: Body = {}
  try {
    json = (await res.clone().json()) as Body
  } catch {
    json = { error: await res.text() }
  }
  return { status: res.status, json }
}

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail: unknown = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
}
const section = (t: string) => console.log(`\n${t}`)

const tr = (ref: string, rest = '') => `/task/api/boards/${encodeURIComponent(ref)}/trackers${rest}`
const rowCount = async (sql: string, ...args: unknown[]) =>
  Number(
    (await (d1 as unknown as D1Database)
      .prepare(sql)
      .bind(...args)
      .first<number>('n')) ?? 0
  )

async function main() {
  section('1. Tier gate')
  const friendCreate = await req(FRIEND, 'POST', '/task/api/trackers/boards', { id: 'health' })
  check('a friend cannot create a tracker board', friendCreate.status === 403, friendCreate)
  check('…and is told FORBIDDEN', friendCreate.json.code === 'FORBIDDEN', friendCreate.json)

  const created = await req(OWNER, 'POST', '/task/api/trackers/boards', {
    id: 'health',
    name: 'Health'
  })
  check(
    'wife tier creates a tracker board',
    created.status === 200 && created.json.ok === true,
    created
  )
  const dup = await req(OWNER, 'POST', '/task/api/trackers/boards', { id: 'health' })
  check(
    'a taken id is 409 BOARD_EXISTS',
    dup.status === 409 && dup.json.code === 'BOARD_EXISTS',
    dup
  )

  const friendList = await req(FRIEND, 'GET', tr('health'))
  check('a friend cannot read trackers either', friendList.status === 403, friendList)

  section('2. Board mode')
  const boards = (await req(OWNER, 'GET', '/task/api/boards')).json.boards ?? []
  const health = boards.find(b => b.id === 'health')
  check('GET /boards reports mode "tracker"', health?.mode === 'tracker', boards)
  const onMain = await req(OWNER, 'GET', tr('main'))
  check(
    'a standard board is refused with BOARD_NOT_TRACKER',
    onMain.status === 409 && onMain.json.code === 'BOARD_NOT_TRACKER',
    onMain
  )
  const missing = await req(OWNER, 'GET', tr('nope'))
  check('an unknown board is 404', missing.status === 404, missing)

  section('3. Counter')
  const c1 = await req(OWNER, 'POST', tr('health'), { name: 'Pushups', unit: 'reps' })
  const pushups = c1.json.tracker as Tracker
  check('creates a counter by default', c1.status === 200 && pushups?.kind === 'counter', c1)
  check('…starting at 0', pushups?.value === 0, pushups)

  const hit = await req(OWNER, 'POST', tr('health', `/${pushups.id}/entries`), {})
  check('an empty entry counts +1', hit.json.tracker?.value === 1, hit)
  check(
    '…and records delta 1, value 1, source web',
    hit.json.entry?.delta === 1 && hit.json.entry?.value === 1 && hit.json.entry?.source === 'web',
    hit.json.entry
  )
  const plus10 = await req(OWNER, 'POST', tr('health', `/${pushups.id}/entries`), {
    delta: 10,
    note: 'set 1'
  })
  check('delta 10 adds ten', plus10.json.tracker?.value === 11, plus10)
  check('…keeping its note', plus10.json.entry?.note === 'set 1', plus10.json.entry)
  const minus = await req(OWNER, 'POST', tr('health', `/${pushups.id}/entries`), { delta: -1 })
  check('negative delta subtracts', minus.json.tracker?.value === 10, minus)
  const reset = await req(OWNER, 'POST', tr('health', `/${pushups.id}/entries`), { value: 3 })
  check('value resets a counter', reset.json.tracker?.value === 3, reset)
  check('…and logs the difference as the delta', reset.json.entry?.delta === -7, reset.json.entry)
  const both = await req(OWNER, 'POST', tr('health', `/${pushups.id}/entries`), {
    delta: 1,
    value: 1
  })
  check('delta AND value together is a 400', both.status === 400, both)

  const undo = await req(
    OWNER,
    'DELETE',
    tr('health', `/${pushups.id}/entries/${plus10.json.entry?.id}`)
  )
  check('deleting the +10 entry takes 10 back off', undo.json.tracker?.value === -7, undo)
  const list = await req(OWNER, 'GET', tr('health'))
  check('history holds the 3 remaining entries', list.json.entries?.length === 3, list.json.entries)
  check('…newest first', list.json.entries?.[0]?.id === reset.json.entry?.id, list.json.entries)
  check('owner canWrite', list.json.canWrite === true, list.json)
  const gone = await req(
    OWNER,
    'DELETE',
    tr('health', `/${pushups.id}/entries/${plus10.json.entry?.id}`)
  )
  check(
    'deleting it twice is 404 ENTRY_NOT_FOUND',
    gone.status === 404 && gone.json.code === 'ENTRY_NOT_FOUND',
    gone
  )

  section('4. Value tracker')
  const w = await req(OWNER, 'POST', tr('health'), { name: 'Weight', kind: 'value', unit: 'kg' })
  const weight = w.json.tracker as Tracker
  check('creates a value tracker', weight?.kind === 'value' && weight.unit === 'kg', w)
  const bare = await req(OWNER, 'POST', tr('health', `/${weight.id}/entries`), { delta: 1 })
  check('a value tracker refuses a delta', bare.status === 400, bare)
  const w1 = await req(OWNER, 'POST', tr('health', `/${weight.id}/entries`), { value: 82.5 })
  const w2 = await req(OWNER, 'POST', tr('health', `/${weight.id}/entries`), { value: 81.9 })
  check('logs the value', w2.json.tracker?.value === 81.9, w2)
  check('…with a null delta', w2.json.entry?.delta === null, w2.json.entry)
  const wUndo = await req(
    OWNER,
    'DELETE',
    tr('health', `/${weight.id}/entries/${w2.json.entry?.id}`)
  )
  check(
    'deleting the newest falls back to the previous value',
    wUndo.json.tracker?.value === 82.5,
    wUndo
  )
  await req(OWNER, 'DELETE', tr('health', `/${weight.id}/entries/${w1.json.entry?.id}`))
  const wEmpty = await req(OWNER, 'GET', tr('health'))
  check(
    'deleting every entry leaves 0',
    wEmpty.json.trackers?.find(t => t.id === weight.id)?.value === 0,
    wEmpty.json.trackers
  )

  section('5. Concurrency')
  const water = (await req(OWNER, 'POST', tr('health'), { name: 'Water' })).json.tracker as Tracker
  await Promise.all(
    Array.from({ length: 25 }, () => req(OWNER, 'POST', tr('health', `/${water.id}/entries`), {}))
  )
  const afterBurst = await req(OWNER, 'GET', tr('health'))
  check(
    '25 concurrent hits count 25',
    afterBurst.json.trackers?.find(t => t.id === water.id)?.value === 25,
    afterBurst.json.trackers
  )
  check(
    '…with 25 history rows',
    afterBurst.json.entries?.filter(e => e.trackerId === water.id).length === 25,
    afterBurst.json.entries?.length
  )

  section('6. Rename and order')
  const renamed = await req(OWNER, 'PATCH', tr('health', `/${water.id}`), {
    name: 'Glasses',
    unit: null
  })
  check(
    'PATCH renames and clears the unit',
    renamed.json.tracker?.name === 'Glasses' && renamed.json.tracker.unit === null,
    renamed
  )
  check('…without touching the value', renamed.json.tracker?.value === 25, renamed.json.tracker)
  const order = (await req(OWNER, 'GET', tr('health'))).json.trackers?.map(t => t.name)
  check(
    'trackers list in creation order',
    JSON.stringify(order) === '["Pushups","Weight","Glasses"]',
    order
  )

  section('7. Sharing')
  const handle = health?.handle as string
  const g1 = await req(OWNER, 'POST', `/task/api/boards/health/shares`, {
    name: 'Viewer',
    level: 'readonly'
  })
  const g2 = await req(OWNER, 'POST', `/task/api/boards/health/shares`, {
    name: 'Admin',
    level: 'contributor'
  })
  check('shares granted', g1.status === 200 && g2.status === 200, [g1, g2])
  const viewerList = await req(VIEWER, 'GET', tr(handle))
  check(
    "a readonly grantee reads the owner's trackers",
    viewerList.json.trackers?.length === 3,
    viewerList
  )
  check('…and is told canWrite=false', viewerList.json.canWrite === false, viewerList.json)
  const viewerHit = await req(VIEWER, 'POST', tr(handle, `/${water.id}/entries`), {})
  check(
    '…but cannot log',
    viewerHit.status === 403 && viewerHit.json.code === 'FORBIDDEN',
    viewerHit
  )
  const adminHit = await req(ADMIN, 'POST', tr(handle, `/${water.id}/entries`), {
    source: 'button'
  })
  check('a contributor logs', adminHit.json.tracker?.value === 26, adminHit)
  check(
    '…recorded as the actor, with its source',
    adminHit.json.entry?.actorId === ADMIN.id && adminHit.json.entry?.source === 'button',
    adminHit.json.entry
  )

  section('8. Delete tracker / board / account')
  const delT = await req(OWNER, 'DELETE', tr('health', `/${pushups.id}`))
  check('deleting a tracker succeeds', delT.status === 200, delT)
  check(
    '…and takes its history with it',
    (await rowCount(
      'SELECT COUNT(*) AS n FROM tracker_entries WHERE tracker_id = ?',
      pushups.id
    )) === 0
  )
  const delAgain = await req(OWNER, 'DELETE', tr('health', `/${pushups.id}`))
  check(
    'deleting it again is 404 TRACKER_NOT_FOUND',
    delAgain.status === 404 && delAgain.json.code === 'TRACKER_NOT_FOUND',
    delAgain
  )

  // A second board to delete outright.
  await req(OWNER, 'POST', '/task/api/trackers/boards', { id: 'gym' })
  const lift = (await req(OWNER, 'POST', tr('gym'), { name: 'Lifts' })).json.tracker as Tracker
  await req(OWNER, 'POST', tr('gym', `/${lift.id}/entries`), {})
  const delBoard = await req(OWNER, 'DELETE', '/task/api/boards/gym')
  check('deleting a tracker board succeeds', delBoard.status === 200, delBoard)
  check(
    '…and removes its trackers and entries',
    (await rowCount("SELECT COUNT(*) AS n FROM trackers WHERE board_id = 'gym'")) === 0 &&
      (await rowCount("SELECT COUNT(*) AS n FROM tracker_entries WHERE board_id = 'gym'")) === 0
  )

  // Erase: a board someone else shares is KEPT (account-erase's rule), so make
  // an unshared one and check that one goes.
  await req(OWNER, 'POST', '/task/api/trackers/boards', { id: 'solo' })
  const s = (await req(OWNER, 'POST', tr('solo'), { name: 'Steps' })).json.tracker as Tracker
  await req(OWNER, 'POST', tr('solo', `/${s.id}/entries`), {})
  const erased = await eraseAccountData(d1 as never, OWNER.id)
  check(
    'account erase reports tracker rows',
    erased.trackers === 1 && erased.tracker_entries === 1,
    erased
  )
  check(
    "…and keeps the shared board's trackers",
    (await rowCount("SELECT COUNT(*) AS n FROM trackers WHERE board_id = 'health'")) === 2
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
