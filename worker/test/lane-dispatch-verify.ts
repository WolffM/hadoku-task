/**
 * Lane-change `repository_dispatch` runtime verification (§5.2).
 *
 * When a HUMAN lands a task in a `user` lane on an automation board that records
 * a `repo`, the worker POSTs a `repository_dispatch` to that repo so the runner
 * starts in seconds instead of waiting for its cron. The predicate is deliberately
 * STRUCTURAL — "a person wrote into a lane people write, on a board wired to a
 * repo" — never "the lane is called approved", because which lanes are claimable
 * is the runner's policy and lives in the runner's repo.
 *
 * Boots the REAL worker against a REAL SQLite D1 and drives it over HTTP + MCP
 * with global `fetch` STUBBED, so every assertion is about a dispatch the worker
 * actually attempted to send: the URL, the event_type, and the payload.
 *
 * Proves:
 *   - a drag into a user lane fires exactly one dispatch, with the documented
 *     payload, to the board's repo — over the batch endpoint (what a real drag
 *     writes through), the single-task PATCH, create, and MCP;
 *   - a multi-card drag is ONE gesture, so ONE dispatch;
 *   - untagged Inbox writes fire nothing (the settle delay is the point);
 *   - `agent`-lane writes fire nothing (the pipeline's own writes);
 *   - a standard board, an automation board with no repo, and a write that
 *     doesn't touch the tag all fire nothing;
 *   - with no token binding, and with GitHub answering 404 (the shape of an
 *     under-scoped PAT) or hanging, the board write STILL SUCCEEDS;
 *   - the batch endpoint enforces lanes — a drag can't land a task in an `agent`
 *     lane that the single-task PATCH refuses.
 *
 * Run via: pnpm run test:worker  (or `... lane-dispatch-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')
const REPO = 'WolffM/tenhands'
const DISPATCH_URL = `https://api.github.com/repos/${REPO}/dispatches`

const USER = { key: 'owner-key', id: 'owner-uid' }

interface Lane {
  tag: string
  label: string
  order: number
  editableBy: 'user' | 'agent'
}

/** Shaped like TenHands': user lanes the human drives, agent lanes the runner owns. */
const LANES: Lane[] = [
  { tag: 'approved', label: 'Approved', order: 1, editableBy: 'user' },
  { tag: 'replan', label: 'Replan', order: 2, editableBy: 'user' },
  { tag: 'working', label: 'Working', order: 3, editableBy: 'agent' },
  { tag: 'landing', label: 'Landing', order: 4, editableBy: 'agent' }
]

// ---------------------------------------------------------------------------
// The fetch stub. Every outbound call the worker makes lands here, so "fired
// nothing" is a real assertion rather than the absence of a log line.
// ---------------------------------------------------------------------------
interface Sent {
  url: string
  method: string
  headers: Record<string, string>
  body: { event_type?: string; client_payload?: Record<string, unknown> }
}
const sent: Sent[] = []
/** Next dispatch responses, consumed in order; default 204. */
let responses: Array<{ status: number; body?: string; hang?: boolean }> = []

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://api.github.com/')) return realFetch(input as RequestInfo, init)

  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
    headers[k.toLowerCase()] = v
  }
  let body: Sent['body'] = {}
  try {
    body = JSON.parse(String(init?.body ?? '{}'))
  } catch {
    /* non-json body — recorded as {} */
  }
  sent.push({ url, method: init?.method ?? 'GET', headers, body })

  const next = responses.shift() ?? { status: 204 }
  if (next.hang) {
    // Never answers on its own — only the dispatch's own AbortSignal ends it,
    // which is the property under test. Rejects on abort so the caller's catch is
    // what runs, as in prod.
    //
    // The keepalive timer is load-bearing: `AbortSignal.timeout()` timers are
    // UNREF'D in node, so with nothing else pending the process would exit
    // cleanly mid-test — code 0, no summary printed, a green run that asserted
    // nothing. This ref'd timer holds the loop open long enough for the abort to
    // land, and is cleared the moment it does.
    return new Promise((_resolve, reject) => {
      const keepalive = setTimeout(() => reject(new Error('stub keepalive expired')), 30_000)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(keepalive)
        reject(new Error('aborted'))
      })
    })
  }
  return new Response(next.body ?? null, { status: next.status })
}) as typeof fetch

// ---------------------------------------------------------------------------
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

/** The worker's one GitHub binding, mutated in place to test the unconfigured case. */
const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  GITHUB_READ_TOKEN: 'test-github-pat'
} as Record<string, unknown>

const app = createTaskHandler()

interface Body {
  tasks?: Array<{ id: string; tag?: string | null }>
  ok?: boolean
  code?: string
  error?: string
  isError?: boolean
  content?: { text: string }[]
}

async function req(method: string, path: string, body?: unknown) {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': USER.key,
        'X-User-Id': USER.id,
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

async function mcp(tool: string, toolArgs: Record<string, unknown> = {}): Promise<Body> {
  const res = await app.request(
    'http://localhost/task/api/mcp',
    {
      method: 'POST',
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': USER.key,
        'X-User-Id': USER.id,
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
  const b = (await res.json()) as { result?: Body }
  return b.result ?? {}
}

/**
 * Drag `ids` into `tag` the way the board's drop handler does — the batch endpoint.
 *
 * Defaults to the LEGACY alias, because that is the one the browser actually calls:
 * `api.batchUpdateTags` posts `PATCH /task/api/batch-tag` (verified in
 * e2e/lane-drag-wakes-runner.spec.ts). The path-param form is the same handler and
 * is covered separately below, so neither alias can drift into being the unhooked one.
 */
function drag(
  board: string,
  ids: string[],
  tag: string | null,
  alias: 'legacy' | 'param' = 'legacy'
) {
  const updates = ids.map(taskId => ({ taskId, tag }))
  return alias === 'legacy'
    ? req('PATCH', '/task/api/batch-tag', { boardId: board, updates })
    : req('POST', `/task/api/boards/${board}/tasks/batch/update-tags`, { updates })
}

/** The PERSISTED tag, read out of SQLite rather than echoed by a response. */
function storedTag(id: string): string {
  const row = d1.__raw
    .prepare('SELECT tag FROM tasks WHERE user_id = ? AND id = ?')
    .get(USER.id, id) as { tag: string | null } | undefined
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

/** Dispatches sent since the last reset, then clear. */
function drained(): Sent[] {
  const out = sent.slice()
  sent.length = 0
  return out
}

async function main() {
  console.log('Lane-change repository_dispatch runtime verification')

  // ---------------------------------------------------------------------
  section('1. An automation board wired to a repo')
  // ---------------------------------------------------------------------
  await req('POST', '/task/api/boards', { id: 'flow', name: 'Flow' })
  let r = await req('POST', '/task/api/boards/flow/repo', { repo: REPO })
  check('repo saved → 200', r.status === 200, `status=${r.status}`)

  const dry = await req('POST', '/task/api/boards/flow/activate-automation', {
    schemaId: 'tenhands',
    schemaVersion: 1,
    lanes: LANES,
    dryRun: true
  })
  const digest = (dry.json as { preview?: { digest: string } })?.preview?.digest
  r = await req('POST', '/task/api/boards/flow/activate-automation', {
    schemaId: 'tenhands',
    schemaVersion: 1,
    lanes: LANES,
    expectedDigest: digest
  })
  check('activated → 200', r.status === 200, `status=${r.status}`)
  await req('POST', '/task/api', { id: 'd1', title: 'A task', boardId: 'flow' })
  check('activation itself fires nothing', drained().length === 0)

  // ---------------------------------------------------------------------
  section('2. A drag into a user lane fires exactly one dispatch')
  // ---------------------------------------------------------------------
  r = await drag('flow', ['d1'], 'approved')
  check('drag → 200', r.status === 200, `status=${r.status}`)
  check('tag persisted', storedTag('d1') === 'approved', `tag="${storedTag('d1')}"`)
  let out = drained()
  check('exactly one dispatch', out.length === 1, `count=${out.length}`)
  const one = out[0]
  check('to the board’s repo', one?.url === DISPATCH_URL, one?.url)
  check('as a POST', one?.method === 'POST', one?.method)
  check(
    'event_type is exactly "taskauto"',
    one?.body.event_type === 'taskauto',
    JSON.stringify(one?.body.event_type)
  )
  check(
    'bearer-authed with the GitHub binding',
    one?.headers.authorization === 'Bearer test-github-pat',
    JSON.stringify(one?.headers.authorization)
  )
  check(
    'sends the GitHub API version',
    one?.headers['x-github-api-version'] === '2022-11-28',
    JSON.stringify(one?.headers['x-github-api-version'])
  )
  const p = (one?.body.client_payload ?? {}) as Record<string, unknown>
  check('payload.boardId is the owner-scoped slug', p.boardId === 'flow', JSON.stringify(p))
  check('payload.taskId names what moved', p.taskId === 'd1', JSON.stringify(p))
  check('payload.lane is the destination lane', p.lane === 'approved', JSON.stringify(p))
  check(
    'payload.handle is present',
    typeof p.handle === 'string' && p.handle !== '',
    JSON.stringify(p)
  )
  check(
    'payload.at is an ISO-8601 instant',
    typeof p.at === 'string' && !Number.isNaN(Date.parse(p.at)),
    JSON.stringify(p)
  )

  // ---------------------------------------------------------------------
  section('3. Every other human lane-write surface fires too')
  // ---------------------------------------------------------------------
  r = await drag('flow', ['d1'], 'replan', 'param')
  check('the path-param batch alias → 200', r.status === 200, `status=${r.status}`)
  out = drained()
  check('the path-param batch alias fires once', out.length === 1, `count=${out.length}`)
  check('both aliases reach the same hook', out[0]?.url === DISPATCH_URL, out[0]?.url)

  await req('PATCH', '/task/api/d1', { board: 'flow', tag: 'replan' })
  out = drained()
  check('single-task PATCH fires once', out.length === 1, `count=${out.length}`)
  check(
    'and reports the new lane',
    out[0]?.body.client_payload?.lane === 'replan',
    JSON.stringify(out[0]?.body.client_payload)
  )

  await req('POST', '/task/api', {
    id: 'd2',
    title: 'Created straight into a lane',
    boardId: 'flow',
    tag: 'approved'
  })
  out = drained()
  check('create-into-a-lane fires once', out.length === 1, `count=${out.length}`)
  check('naming the created task', out[0]?.body.client_payload?.taskId === 'd2')

  const m = await mcp('update_task', { id: 'd2', board: 'flow', tag: 'replan' })
  check('MCP update_task → not an error', m.isError !== true, JSON.stringify(m.content))
  out = drained()
  check('MCP update_task fires once', out.length === 1, `count=${out.length}`)

  await mcp('create_task', { title: 'MCP task', board: 'flow', tag: 'approved' })
  out = drained()
  check('MCP create_task fires once', out.length === 1, `count=${out.length}`)

  // ---------------------------------------------------------------------
  section('4. A multi-card drag is one gesture, so one dispatch')
  // ---------------------------------------------------------------------
  await req('POST', '/task/api', { id: 'd3', title: 'Three', boardId: 'flow' })
  await req('POST', '/task/api', { id: 'd4', title: 'Four', boardId: 'flow' })
  drained()
  r = await drag('flow', ['d3', 'd4'], 'approved')
  check('multi-drag → 200', r.status === 200, `status=${r.status}`)
  check('both tags persisted', storedTag('d3') === 'approved' && storedTag('d4') === 'approved')
  out = drained()
  check('one dispatch, not two', out.length === 1, `count=${out.length}`)

  // ---------------------------------------------------------------------
  section('5. What must fire NOTHING')
  // ---------------------------------------------------------------------
  await req('POST', '/task/api', { id: 'n1', title: 'Half-formed thought', boardId: 'flow' })
  check('an untagged Inbox create fires nothing', drained().length === 0)

  await drag('flow', ['d1'], null)
  check('clearing a tag back to the Inbox fires nothing', drained().length === 0)
  check('and it really cleared', storedTag('d1') === '', `tag="${storedTag('d1')}"`)

  await req('PATCH', '/task/api/d2', { board: 'flow', title: 'Renamed only' })
  check('a write that does not touch the tag fires nothing', drained().length === 0)

  await req('POST', '/task/api/d2/complete', { board: 'flow' })
  check('completing a task fires nothing', drained().length === 0)

  // An agent lane, reached the only way it can be: the claim protocol, not a human.
  const before = storedTag('d3')
  r = await req('PATCH', '/task/api/d3', { board: 'flow', tag: 'working' })
  check('a human PATCH into an agent lane → 403', r.status === 403, `status=${r.status}`)
  check('and the tag is unchanged', storedTag('d3') === before, `tag="${storedTag('d3')}"`)
  check('a refused write fires nothing', drained().length === 0)

  // The same refusal must hold on the batch path — this is the one a real drag
  // takes, and it enforced no lanes at all before this change.
  r = await drag('flow', ['d3'], 'working')
  check('a DRAG into an agent lane → 403', r.status === 403, `status=${r.status}`)
  check('and the tag is unchanged', storedTag('d3') === before, `tag="${storedTag('d3')}"`)
  check('the refused drag fires nothing', drained().length === 0)

  r = await drag('flow', ['d3'], 'not-a-lane')
  check('a drag onto a non-lane tag → 422', r.status === 422, `status=${r.status}`)
  check('and fires nothing', drained().length === 0)

  // ---------------------------------------------------------------------
  section('6. A standard board, and an automation board with no repo')
  // ---------------------------------------------------------------------
  await req('POST', '/task/api/boards', { id: 'plain', name: 'Plain' })
  await req('POST', '/task/api', { id: 's1', title: 'Freeform', boardId: 'plain', tag: 'anything' })
  await drag('plain', ['s1'], 'whatever')
  check('a standard board fires nothing', drained().length === 0)
  check(
    'and its freeform tag still writes',
    storedTag('s1') === 'whatever',
    `tag="${storedTag('s1')}"`
  )

  await req('POST', '/task/api/boards', { id: 'norepo', name: 'No Repo' })
  const dry2 = await req('POST', '/task/api/boards/norepo/activate-automation', {
    lanes: LANES,
    dryRun: true
  })
  await req('POST', '/task/api/boards/norepo/activate-automation', {
    lanes: LANES,
    expectedDigest: (dry2.json as { preview?: { digest: string } })?.preview?.digest
  })
  await req('POST', '/task/api', { id: 'nr1', title: 'On a repo-less board', boardId: 'norepo' })
  drained()
  r = await drag('norepo', ['nr1'], 'approved')
  check('an automation board with no repo → the write still lands', r.status === 200)
  check('and it fires nothing', drained().length === 0)
  check('tag persisted', storedTag('nr1') === 'approved', `tag="${storedTag('nr1')}"`)

  // ---------------------------------------------------------------------
  section('7. A failed dispatch NEVER fails the human’s write')
  // ---------------------------------------------------------------------
  // 404 is the shape of an under-scoped PAT: GitHub answers 404, not 403, when a
  // token can't see a private repo, so this is the realistic failure.
  responses = [{ status: 404, body: '{"message":"Not Found"}' }]
  r = await drag('flow', ['d4'], 'replan')
  check('GitHub 404 → the board write still succeeds', r.status === 200, `status=${r.status}`)
  check('and the tag persisted', storedTag('d4') === 'replan', `tag="${storedTag('d4')}"`)
  check('the dispatch was attempted', drained().length === 1)

  responses = [{ status: 401, body: '{"message":"Bad credentials"}' }]
  r = await drag('flow', ['d4'], 'approved')
  check('GitHub 401 → the board write still succeeds', r.status === 200, `status=${r.status}`)
  check('and the tag persisted', storedTag('d4') === 'approved', `tag="${storedTag('d4')}"`)
  drained()

  // A hung GitHub must not hold the write open — the dispatch is timeout-bounded.
  responses = [{ status: 0, hang: true }]
  const startedAt = Date.now()
  r = await drag('flow', ['d4'], 'replan')
  const elapsed = Date.now() - startedAt
  check('a hung GitHub → the board write still succeeds', r.status === 200, `status=${r.status}`)
  check(
    'and it was the dispatch timeout that ended it, not the stub',
    elapsed >= 4_000 && elapsed < 10_000,
    `elapsed=${elapsed}ms`
  )
  check('and the tag persisted', storedTag('d4') === 'replan', `tag="${storedTag('d4')}"`)
  responses = []
  drained()

  // ---------------------------------------------------------------------
  section('8. With no token binding at all, nothing is attempted')
  // ---------------------------------------------------------------------
  delete env.GITHUB_READ_TOKEN
  r = await drag('flow', ['d4'], 'approved')
  check(
    'unconfigured install → the board write still succeeds',
    r.status === 200,
    `status=${r.status}`
  )
  check('and no dispatch is attempted', drained().length === 0)
  check('and the tag persisted', storedTag('d4') === 'approved', `tag="${storedTag('d4')}"`)

  // Restored, and it is that ONE binding the dispatch authenticates with — there is
  // no second GitHub credential to fall back to or be shadowed by.
  env.GITHUB_READ_TOKEN = 'test-github-pat'
  await drag('flow', ['d4'], 'replan')
  out = drained()
  check('the single GitHub binding arms the dispatch', out.length === 1, `count=${out.length}`)
  check(
    'and it is the token that goes out',
    out[0]?.headers.authorization === 'Bearer test-github-pat',
    JSON.stringify(out[0]?.headers.authorization)
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
