/**
 * T5 shared-boards runtime verification — the SECURITY proof.
 *
 * Boots the REAL worker (TASK_STORAGE=d1) against a REAL SQLite DB with a mocked
 * SESSIONS_KV registry, and drives it as THREE distinct users (owner, a
 * contributor, a readonly grantee) plus a stranger. Proves §7:
 *
 *   - Isolation: with no share, a caller cannot read another user's board; a
 *     stranger passing the owner's SLUG resolves to their OWN empty board, never
 *     the owner's data.
 *   - Grant by key resolves via SESSIONS_KV; the share appears in the grantee's
 *     GET /boards with ownerUserId + access.
 *   - A contributor reads AND writes the owner's board (writes land in the
 *     owner's namespace), but is refused share management (owner-only).
 *   - A readonly grantee reads but every write → 403.
 *   - Leave removes the grantee's access.
 *
 * Run via: pnpm run test:worker  (or `... shared-boards-verify`).
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

// Mock the read-only key registry: key:{rawKey} → { userId, name }.
function makeSessionsKV(
  entries: Record<string, { userId: string; name?: string; tier?: string; retiredAt?: number }>
) {
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

const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  TASK_STORAGE_PRUNE_KV: '1',
  SESSIONS_KV: makeSessionsKV({
    'contrib-key': { userId: 'contrib-uid', name: 'TenHands', tier: 'service' },
    'reader-key': { userId: 'reader-uid', name: 'Reader', tier: 'friend' },
    // A retired row that shares the resolved user but a stale name — must be
    // skipped by the name scan (retiredAt set), exactly like isNameTaken.
    'retired-key': { userId: 'contrib-uid', name: 'GhostName', tier: 'service', retiredAt: 123 }
  })
} as Record<string, unknown>

const app = createTaskHandler()

interface Board {
  id: string
  name: string
  handle?: string
  ownerUserId?: string
  access?: string
  tasks?: Task[]
  shares?: Array<{
    granteeUserId: string
    level: string
    name?: string | null
    tier?: string | null
  }>
}
interface Task {
  id: string
  title?: string
  state?: string
}
interface ResponseBody {
  boards?: Board[]
  tasks?: Task[]
  ok?: boolean
  code?: string
  granteeUserId?: string
  granteeName?: string
  level?: string
  left?: boolean
  removed?: boolean
  error?: string
}

interface User {
  key: string
  id: string
}
const OWNER: User = { key: 'owner-key', id: 'owner-uid' }
const CONTRIB: User = { key: 'contrib-key', id: 'contrib-uid' }
const READER: User = { key: 'reader-key', id: 'reader-uid' }
const STRANGER: User = { key: 'stranger-key', id: 'stranger-uid' }

async function req(
  user: User,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: ResponseBody | null }> {
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
  let json: ResponseBody | null = null
  try {
    json = (await res.clone().json()) as ResponseBody
  } catch {
    /* non-json */
  }
  return { status: res.status, json }
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
  const r = await req(user, 'GET', '/task/api/boards')
  return r.json?.boards ?? []
}
async function tasksOn(user: User, ref: string): Promise<Task[]> {
  const r = await req(user, 'GET', `/task/api/tasks?boardId=${encodeURIComponent(ref)}`)
  return r.json?.tasks ?? []
}

interface McpResult {
  structuredContent?: { boards?: Board[]; tasks?: Task[]; count?: number; id?: string }
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
        'X-Hadoku-Tier': 'friend',
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

async function main() {
  console.log('T5 shared-boards runtime verification (security)')

  // ---------------------------------------------------------------------
  section('1. Owner sets up a board with tasks')
  // ---------------------------------------------------------------------
  await req(OWNER, 'POST', '/task/api/boards', { id: 'work', name: 'Work' })
  await req(OWNER, 'POST', '/task/api', { id: 'ot1', title: 'Owner task one', boardId: 'work' })
  await req(OWNER, 'POST', '/task/api', { id: 'ot2', title: 'Owner task two', boardId: 'work' })
  const ownerBoards = await boards(OWNER)
  const workBoard = ownerBoards.find(b => b.id === 'work')
  const handle = workBoard?.handle as string
  check('owner board has a handle', !!handle, JSON.stringify(workBoard))
  check('owner board access = owner', workBoard?.access === 'owner')
  check('owner sees 2 tasks', (await tasksOn(OWNER, 'work')).length === 2)

  // ---------------------------------------------------------------------
  section('2. Isolation before any share')
  // ---------------------------------------------------------------------
  // Contributor has no share yet: the handle must NOT resolve for them.
  let r = await req(CONTRIB, 'GET', `/task/api/tasks?boardId=${handle}`)
  check('non-grantee GET by handle → 404', r.status === 404, `status=${r.status}`)
  // A stranger passing the owner's SLUG resolves to THEIR OWN empty 'work'.
  const strangerWork = await tasksOn(STRANGER, 'work')
  check(
    "stranger's 'work' slug is their own empty board (no leak)",
    strangerWork.length === 0,
    JSON.stringify(strangerWork)
  )
  check(
    "contributor's board list excludes the owner's board",
    !(await boards(CONTRIB)).some(b => b.handle === handle)
  )

  // ---------------------------------------------------------------------
  section('3. Owner grants contributor by key (SESSIONS_KV resolution)')
  // ---------------------------------------------------------------------
  r = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    key: 'contrib-key',
    level: 'contributor'
  })
  check('grant → 200', r.status === 200, JSON.stringify(r.json))
  check(
    'grant resolved the key → userId',
    r.json?.granteeUserId === 'contrib-uid',
    JSON.stringify(r.json)
  )
  check(
    'grant returned the display name',
    r.json?.granteeName === 'TenHands',
    JSON.stringify(r.json)
  )

  // The Edit Boards / Share UI reads a board's grantees from the HYDRATED
  // GET /boards payload — fetching them per board when a panel opened made the
  // list appear late or, when the fetch hiccuped, not at all (the client reports
  // every failure as an empty list). The owner's board must carry them up front.
  const ownerBoardsAfterGrant = await boards(OWNER)
  const workWithShares = ownerBoardsAfterGrant.find(b => b.id === 'work')
  check(
    'owner GET /boards hydrates the board with its grantees',
    workWithShares?.shares?.length === 1,
    JSON.stringify(workWithShares?.shares)
  )
  check(
    'hydrated grantee carries the display name + level (not a raw userId only)',
    workWithShares?.shares?.[0]?.name === 'TenHands' &&
      workWithShares?.shares?.[0]?.level === 'contributor',
    JSON.stringify(workWithShares?.shares?.[0])
  )

  // ---------------------------------------------------------------------
  section('4. Contributor now sees + reads the shared board')
  // ---------------------------------------------------------------------
  const contribBoards = await boards(CONTRIB)
  const shared = contribBoards.find(b => b.handle === handle)
  check(
    'shared board appears in contributor GET /boards',
    !!shared,
    JSON.stringify(contribBoards.map(b => b.handle))
  )
  check(
    'shared board carries ownerUserId',
    shared?.ownerUserId === 'owner-uid',
    JSON.stringify(shared)
  )
  check(
    'shared board access = contributor',
    shared?.access === 'contributor',
    JSON.stringify(shared)
  )
  check("contributor reads the OWNER's 2 tasks", (await tasksOn(CONTRIB, handle)).length === 2)
  // Only an OWNER may see who a board is shared with — hydration must not leak
  // the grantee list to someone who merely has access to the board.
  check(
    "shared board does NOT expose the owner's grantee list to a contributor",
    shared?.shares === undefined,
    JSON.stringify(shared?.shares)
  )
  // The FRONTEND renders a board from the HYDRATED GET /boards payload, never a
  // follow-up /tasks call. So the shared board's `.tasks` in GET /boards must be
  // the OWNER's tasks — this is the "board name showed but tasks didn't / we had
  // separate task data" bug. Hydration must resolve the owner's scope.
  check(
    'shared board is hydrated with the OWNER tasks in GET /boards (not empty)',
    shared?.tasks?.length === 2,
    `n=${shared?.tasks?.length} ${JSON.stringify(shared?.tasks?.map(t => t.id))}`
  )
  check(
    'a shared board is addressed by its handle, not the owner slug',
    shared?.id === handle,
    `id=${shared?.id} handle=${handle}`
  )

  // ---------------------------------------------------------------------
  section("5. Contributor writes land in the OWNER's namespace")
  // ---------------------------------------------------------------------
  r = await req(CONTRIB, 'POST', '/task/api', {
    id: 'ct1',
    title: 'Contributor added this',
    boardId: handle
  })
  check('contributor create → 200', r.status === 200, `status=${r.status}`)
  const ownerTasksNow = await tasksOn(OWNER, 'work')
  check(
    'owner now sees 3 tasks (the write landed on the owner board)',
    ownerTasksNow.length === 3,
    `n=${ownerTasksNow.length}`
  )
  check(
    'the added task is on the owner board',
    ownerTasksNow.some(t => t.id === 'ct1')
  )
  // Complete an owner task as the contributor (complete takes boardId as a query param).
  r = await req(CONTRIB, 'POST', `/task/api/ot1/complete?boardId=${encodeURIComponent(handle)}`)
  check('contributor complete → 200', r.status === 200, `status=${r.status}`)

  // ---------------------------------------------------------------------
  section('6. Contributor cannot manage shares (owner-only)')
  // ---------------------------------------------------------------------
  r = await req(CONTRIB, 'POST', `/task/api/boards/${handle}/shares`, {
    name: 'someone',
    level: 'readonly'
  })
  check('contributor grant → 403', r.status === 403, `status=${r.status}`)
  r = await req(CONTRIB, 'GET', `/task/api/boards/${handle}/shares`)
  check('contributor list shares → 403', r.status === 403, `status=${r.status}`)

  // ---------------------------------------------------------------------
  section('7. Readonly grantee reads but cannot write')
  // ---------------------------------------------------------------------
  r = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    key: 'reader-key',
    level: 'readonly'
  })
  check('grant readonly → 200', r.status === 200, JSON.stringify(r.json))
  // Visible now: ot2 + ct1 active, plus ot1 which the contributor completed in §5
  // — completing retains a task on the board (struck through) for 24h, so the
  // reader sees all three, one of them Completed.
  const readerTasks = await tasksOn(READER, handle)
  check('reader reads the board tasks', readerTasks.length === 3, `n=${readerTasks.length}`)
  check(
    'the contributor-completed task reads as Completed',
    readerTasks.find(t => t.id === 'ot1')?.state === 'Completed',
    `state=${readerTasks.find(t => t.id === 'ot1')?.state}`
  )
  r = await req(READER, 'POST', '/task/api', {
    id: 'rx',
    title: 'should be refused',
    boardId: handle
  })
  check('reader create → 403', r.status === 403, `status=${r.status}`)
  r = await req(READER, 'POST', `/task/api/ot2/complete?boardId=${encodeURIComponent(handle)}`)
  check('reader complete → 403', r.status === 403, `status=${r.status}`)
  check(
    'reader write was NOT applied (still no rx task)',
    !(await tasksOn(OWNER, 'work')).some(t => t.id === 'rx')
  )

  // ---------------------------------------------------------------------
  section('8. MCP surface honours shares (TenHands drives MCP, not HTTP)')
  // ---------------------------------------------------------------------
  // list_boards over MCP surfaces the shared board with its handle + access.
  const mcpBoards = (await mcp(CONTRIB, 'list_boards')).structuredContent?.boards ?? []
  const mcpShared = mcpBoards.find(b => b.handle === handle)
  check('MCP list_boards shows the shared board', !!mcpShared, JSON.stringify(mcpBoards))
  check('MCP shared board access = contributor', mcpShared?.access === 'contributor')
  // A contributor create over MCP, addressed by HANDLE, lands in the owner board.
  const mcpCreate = await mcp(CONTRIB, 'create_task', { title: 'via MCP', board: handle })
  check(
    'MCP contributor create_task ok (no error)',
    !mcpCreate.isError,
    JSON.stringify(mcpCreate.content)
  )
  const ownerAfterMcp = await tasksOn(OWNER, 'work')
  check(
    'MCP contributor write landed on the OWNER board',
    ownerAfterMcp.some(t => t.title === 'via MCP'),
    `n=${ownerAfterMcp.length}`
  )
  // A contributor list_tasks over MCP reads the OWNER's tasks.
  const mcpList = await mcp(CONTRIB, 'list_tasks', { board: handle })
  check(
    'MCP contributor list_tasks reads owner tasks',
    (mcpList.structuredContent?.count ?? 0) >= 2,
    JSON.stringify(mcpList.structuredContent)
  )
  // A readonly grantee's MCP write is refused.
  const mcpReaderWrite = await mcp(READER, 'create_task', { title: 'nope', board: handle })
  check(
    'MCP readonly create_task → isError',
    mcpReaderWrite.isError === true,
    JSON.stringify(mcpReaderWrite)
  )
  check(
    'MCP readonly write NOT applied',
    !(await tasksOn(OWNER, 'work')).some(t => t.title === 'nope')
  )
  // A non-grantee cannot address the board by handle over MCP.
  const mcpStranger = await mcp(STRANGER, 'list_tasks', { board: handle })
  check(
    'MCP non-grantee list_tasks by handle → isError',
    mcpStranger.isError === true,
    JSON.stringify(mcpStranger)
  )

  // ---------------------------------------------------------------------
  section('9. Grant edge cases')
  // ---------------------------------------------------------------------
  r = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    key: 'never-signed-in',
    level: 'readonly'
  })
  check('grant to unknown key → 400', r.status === 400, JSON.stringify(r.json))

  // ---------------------------------------------------------------------
  section("10. Leave removes the grantee's access")
  // ---------------------------------------------------------------------
  r = await req(CONTRIB, 'DELETE', `/task/api/boards/${handle}/shares/me`)
  check('contributor leave → 200', r.status === 200, JSON.stringify(r.json))
  check(
    'shared board gone from contributor list',
    !(await boards(CONTRIB)).some(b => b.handle === handle)
  )
  r = await req(CONTRIB, 'GET', `/task/api/tasks?boardId=${handle}`)
  check('contributor can no longer read the board → 404', r.status === 404, `status=${r.status}`)

  // ---------------------------------------------------------------------
  section('11. Grant by DISPLAY NAME, not a raw key (TenHands ask)')
  // ---------------------------------------------------------------------
  // Owner grants by name — no credential changes hands. Re-adds the contributor
  // that just left, resolved from the registry by name.
  r = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    name: 'TenHands',
    level: 'contributor'
  })
  check('grant by name → 200', r.status === 200, JSON.stringify(r.json))
  check(
    'name resolved to the right userId',
    r.json?.granteeUserId === 'contrib-uid',
    JSON.stringify(r.json)
  )
  const granted = (
    r.json as unknown as { granted?: { name?: string; tier?: string; level?: string } }
  ).granted
  check(
    'response echoes granted name + tier + level',
    granted?.name === 'TenHands' && granted?.tier === 'service' && granted?.level === 'contributor',
    JSON.stringify(granted)
  )
  check('the named grantee can now read the board', (await tasksOn(CONTRIB, handle)).length >= 1)
  // Case-insensitive, matching isNameTaken.
  r = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    name: 'tenhands',
    level: 'contributor'
  })
  check(
    'grant by name is case-insensitive → 200',
    r.status === 200 && r.json?.granteeUserId === 'contrib-uid',
    JSON.stringify(r.json)
  )
  // Unknown name → 404 NAME_NOT_FOUND.
  r = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    name: 'nobody-here',
    level: 'contributor'
  })
  check(
    'unknown name → 404 NAME_NOT_FOUND',
    r.status === 404 && r.json?.code === 'NAME_NOT_FOUND',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )
  // A retired row with that name is skipped (never resolves).
  r = await req(OWNER, 'POST', `/task/api/boards/${handle}/shares`, {
    name: 'GhostName',
    level: 'contributor'
  })
  check(
    'retired row name → 404 (excluded like isNameTaken)',
    r.status === 404 && r.json?.code === 'NAME_NOT_FOUND',
    `status=${r.status} ${JSON.stringify(r.json)}`
  )

  // ---------------------------------------------------------------------
  section('12. Display-name autocomplete search (share UI)')
  // ---------------------------------------------------------------------
  interface SearchBody {
    users?: Array<{ name: string; tier?: string }>
  }
  r = await req(OWNER, 'GET', '/task/api/users/search?q=ten')
  let users = (r.json as unknown as SearchBody).users ?? []
  check(
    'search "ten" finds TenHands with tier',
    users.some(u => u.name === 'TenHands' && u.tier === 'service'),
    JSON.stringify(users)
  )
  r = await req(OWNER, 'GET', '/task/api/users/search?q=GHOST')
  users = (r.json as unknown as SearchBody).users ?? []
  check(
    'search excludes retired names',
    !users.some(u => u.name === 'GhostName'),
    JSON.stringify(users)
  )
  r = await req(OWNER, 'GET', '/task/api/users/search?q=')
  users = (r.json as unknown as SearchBody).users ?? []
  check('empty query → no results', users.length === 0)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
