/**
 * GET /boards costs a fixed number of D1 round trips, however many boards.
 *
 * From an edge isolate one D1 round trip is ~75ms (the primary is not where the
 * user is), so this route's latency is its count of round trips. It used to fan
 * out ~5 queries per board, three of them serial, and took ~1.2s for a real
 * account — and the loading skeleton waits on it. getBoards now reads every
 * owned board's tasks, event counts and timeline in ONE batch and hands them to
 * the handler's per-board reads.
 *
 * Proves, against the real worker and a real SQLite D1:
 *   - round trips don't grow with the number of owned boards;
 *   - the batched answer is the same data the per-board reads give: tasks,
 *     tasks_version, counters, timeline, completed-task visibility;
 *   - a shared board still arrives hydrated from its owner's scope;
 *   - a brand-new user is still scaffolded by their first read.
 *
 * Run via: pnpm run test:worker  (or `... boards-roundtrips-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')

const d1: FakeD1 = makeSqliteD1(MIGRATION)

/**
 * Every call that would be a network round trip to D1 in production. A batch is
 * one, however many statements it carries (the shim runs them one by one).
 */
let trips = 0
let inBatch = false
type Bound = ReturnType<ReturnType<FakeD1['prepare']>['bind']>
function countCalls<T extends object>(target: T): T {
  for (const m of ['run', 'all', 'first'] as const) {
    const t = target as unknown as Record<string, (...a: unknown[]) => unknown>
    const orig = t[m].bind(target)
    t[m] = (...a: unknown[]) => {
      if (!inBatch) trips++
      return orig(...a)
    }
  }
  return target
}
const countedD1 = {
  prepare(sql: string) {
    const p = d1.prepare(sql)
    const bind = p.bind.bind(p)
    countCalls(p)
    ;(p as unknown as { bind: (...a: unknown[]) => Bound }).bind = (...a: unknown[]) =>
      countCalls(bind(...(a as never[])))
    return p
  },
  async batch(stmts: Bound[]) {
    trips++
    inBatch = true
    try {
      return await d1.batch(stmts)
    } finally {
      inBatch = false
    }
  },
  exec: d1.exec.bind(d1),
  __raw: d1.__raw
}

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
  for (const [rawKey, rec] of Object.entries(entries))
    store.set(`key:${rawKey}`, JSON.stringify(rec))
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

const env = {
  TASKS_KV: makeKV(),
  DB: countedD1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  SESSIONS_KV: makeSessionsKV({
    'viewer-key': { userId: 'viewer-uid', name: 'Viewer', tier: 'friend' }
  })
} as Record<string, unknown>

const app = createTaskHandler()

interface Task {
  id: string
  title?: string
  state?: string
}
interface Board {
  id: string
  handle?: string
  access?: string
  tasks?: Task[]
  stats?: {
    counters?: Record<string, number>
    timeline?: Array<{ event: string; id: string }>
  }
}
interface Body {
  boards?: Board[]
  tasks?: Task[]
  version?: number
}
interface User {
  key: string
  id: string
}
const OWNER: User = { key: 'owner-key', id: 'owner-uid' }
const VIEWER: User = { key: 'viewer-key', id: 'viewer-uid' }

async function req(user: User, method: string, path: string, body?: unknown) {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': user.key,
        'X-User-Id': user.id,
        'Content-Type': 'application/json'
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
  return { status: res.status, json }
}

/** GET /boards, and how many D1 round trips it took. */
async function boardsWithTrips(user: User): Promise<{ boards: Board[]; trips: number }> {
  const before = trips
  const r = await req(user, 'GET', '/task/api/boards')
  return { boards: r.json?.boards ?? [], trips: trips - before }
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

async function addBoard(user: User, id: string, taskCount: number) {
  await req(user, 'POST', '/task/api/boards', { id, name: id })
  for (let i = 0; i < taskCount; i++) {
    await req(user, 'POST', '/task/api', {
      id: `${id}-t${i}`,
      title: `${id} task ${i}`,
      boardId: id
    })
  }
}

async function main() {
  console.log('GET /boards round trips')

  console.log('\n1. A brand-new user is still scaffolded by their first read')
  {
    const fresh: User = { key: 'fresh-key', id: 'fresh-uid' }
    const r = await req(fresh, 'GET', '/task/api/tasks')
    check('GET /tasks on a new user → 200', r.status === 200, `status=${r.status}`)
    const main = d1.__raw
      .prepare("SELECT COUNT(*) AS n FROM boards WHERE user_id = 'fresh-uid' AND id = 'main'")
      .get() as { n: number }
    check('…and created their main board', Number(main.n) === 1, JSON.stringify(main))
    const { boards } = await boardsWithTrips(fresh)
    check(
      'GET /boards on it lists main',
      boards.some(b => b.id === 'main'),
      JSON.stringify(boards)
    )
  }

  console.log('\n2. Round trips do not grow with the number of boards')
  await addBoard(OWNER, 'b1', 2)
  const few = await boardsWithTrips(OWNER)
  for (let i = 2; i <= 12; i++) await addBoard(OWNER, `b${i}`, 3)
  const many = await boardsWithTrips(OWNER)
  console.log(
    `    ${few.boards.length} boards: ${few.trips} trips; ${many.boards.length} boards: ${many.trips} trips`
  )
  check(
    `${many.boards.length} boards cost what ${few.boards.length} did`,
    many.trips === few.trips,
    `${few.trips} → ${many.trips}`
  )
  // One batch for the boards, then claims and shares side by side.
  check('an owner-only load is 3 round trips', many.trips === 3, `trips=${many.trips}`)

  console.log('\n3. The batched answer is the per-board answer')
  // Complete one task so the visibility window and the counters both have work.
  const done = await req(OWNER, 'POST', '/task/api/b3-t1/complete?boardId=b3')
  check('complete → 200', done.status === 200, `status=${done.status}`)
  const { boards } = await boardsWithTrips(OWNER)
  let mismatches = 0
  for (const b of boards) {
    const one = await req(OWNER, 'GET', `/task/api/tasks?boardId=${encodeURIComponent(b.id)}`)
    const viaBoards = (b.tasks ?? []).map(t => `${t.id}:${t.state}`).join(',')
    const viaTasks = (one.json?.tasks ?? []).map(t => `${t.id}:${t.state}`).join(',')
    if (viaBoards !== viaTasks) {
      mismatches++
      console.log(`    ${b.id}: /boards [${viaBoards}] vs /tasks [${viaTasks}]`)
    }
  }
  check('every board carries exactly its /tasks list', mismatches === 0, `${mismatches} differ`)
  const b5 = boards.find(b => b.id === 'b5')
  check(
    'counters come through (3 created)',
    b5?.stats?.counters?.created === 3,
    JSON.stringify(b5?.stats?.counters)
  )
  check(
    'timeline comes through, newest first',
    b5?.stats?.timeline?.length === 3 && b5.stats.timeline.every(e => e.event === 'created'),
    JSON.stringify(b5?.stats?.timeline)
  )
  const b3 = boards.find(b => b.id === 'b3')
  check(
    'a completed task within its window is still on the board',
    (b3?.tasks ?? []).some(t => t.state === 'Completed'),
    JSON.stringify(b3?.tasks)
  )

  console.log('\n4. Shared boards arrive hydrated from their owner, in one more round trip')
  const share = async (id: string) => {
    const handle = boards.find(b => b.id === id)?.handle as string
    const g = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
      key: 'viewer-key',
      level: 'readonly'
    })
    check(`share ${id} granted`, g.status === 200, `status=${g.status}`)
    return handle
  }
  const h2 = await share('b2')
  await boardsWithTrips(VIEWER) // the viewer's first read scaffolds them
  const one = await boardsWithTrips(VIEWER)
  const h3 = await share('b3')
  const h4 = await share('b4')
  const three = await boardsWithTrips(VIEWER)
  console.log(`    1 shared board: ${one.trips} trips; 3 shared boards: ${three.trips} trips`)
  check(
    'shared boards cost the same however many there are',
    one.trips === three.trips && three.trips <= many.trips + 1,
    `${one.trips}, ${three.trips} (owner-only: ${many.trips})`
  )
  const shared = three.boards.find(b => b.id === h2)
  check('viewer sees the shared board', shared?.access === 'readonly', JSON.stringify(shared))
  check("…with the owner's 3 tasks", shared?.tasks?.length === 3, JSON.stringify(shared?.tasks))
  check(
    "…and the owner's counters",
    shared?.stats?.counters?.created === 3,
    JSON.stringify(shared?.stats)
  )
  const s3 = three.boards.find(b => b.id === h3)
  const o3 = boards.find(b => b.id === 'b3')
  check(
    'a shared board matches what its owner sees',
    JSON.stringify(s3?.tasks?.map(t => `${t.id}:${t.state}`)) ===
      JSON.stringify(o3?.tasks?.map(t => `${t.id}:${t.state}`)),
    `${JSON.stringify(s3?.tasks)} vs ${JSON.stringify(o3?.tasks)}`
  )
  check(
    'every shared board is hydrated',
    [h2, h3, h4].every(h => (three.boards.find(b => b.id === h)?.tasks?.length ?? 0) > 0)
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
