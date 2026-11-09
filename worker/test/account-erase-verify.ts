/**
 * Account-erase hook runtime verification (hadoku_site IDENTITY_MODEL R12).
 *
 * Boots the REAL worker against a REAL SQLite DB built from the shipped
 * migrations, seeds data through the real routes (plus direct rows for claims
 * and an orphan task, which no route makes on demand), and drives
 * POST /task/api/_account/erase the way the edge does. Proves:
 *
 *   - no seal, a wrong seal, or a seal with no X-User-Id → 401, nothing erased;
 *   - the person's unshared boards, their tasks (orphans included), claims,
 *     claim log, stats events and pins are erased, and their access to other
 *     people's boards is revoked;
 *   - a board shared with someone else (a person, or the automation runner)
 *     stays whole, still owned by the erased id, and a grantee keeps using it
 *     without resurrecting a default board under the dead id;
 *   - a claim the person holds as an agent on someone else's board stays;
 *   - nobody else's rows change;
 *   - a second call answers zeros;
 *   - a person who shared nothing leaves no row anywhere.
 *
 * Run via: pnpm run test:worker  (or `... account-erase-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { ERASED_TABLES, type ErasedCounts } from '../src/account-erase'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')
const PATH = '/task/api/_account/erase'

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

function makeSessionsKV(entries: Record<string, { userId: string; name: string; tier: string }>) {
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
  name: string
}
// Real-shaped userIds: maskKey keeps 18 of 36 characters, as in prod.
const VICTIM: User = {
  key: 'victim-key',
  id: 'a1111111-1111-4111-8111-111111111111',
  name: 'Victim'
}
const FRIEND: User = { key: 'friend-key', id: 'b2222222-2222-4222-8222-222222222222', name: 'Pal' }
const RUNNER: User = {
  key: 'runner-key',
  id: 'c3333333-3333-4333-8333-333333333333',
  name: 'Runner'
}
const LONER: User = { key: 'loner-key', id: 'd4444444-4444-4444-8444-444444444444', name: 'Loner' }

const d1: FakeD1 = makeSqliteD1(MIGRATION)
const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  SESSIONS_KV: makeSessionsKV({
    [VICTIM.key]: { userId: VICTIM.id, name: VICTIM.name, tier: 'friend' },
    [FRIEND.key]: { userId: FRIEND.id, name: FRIEND.name, tier: 'friend' },
    [RUNNER.key]: { userId: RUNNER.id, name: RUNNER.name, tier: 'service' },
    [LONER.key]: { userId: LONER.id, name: LONER.name, tier: 'friend' }
  })
} as Record<string, unknown>

const app = createTaskHandler()

interface Body {
  erased?: Record<string, number>
  boards?: Array<{ id: string; handle?: string; access?: string; ownerUserId?: string }>
  tasks?: Array<{ id: string }>
  error?: string
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<{ status: number; json: Body | null }> {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    },
    env
  )
  const text = await res.text()
  let json: Body | null = null
  try {
    json = JSON.parse(text) as Body
  } catch {
    json = null
  }
  return { status: res.status, json }
}

/** As a signed-in user through the edge (friend tier, so they may share). */
const as = (u: User, method: string, path: string, body?: unknown) =>
  call(
    method,
    path,
    {
      'X-Edge-Auth': EDGE_SECRET,
      'X-Hadoku-Tier': 'friend',
      'X-User-Key': u.key,
      'X-User-Id': u.id
    },
    body
  )

/** Exactly what edge-router's eraseMemberData sends. */
const edgeErase = (userId: string) =>
  call('POST', PATH, { 'X-Edge-Auth': EDGE_SECRET, 'X-Hadoku-Tier': 'member', 'X-User-Id': userId })

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

const raw = d1.__raw
const count = (sql: string, ...args: string[]) =>
  Number((raw.prepare(sql).get(...args) as { n: number }).n)

/** Every row in every table, as one string per row, for a before/after diff. */
function snapshot(): Set<string> {
  const rows = new Set<string>()
  for (const t of ERASED_TABLES) {
    for (const r of raw.prepare(`SELECT * FROM ${t}`).all()) rows.add(`${t} ${JSON.stringify(r)}`)
  }
  return rows
}

const zeros = Object.fromEntries(ERASED_TABLES.map(t => [t, 0])) as ErasedCounts

async function seed() {
  // VICTIM: an unshared board, one shared with FRIEND, one with the runner.
  for (const [id, name] of [
    ['solo', 'Solo'],
    ['team', 'Team'],
    ['auto', 'Auto']
  ]) {
    await as(VICTIM, 'POST', '/task/api/boards', { id, name })
  }
  await as(VICTIM, 'POST', '/task/api', { id: 's1', title: 'solo one', boardId: 'solo' })
  await as(VICTIM, 'POST', '/task/api', { id: 's2', title: 'solo two', boardId: 'solo' })
  await as(VICTIM, 'POST', '/task/api', { id: 't1', title: 'team one', boardId: 'team' })
  await as(VICTIM, 'POST', '/task/api', { id: 'm1', title: 'on main', boardId: 'main' })
  await as(VICTIM, 'POST', '/task/api', { id: 'a1', title: 'auto one', boardId: 'auto' })
  await as(VICTIM, 'PUT', '/task/api/boards/pinned', { order: ['solo', 'team'] })

  const handleOf = async (u: User, slug: string) =>
    ((await as(u, 'GET', '/task/api/boards')).json?.boards ?? []).find(b => b.id === slug)
      ?.handle as string
  const team = await handleOf(VICTIM, 'team')
  const auto = await handleOf(VICTIM, 'auto')
  const g1 = await as(VICTIM, 'POST', `/task/api/boards/${team}/shares`, {
    name: FRIEND.name,
    level: 'contributor'
  })
  const g2 = await as(VICTIM, 'POST', `/task/api/boards/${auto}/shares`, {
    name: RUNNER.name,
    level: 'contributor'
  })

  // FRIEND: contributes to VICTIM's team board, and shares their own with VICTIM.
  await as(FRIEND, 'POST', '/task/api', { id: 'ft1', title: 'pal on team', boardId: team })
  await as(FRIEND, 'POST', '/task/api/boards', { id: 'palboard', name: 'Pal board' })
  await as(FRIEND, 'POST', '/task/api', { id: 'p1', title: 'pal one', boardId: 'palboard' })
  const pal = await handleOf(FRIEND, 'palboard')
  const g3 = await as(FRIEND, 'POST', `/task/api/boards/${pal}/shares`, {
    name: VICTIM.name,
    level: 'contributor'
  })

  // Rows no route makes on demand: pins of a shared board (a grantee's and the
  // victim's own), claims and their log, and a task whose board is gone.
  const ts = '2026-11-01T00:00:00.000Z'
  const ins = (sql: string, ...a: string[]) => raw.prepare(sql).run(...a)
  ins(
    'INSERT INTO board_prefs (user_id, owner_id, board_id, pinned, position) VALUES (?, ?, ?, 1, 0)',
    FRIEND.id,
    VICTIM.id,
    'team'
  )
  ins(
    'INSERT INTO board_prefs (user_id, owner_id, board_id, pinned, position) VALUES (?, ?, ?, 1, 0)',
    VICTIM.id,
    FRIEND.id,
    'palboard'
  )
  const claim = `INSERT INTO task_claims (user_id, board_id, task_id, agent_id, token, claimed_at, expires_at, heartbeat_at)
                 VALUES (?, ?, ?, ?, 'tok', ?, ?, ?)`
  ins(claim, VICTIM.id, 'solo', 's1', VICTIM.id, ts, ts, ts)
  ins(claim, VICTIM.id, 'auto', 'a1', RUNNER.id, ts, ts, ts)
  ins(claim, FRIEND.id, 'palboard', 'p1', VICTIM.id, ts, ts, ts)
  const log = `INSERT INTO task_claim_log (user_id, board_id, task_id, agent_id, claimed_at) VALUES (?, ?, ?, ?, ?)`
  ins(log, VICTIM.id, 'solo', 's2', VICTIM.id, ts)
  ins(log, VICTIM.id, 'auto', 'a1', RUNNER.id, ts)
  ins(log, FRIEND.id, 'palboard', 'p1', VICTIM.id, ts)
  // Trackers: one on solo (erased) and one on team (shared, so kept).
  const tracker = `INSERT INTO trackers (user_id, board_id, id, name, created_at, updated_at) VALUES (?, ?, ?, 'T', ?, ?)`
  ins(tracker, VICTIM.id, 'solo', 'tk-solo', ts, ts)
  ins(tracker, VICTIM.id, 'team', 'tk-team', ts, ts)
  const entry = `INSERT INTO tracker_entries (user_id, board_id, tracker_id, id, delta, value, at) VALUES (?, ?, ?, ?, 1, 1, ?)`
  ins(entry, VICTIM.id, 'solo', 'tk-solo', 'te-solo', ts)
  ins(entry, VICTIM.id, 'team', 'tk-team', 'te-team', ts)
  ins(
    `INSERT INTO tasks (user_id, board_id, id, title, state, created_at) VALUES (?, 'gone', 'orphan', 'orphan', 'Active', ?)`,
    VICTIM.id,
    ts
  )

  // LONER: one board, one task, shares nothing.
  await as(LONER, 'POST', '/task/api/boards', { id: 'mine', name: 'Mine' })
  await as(LONER, 'POST', '/task/api', { id: 'l1', title: 'loner one', boardId: 'mine' })

  return { team, auto, pal, grants: [g1.status, g2.status, g3.status] }
}

const victimKey = VICTIM.id.slice(0, 18)
const victimEvents = (board: string) =>
  count('SELECT count(*) n FROM task_events WHERE user_key = ? AND board_id = ?', victimKey, board)

async function main() {
  console.log('Account-erase hook runtime verification (R12)')

  section('1. Seed through the real routes')
  const { team, auto, grants } = await seed()
  check(
    'every share grant → 200',
    grants.every(s => s === 200),
    JSON.stringify(grants)
  )
  check(
    'victim owns solo, team, auto and main',
    count('SELECT count(*) n FROM boards WHERE user_id = ?', VICTIM.id) === 4
  )
  // A grantee's write on a shared board is logged in the OWNER's stats: team
  // holds the victim's t1 and FRIEND's ft1.
  check(
    "task creation logged stats events under the owner's masked userId",
    victimEvents('solo') === 2 && victimEvents('team') === 2,
    `solo=${victimEvents('solo')} team=${victimEvents('team')}`
  )
  const friendTeamEvents = victimEvents('team')

  section('2. Refusals erase nothing')
  const before = snapshot()
  const refusals: Array<[string, Record<string, string>]> = [
    ['no seal', { 'X-Hadoku-Tier': 'member', 'X-User-Id': VICTIM.id }],
    [
      'a wrong seal',
      { 'X-Edge-Auth': 'not-the-secret', 'X-Hadoku-Tier': 'member', 'X-User-Id': VICTIM.id }
    ],
    ['a seal with no X-User-Id', { 'X-Edge-Auth': EDGE_SECRET, 'X-Hadoku-Tier': 'member' }],
    [
      'a seal at public tier',
      { 'X-Edge-Auth': EDGE_SECRET, 'X-Hadoku-Tier': 'public', 'X-User-Id': VICTIM.id }
    ]
  ]
  for (const [what, headers] of refusals) {
    const r = await call('POST', PATH, headers)
    check(
      `${what} → 401`,
      r.status === 401 && typeof r.json?.error === 'string',
      `${r.status} ${JSON.stringify(r.json)}`
    )
  }
  const afterRefusals = snapshot()
  check(
    'no row changed',
    before.size === afterRefusals.size && [...before].every(r => afterRefusals.has(r))
  )
  const getR = await call('GET', PATH, { 'X-Edge-Auth': EDGE_SECRET, 'X-User-Id': VICTIM.id })
  check('GET is not the hook (404)', getR.status === 404, String(getR.status))

  section('3. The edge erases the victim')
  const first = await edgeErase(VICTIM.id)
  check('→ 200', first.status === 200, JSON.stringify(first.json))
  const expected: ErasedCounts = {
    tasks: 4, // s1, s2, m1, orphan
    tracker_entries: 1, // te-solo; te-team rides the shared board
    trackers: 1, // tk-solo
    task_claims: 1, // s1 on solo
    task_claim_log: 1, // s2 on solo
    task_events: 3, // created s1, s2, m1
    board_prefs: 5, // the victim's: the pin set wrote main, solo, team, auto; + palboard
    board_shares: 1, // victim's access to palboard
    boards: 2, // solo, main
    board_meta: 0 // still owns team + auto
  }
  check(
    'erased counts are exact',
    JSON.stringify(first.json?.erased) === JSON.stringify(expected),
    `got ${JSON.stringify(first.json?.erased)}`
  )

  section('4. Shared state stays')
  const left = raw
    .prepare('SELECT id FROM boards WHERE user_id = ? ORDER BY id')
    .all(VICTIM.id)
    .map(r => (r as { id: string }).id)
  check(
    'only the shared boards remain, under the erased id',
    left.join() === 'auto,team',
    left.join()
  )
  check(
    'shared boards keep every task',
    count('SELECT count(*) n FROM tasks WHERE user_id = ?', VICTIM.id) === 3 // t1, ft1, a1
  )
  check(
    'the shared board keeps its tracker and history',
    count('SELECT count(*) n FROM trackers WHERE user_id = ?', VICTIM.id) === 1 &&
      count(
        "SELECT count(*) n FROM tracker_entries WHERE user_id = ? AND board_id = 'team'",
        VICTIM.id
      ) === 1
  )
  check(
    "the runner's claim and log on the automation board stay",
    count(
      'SELECT count(*) n FROM task_claims WHERE user_id = ? AND board_id = ?',
      VICTIM.id,
      'auto'
    ) === 1 &&
      count(
        'SELECT count(*) n FROM task_claim_log WHERE user_id = ? AND board_id = ?',
        VICTIM.id,
        'auto'
      ) === 1
  )
  check('the shared board keeps its stats events', victimEvents('team') === friendTeamEvents)
  check(
    "a grantee's pin of the shared board stays",
    count(
      'SELECT count(*) n FROM board_prefs WHERE user_id = ? AND owner_id = ?',
      FRIEND.id,
      VICTIM.id
    ) === 1
  )
  check(
    'shares to others stay',
    count('SELECT count(*) n FROM board_shares WHERE owner_user_id = ?', VICTIM.id) === 2
  )
  check(
    "the victim's claim on someone else's board stays (that board's state)",
    count(
      'SELECT count(*) n FROM task_claims WHERE user_id = ? AND agent_id = ?',
      FRIEND.id,
      VICTIM.id
    ) === 1 &&
      count(
        'SELECT count(*) n FROM task_claim_log WHERE user_id = ? AND agent_id = ?',
        FRIEND.id,
        VICTIM.id
      ) === 1
  )
  check(
    'the victim has no pin, no grant and no unshared-board event left',
    count('SELECT count(*) n FROM board_prefs WHERE user_id = ?', VICTIM.id) === 0 &&
      count('SELECT count(*) n FROM board_shares WHERE grantee_user_id = ?', VICTIM.id) === 0 &&
      victimEvents('solo') === 0 &&
      victimEvents('main') === 0
  )

  const friendTeam = await as(FRIEND, 'GET', `/task/api/tasks?boardId=${team}`)
  check(
    'the grantee still reads the shared board',
    friendTeam.status === 200 && (friendTeam.json?.tasks ?? []).length === 2,
    JSON.stringify(friendTeam.json)
  )
  const write = await as(FRIEND, 'POST', '/task/api', { id: 'ft2', title: 'after', boardId: team })
  check(
    'the grantee still writes to it',
    write.status === 200 || write.status === 201,
    String(write.status)
  )
  check(
    'that write did not resurrect a default board under the erased id',
    count('SELECT count(*) n FROM boards WHERE user_id = ? AND id = ?', VICTIM.id, 'main') === 0
  )
  const friendBoards = (await as(FRIEND, 'GET', '/task/api/boards')).json?.boards ?? []
  check(
    "the grantee's board list still holds their own board and the shared one",
    friendBoards.some(b => b.id === 'palboard') && friendBoards.some(b => b.handle === team),
    JSON.stringify(friendBoards)
  )
  const runnerAuto = await as(RUNNER, 'GET', `/task/api/tasks?boardId=${auto}`)
  check('the runner still reads the automation board', runnerAuto.status === 200)

  section("5. Nobody else's rows changed")
  const friendRows = (s: Set<string>) =>
    [...s].filter(r => r.includes(FRIEND.id) && !r.includes(VICTIM.id) && !r.includes('ft2'))
  const now = snapshot()
  const lost = friendRows(before).filter(r => !now.has(r))
  check("FRIEND's own rows are all still there", lost.length === 0, lost.join('\n'))
  check(
    "LONER's rows are untouched",
    count('SELECT count(*) n FROM tasks WHERE user_id = ?', LONER.id) === 1 &&
      count('SELECT count(*) n FROM boards WHERE user_id = ?', LONER.id) === 2
  )

  section('6. Idempotent')
  const second = await edgeErase(VICTIM.id)
  check(
    'a second call → 200 with zeros',
    second.status === 200 && JSON.stringify(second.json?.erased) === JSON.stringify(zeros),
    JSON.stringify(second.json)
  )

  section('7. A person who shared nothing leaves no row')
  const loner = await edgeErase(LONER.id)
  check(
    '→ 200, board_meta erased with the last board',
    loner.status === 200 &&
      loner.json?.erased?.boards === 2 &&
      loner.json?.erased?.board_meta === 1,
    JSON.stringify(loner.json)
  )
  const lonerKey = LONER.id.slice(0, 18)
  const residue = ERASED_TABLES.map(t => {
    const cols = (raw.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]).filter(r =>
      Object.values(r).some(v => v === LONER.id || v === lonerKey)
    )
    return `${t}:${cols.length}`
  }).filter(s => !s.endsWith(':0'))
  check('no table names the loner', residue.length === 0, residue.join(' '))
  const lonerAgain = await edgeErase(LONER.id)
  check(
    'and a second call → zeros',
    JSON.stringify(lonerAgain.json?.erased) === JSON.stringify(zeros),
    JSON.stringify(lonerAgain.json)
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
