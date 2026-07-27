/**
 * Board-calendar runtime verification (§9) + the two API fixes that shipped with it.
 *
 * Boots the REAL worker (TASK_STORAGE=d1) against a REAL SQLite DB and drives it
 * as four users at DIFFERENT TIERS — that tier spread is the point of §4 below.
 * Proves:
 *
 *   1. A calendar is a PROPERTY of a board: every board carries `calendar`
 *      { ref, name, canWrite, scheduled }, and GET /boards/{ref}/calendar returns
 *      that board's dated tasks, windowed by from/to and filtered by source.
 *      A task with no date is on the board but NOT on the calendar.
 *   2. THE HANDOFF'S CASE: a contributor grantee creates a timed task on a board
 *      shared with it — addressed by the `calendar.ref` it discovered, never an
 *      out-of-band identifier — then deletes it, and BOTH are visible to the
 *      owner in the owner's own calendar view.
 *   3. The board reference is accepted the same way everywhere: `board` or
 *      `boardId`, in the body or the query, on create AND on delete.
 *   4. The board lock is keyed on the OWNER, not the caller's tier: an admin
 *      owner and a service-tier grantee writing concurrently to one board
 *      serialise, so neither write is lost. Before the fix the two callers took
 *      DIFFERENT locks and saveTasks' read-modify-write dropped writes.
 *
 * Run via: pnpm run test:worker  (or `... board-calendar-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')

const TASK_EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_key TEXT NOT NULL, board_id TEXT NOT NULL,
    task_id TEXT, event_type TEXT NOT NULL, metadata TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')));`

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

const d1: FakeD1 = makeSqliteD1(MIGRATION)
d1.__raw.exec(TASK_EVENTS_DDL)

const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  SESSIONS_KV: makeSessionsKV({
    'contact-key': { userId: 'contact-uid', name: 'ContactApi', tier: 'service' },
    'reader-key': { userId: 'reader-uid', name: 'Reader', tier: 'friend' }
  })
} as Record<string, unknown>

const app = createTaskHandler()

interface Calendar {
  ref?: string
  name?: string
  canWrite?: boolean
  scheduled?: number
}
interface Board {
  id: string
  name: string
  handle?: string
  access?: string
  tasks?: Task[]
  calendar?: Calendar
}
interface Task {
  id: string
  title?: string
  state?: string
  date?: string | null
  startTime?: string | null
  source?: string | null
}
interface Body {
  boards?: Board[]
  tasks?: Task[]
  calendar?: Calendar
  board?: string
  from?: string | null
  to?: string | null
  count?: number
  ok?: boolean
  error?: string
  code?: string
}

/** The OWNER is an admin; the integration grantee is service tier. §4 needs that gap. */
interface User {
  key: string
  id: string
  tier: string
}
const OWNER: User = { key: 'owner-key', id: 'owner-uid', tier: 'admin' }
const CONTACT: User = { key: 'contact-key', id: 'contact-uid', tier: 'service' }
const READER: User = { key: 'reader-key', id: 'reader-uid', tier: 'friend' }

async function req(
  user: User,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Body | null }> {
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
  let json: Body | null = null
  try {
    json = (await res.clone().json()) as Body
  } catch {
    /* non-json */
  }
  return { status: res.status, json }
}

interface McpResult {
  structuredContent?: {
    boards?: Board[]
    tasks?: Task[]
    count?: number
    scheduled?: number
    canWrite?: boolean
    board?: { calendar?: Calendar }
  }
  isError?: boolean
  content?: { type: string; text: string }[]
}

/** Drive the MCP JSON-RPC endpoint as a user: tools/call → its result. */
async function mcp(
  user: User,
  tool: string,
  toolArgs: Record<string, unknown> = {}
): Promise<McpResult> {
  const res = await app.request(
    'http://localhost/task/api/mcp',
    {
      method: 'POST',
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': user.tier,
        'X-User-Key': user.key,
        'X-User-Id': user.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: toolArgs }
      })
    },
    env
  )
  const body = (await res.json()) as { result?: McpResult }
  return body.result ?? {}
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

async function boards(user: User): Promise<Board[]> {
  return (await req(user, 'GET', '/task/api/boards')).json?.boards ?? []
}
async function calendarOf(user: User, ref: string, query = ''): Promise<Body> {
  const r = await req(
    user,
    'GET',
    `/task/api/boards/${encodeURIComponent(ref)}/calendar${query ? `?${query}` : ''}`
  )
  return r.json ?? {}
}

const DAY_1 = '2026-08-10'
const DAY_2 = '2026-08-11'
const DAY_9 = '2026-09-01'

async function main() {
  console.log('Board calendar (§9) + board-ref alignment + owner-scoped lock')

  // ---------------------------------------------------------------------
  section('1. A calendar is a property of a board')
  // ---------------------------------------------------------------------
  await req(OWNER, 'POST', '/task/api/boards', { id: 'ops', name: 'Ops' })
  // Three tasks: one timed, one all-day, one with no date at all.
  await req(OWNER, 'POST', '/task/api', {
    id: 'timed1',
    title: 'Standup',
    boardId: 'ops',
    date: DAY_1,
    startTime: `${DAY_1}T09:00:00.000Z`,
    endTime: `${DAY_1}T09:30:00.000Z`
  })
  await req(OWNER, 'POST', '/task/api', {
    id: 'allday1',
    title: 'Release day',
    boardId: 'ops',
    date: DAY_2
  })
  await req(OWNER, 'POST', '/task/api', { id: 'undated', title: 'Someday', boardId: 'ops' })

  const opsBoard = (await boards(OWNER)).find(b => b.id === 'ops')
  check(
    'board carries a `calendar` property',
    !!opsBoard?.calendar,
    JSON.stringify(opsBoard?.tasks)
  )
  check(
    'calendar.ref is the reference that addresses this board',
    opsBoard?.calendar?.ref === 'ops',
    JSON.stringify(opsBoard?.calendar)
  )
  check(
    'calendar.name follows the board, canWrite true for the owner',
    opsBoard?.calendar?.name === 'Ops' && opsBoard?.calendar?.canWrite === true,
    JSON.stringify(opsBoard?.calendar)
  )
  check(
    'calendar.scheduled counts only the DATED tasks (2 of 3)',
    opsBoard?.calendar?.scheduled === 2,
    JSON.stringify(opsBoard?.calendar)
  )
  check('the undated task is still on the board', opsBoard?.tasks?.length === 3)

  const cal = await calendarOf(OWNER, 'ops')
  check('GET /boards/{ref}/calendar returns the dated tasks', cal.count === 2, JSON.stringify(cal))
  check(
    'calendar is ordered by day (timed DAY_1 before all-day DAY_2)',
    cal.tasks?.[0]?.id === 'timed1' && cal.tasks?.[1]?.id === 'allday1',
    JSON.stringify(cal.tasks?.map(t => t.id))
  )
  check(
    'the undated task is NOT a calendar member',
    !cal.tasks?.some(t => t.id === 'undated'),
    JSON.stringify(cal.tasks?.map(t => t.id))
  )

  // ---------------------------------------------------------------------
  section('2. Calendar windowing + provider filter')
  // ---------------------------------------------------------------------
  let win = await calendarOf(OWNER, 'ops', `from=${DAY_1}&to=${DAY_1}`)
  check(
    'from/to narrows to one day',
    win.count === 1 && win.tasks?.[0]?.id === 'timed1',
    JSON.stringify(win)
  )
  check(
    'the window echoes back what was asked for',
    win.from === DAY_1 && win.to === DAY_1,
    JSON.stringify({ from: win.from, to: win.to })
  )
  check(
    'a narrowed window still reports the calendar total',
    win.calendar?.scheduled === 2,
    JSON.stringify(win.calendar)
  )
  win = await calendarOf(OWNER, 'ops', `from=${DAY_9}`)
  check('an empty window is empty, not an error', win.count === 0, JSON.stringify(win))
  let bad = await req(OWNER, 'GET', '/task/api/boards/ops/calendar?from=August')
  check('a malformed day → 400', bad.status === 400, `status=${bad.status}`)
  bad = await req(OWNER, 'GET', '/task/api/boards/nope-not-a-board/calendar')
  check(
    'an unknown own slug resolves to that empty board (no leak, no 404)',
    bad.status === 200 && bad.json?.count === 0,
    `status=${bad.status} ${JSON.stringify(bad.json)}`
  )

  // A provider mirrors an appointment; `source` is how it finds its own again.
  await req(OWNER, 'POST', '/task/api', {
    id: 'mirrored',
    title: 'Booked call',
    boardId: 'ops',
    date: DAY_1,
    startTime: `${DAY_1}T15:00:00.000Z`,
    endTime: `${DAY_1}T15:30:00.000Z`,
    source: 'contact',
    sourceId: 'appt_1'
  })
  const mine = await calendarOf(OWNER, 'ops', 'source=contact')
  check(
    'source= returns only what that provider mirrored',
    mine.count === 1 && mine.tasks?.[0]?.id === 'mirrored',
    JSON.stringify(mine.tasks?.map(t => t.id))
  )

  // ---------------------------------------------------------------------
  section('3. A grantee writes the calendar of a board shared with it')
  // ---------------------------------------------------------------------
  const handle = (await boards(OWNER)).find(b => b.id === 'ops')?.handle as string
  let r = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    name: 'ContactApi',
    level: 'contributor'
  })
  check('owner grants the integration contributor access', r.status === 200, JSON.stringify(r.json))

  // DISCOVERY: the integration finds the board it may write, and the calendar
  // property tells it exactly what reference to use. Nothing out-of-band.
  const discovered = (await boards(CONTACT)).find(b => b.access === 'contributor')
  check('the shared board is discoverable by the grantee', !!discovered, JSON.stringify(discovered))
  check(
    'its calendar.ref is the reference that resolves FOR THE GRANTEE',
    discovered?.calendar?.ref === discovered?.id && discovered?.calendar?.ref === handle,
    JSON.stringify(discovered?.calendar)
  )
  check(
    "calendar.canWrite tells the grantee it may write, and counts the OWNER's entries",
    discovered?.calendar?.canWrite === true && discovered?.calendar?.scheduled === 3,
    JSON.stringify(discovered?.calendar)
  )

  const ref = discovered?.calendar?.ref as string
  r = await req(CONTACT, 'POST', '/task/api', {
    id: 'appt2',
    title: 'Intro call with Kate',
    board: ref,
    date: DAY_2,
    startTime: `${DAY_2}T17:00:00.000Z`,
    endTime: `${DAY_2}T17:30:00.000Z`,
    source: 'contact',
    sourceId: 'appt_2',
    metadata: { intro: 'from the contact form' }
  })
  check(
    'grantee creates a TIMED task on the shared calendar → 200',
    r.status === 200,
    `${r.status}`
  )

  // The proof the handoff asked for: visible to the OWNER, in the owner's own
  // calendar view, addressed by the owner's own slug.
  let ownerCal = await calendarOf(OWNER, 'ops')
  check(
    "the grantee's timed task is on the OWNER's calendar",
    ownerCal.tasks?.some(t => t.id === 'appt2'),
    JSON.stringify(ownerCal.tasks?.map(t => t.id))
  )
  check(
    'it kept its time + provider origin',
    ownerCal.tasks?.find(t => t.id === 'appt2')?.startTime === `${DAY_2}T17:00:00.000Z`,
    JSON.stringify(ownerCal.tasks?.find(t => t.id === 'appt2'))
  )
  // The grantee reconciles what it mirrored, through the shared ref.
  const mirrored = await calendarOf(CONTACT, ref, 'source=contact')
  check(
    'the grantee reads back BOTH contact-sourced entries through the shared ref',
    mirrored.count === 2,
    JSON.stringify(mirrored.tasks?.map(t => t.id))
  )

  // …then withdraws it.
  r = await req(CONTACT, 'DELETE', `/task/api/appt2?board=${encodeURIComponent(ref)}`)
  check('grantee deletes it → 200', r.status === 200, `status=${r.status}`)
  ownerCal = await calendarOf(OWNER, 'ops')
  check(
    "the deletion is visible to the owner (gone from the owner's calendar)",
    !ownerCal.tasks?.some(t => t.id === 'appt2'),
    JSON.stringify(ownerCal.tasks?.map(t => t.id))
  )

  // ---------------------------------------------------------------------
  section('4. A readonly grantee reads the calendar but cannot write it')
  // ---------------------------------------------------------------------
  await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    name: 'Reader',
    level: 'readonly'
  })
  const readerBoard = (await boards(READER)).find(b => b.access === 'readonly')
  check(
    'readonly grantee is told canWrite=false',
    readerBoard?.calendar?.canWrite === false,
    JSON.stringify(readerBoard?.calendar)
  )
  const readerCal = await calendarOf(READER, handle)
  check(
    'readonly grantee can READ the calendar',
    (readerCal.count ?? 0) >= 3,
    JSON.stringify(readerCal.count)
  )
  check(
    'and the calendar it reads says canWrite=false',
    readerCal.calendar?.canWrite === false,
    JSON.stringify(readerCal.calendar)
  )
  r = await req(READER, 'POST', '/task/api', {
    id: 'nope',
    title: 'should be refused',
    board: handle,
    date: DAY_1
  })
  check('readonly calendar write → 403', r.status === 403, `status=${r.status}`)

  // ---------------------------------------------------------------------
  section('5. The board reference is accepted the same way everywhere')
  // ---------------------------------------------------------------------
  // Create: body `boardId` (legacy), body `board`, and query only.
  const created = [
    { id: 'ref-body-boardid', body: { id: 'ref-body-boardid', title: 'a', boardId: 'ops' }, q: '' },
    { id: 'ref-body-board', body: { id: 'ref-body-board', title: 'b', board: 'ops' }, q: '' },
    { id: 'ref-query-board', body: { id: 'ref-query-board', title: 'c' }, q: '?board=ops' },
    { id: 'ref-query-boardid', body: { id: 'ref-query-boardid', title: 'd' }, q: '?boardId=ops' }
  ]
  for (const c of created) {
    r = await req(OWNER, 'POST', `/task/api${c.q}`, c.body)
    check(
      `create accepts the board ref via ${c.q || 'body'} → 200`,
      r.status === 200,
      `${r.status}`
    )
  }
  const opsTasks =
    (await req(OWNER, 'GET', '/task/api/tasks?board=ops')).json?.tasks?.map(t => t.id) ?? []
  check(
    'every encoding landed on the same board',
    created.every(c => opsTasks.includes(c.id)),
    JSON.stringify(opsTasks)
  )
  check(
    'GET /tasks accepts `board` as well as `boardId`',
    opsTasks.length ===
      ((await req(OWNER, 'GET', '/task/api/tasks?boardId=ops')).json?.tasks?.length ?? -1)
  )
  // Delete: the SAME two spellings, on the query — the asymmetry the handoff hit.
  r = await req(OWNER, 'DELETE', '/task/api/ref-body-boardid?boardId=ops')
  check('delete accepts ?boardId= → 200', r.status === 200, `status=${r.status}`)
  r = await req(OWNER, 'DELETE', '/task/api/ref-body-board?board=ops')
  check('delete accepts ?board= → 200', r.status === 200, `status=${r.status}`)
  const afterDelete =
    (await req(OWNER, 'GET', '/task/api/tasks?board=ops')).json?.tasks?.map(t => t.id) ?? []
  check(
    'both deletes actually removed their task',
    !afterDelete.includes('ref-body-boardid') && !afterDelete.includes('ref-body-board'),
    JSON.stringify(afterDelete)
  )
  // Complete + patch take it the same way.
  r = await req(OWNER, 'PATCH', '/task/api/ref-query-board', { board: 'ops', title: 'renamed' })
  check('patch accepts `board` in the body → 200', r.status === 200, `status=${r.status}`)
  r = await req(OWNER, 'POST', '/task/api/ref-query-board/complete?board=ops')
  check('complete accepts ?board= → 200', r.status === 200, `status=${r.status}`)

  // ---------------------------------------------------------------------
  section('6. Owner + grantee writes serialise on the SAME lock (tier-independent)')
  // ---------------------------------------------------------------------
  // The regression: the lock key used to fold in the CALLER's tier while the
  // scope was swapped to the owner, so these two callers — admin owner, service
  // grantee — took different locks for one board. saveTasks reconciles the whole
  // visible set, so the loser's rows were deleted by the winner's write.
  const before =
    (await req(OWNER, 'GET', '/task/api/tasks?board=ops')).json?.tasks?.map(t => t.id) ?? []
  const raced = [
    req(OWNER, 'POST', '/task/api', { id: 'race-o1', title: 'owner 1', board: 'ops' }),
    req(CONTACT, 'POST', '/task/api', { id: 'race-c1', title: 'grantee 1', board: handle }),
    req(OWNER, 'POST', '/task/api', { id: 'race-o2', title: 'owner 2', board: 'ops' }),
    req(CONTACT, 'POST', '/task/api', { id: 'race-c2', title: 'grantee 2', board: handle }),
    req(OWNER, 'POST', '/task/api', { id: 'race-o3', title: 'owner 3', board: 'ops' }),
    req(CONTACT, 'POST', '/task/api', { id: 'race-c3', title: 'grantee 3', board: handle })
  ]
  const results = await Promise.all(raced)
  check(
    'all six concurrent writes returned 200',
    results.every(x => x.status === 200),
    JSON.stringify(results.map(x => x.status))
  )
  const after =
    (await req(OWNER, 'GET', '/task/api/tasks?board=ops')).json?.tasks?.map(t => t.id) ?? []
  const raceIds = ['race-o1', 'race-c1', 'race-o2', 'race-c2', 'race-o3', 'race-c3']
  const missing = raceIds.filter(id => !after.includes(id))
  check(
    'no write was lost across the tier boundary (all six tasks exist)',
    missing.length === 0,
    `missing=${JSON.stringify(missing)}`
  )
  check(
    'and nothing that was already there was dropped',
    before.every(id => after.includes(id)),
    `lost=${JSON.stringify(before.filter(id => !after.includes(id)))}`
  )

  // ---------------------------------------------------------------------
  section('7. The same calendar over MCP (an agent sees the board property too)')
  // ---------------------------------------------------------------------
  const mcpBoards = (await mcp(CONTACT, 'list_boards')).structuredContent?.boards ?? []
  const mcpShared = mcpBoards.find(b => b.access === 'contributor')
  check(
    'MCP list_boards carries the shared board with its calendar',
    mcpShared?.calendar?.ref === handle,
    JSON.stringify(mcpShared?.calendar)
  )
  check(
    "MCP calendar.scheduled counts the OWNER's entries, not the caller's empty scope",
    (mcpShared?.calendar?.scheduled ?? 0) >= 3,
    JSON.stringify(mcpShared?.calendar)
  )
  const mcpCal = await mcp(CONTACT, 'get_calendar', { board: handle, source: 'contact' })
  check(
    'MCP get_calendar reads the shared calendar, filtered by provider',
    mcpCal.structuredContent?.count === 1 &&
      mcpCal.structuredContent?.tasks?.[0]?.id === 'mirrored',
    JSON.stringify(mcpCal.structuredContent ?? mcpCal.content)
  )
  check(
    'MCP get_calendar tells the caller whether it may write',
    mcpCal.structuredContent?.canWrite === true,
    JSON.stringify(mcpCal.structuredContent)
  )
  const mcpBoardCal = (await mcp(CONTACT, 'get_board', { board: handle })).structuredContent?.board
  check(
    'MCP get_board exposes the calendar as a board property',
    mcpBoardCal?.calendar?.ref === handle && (mcpBoardCal?.calendar?.scheduled ?? 0) >= 3,
    JSON.stringify(mcpBoardCal?.calendar)
  )
  const mcpStranger = await mcp(READER, 'get_calendar', { board: handle })
  check(
    'a readonly grantee reads it over MCP but is told canWrite=false',
    mcpStranger.structuredContent?.canWrite === false,
    JSON.stringify(mcpStranger.structuredContent)
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
