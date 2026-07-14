/**
 * Phase 0 runtime verification harness.
 *
 * Boots the REAL worker (createTaskHandler) in-process and drives it with
 * app.request() against an in-memory KV + stub D1. Verifies the additive
 * Phase-0 behaviour: DomainError→correct HTTP status (404 not 500),
 * optimistic-concurrency version/ETag, If-Match/409, and backward-compat
 * (writes without If-Match still succeed).
 *
 * Run via: node_modules/.bin/esbuild ... | node   (see scripts/run-phase0-verify.sh)
 * Not a committed test suite — a throwaway proof for the Phase-0 change.
 */
import { createTaskHandler } from '../src/index'

const EDGE_SECRET = 'test-edge-secret'

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

// Minimal D1 stub: every query resolves empty/ok. Stats path only needs these.
function makeD1() {
  const stmt: Record<string, unknown> = {
    bind: () => stmt,
    run: async () => ({ success: true, meta: {} }),
    all: async () => ({ results: [], success: true, meta: {} }),
    first: async () => null
  }
  return { prepare: () => stmt }
}

const env = { TASKS_KV: makeKV(), DB: makeD1(), EDGE_AUTH_SECRET: EDGE_SECRET }
const app = createTaskHandler()

function headers(extra: Record<string, string> = {}) {
  return {
    'X-Edge-Auth': EDGE_SECRET,
    'X-Hadoku-Tier': 'friend',
    'X-User-Key': 'sess-test-123',
    'Content-Type': 'application/json',
    ...extra
  }
}

/** The response fields these checks actually read. */
interface ResponseBody {
  version?: number
  currentVersion?: number
  code?: string
  tasks?: unknown[]
}

async function req(
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

async function main() {
  console.log('Phase 0 runtime verification\n')

  // 1. GET on empty board → 200, version 1, ETag "1"
  let r = await req('GET', '/task/api/tasks')
  check('GET empty board → 200', r.status === 200, `status=${r.status}`)
  check('GET returns version 1', r.json?.version === 1, `version=${r.json?.version}`)
  check('GET sets ETag "1"', r.etag === '"1"', `etag=${r.etag}`)

  // 2. DELETE missing task → 404 (regression: was 500)
  r = await req('DELETE', '/task/api/does-not-exist')
  check('DELETE missing → 404 (not 500)', r.status === 404, `status=${r.status}`)
  check(
    'DELETE missing → code TASK_NOT_FOUND',
    r.json?.code === 'TASK_NOT_FOUND',
    JSON.stringify(r.json)
  )

  // 3. PATCH missing task → 404
  r = await req('PATCH', '/task/api/does-not-exist', { body: { title: 'x' } })
  check('PATCH missing → 404 (not 500)', r.status === 404, `status=${r.status}`)

  // 4. COMPLETE missing task → 404
  r = await req('POST', '/task/api/does-not-exist/complete')
  check('COMPLETE missing → 404 (not 500)', r.status === 404, `status=${r.status}`)

  // 5. Create task with NO If-Match → succeeds (backward compat), version bumps to 2
  r = await req('POST', '/task/api', { body: { id: 't1', title: 'first task' } })
  check('create (no If-Match) → 200', r.status === 200, `status=${r.status}`)
  check('create returns version 2', r.json?.version === 2, `version=${r.json?.version}`)
  check('create sets ETag "2"', r.etag === '"2"', `etag=${r.etag}`)

  // 6. GET reflects new task + version
  r = await req('GET', '/task/api/tasks')
  check('GET shows 1 task', r.json?.tasks?.length === 1, `len=${r.json?.tasks?.length}`)
  check('GET version now 2', r.json?.version === 2, `version=${r.json?.version}`)

  // 7. Create with STALE If-Match "1" → 409 + currentVersion 2
  r = await req('POST', '/task/api', {
    body: { id: 't2', title: 'second' },
    headers: { 'If-Match': '"1"' }
  })
  check('stale If-Match → 409', r.status === 409, `status=${r.status}`)
  check('409 → code VERSION_CONFLICT', r.json?.code === 'VERSION_CONFLICT', JSON.stringify(r.json))
  check('409 → currentVersion 2', r.json?.currentVersion === 2, `cv=${r.json?.currentVersion}`)

  // 7b. confirm the stale write did NOT apply
  r = await req('GET', '/task/api/tasks')
  check(
    'stale write rejected (still 1 task, v2)',
    r.json?.tasks?.length === 1 && r.json?.version === 2,
    `len=${r.json?.tasks?.length} v=${r.json?.version}`
  )

  // 8. Create with CORRECT If-Match "2" → 200, version 3
  r = await req('POST', '/task/api', {
    body: { id: 't2', title: 'second' },
    headers: { 'If-Match': '2' }
  })
  check('correct If-Match → 200', r.status === 200, `status=${r.status}`)
  check('correct If-Match → version 3', r.json?.version === 3, `version=${r.json?.version}`)

  // 9. PATCH existing with correct If-Match → version 4
  r = await req('PATCH', '/task/api/t1', {
    body: { title: 'renamed' },
    headers: { 'If-Match': '3' }
  })
  check('patch existing (If-Match 3) → 200', r.status === 200, `status=${r.status}`)
  check('patch → version 4', r.json?.version === 4, `version=${r.json?.version}`)

  // 10. Complete existing with correct If-Match → version 5
  r = await req('POST', '/task/api/t1/complete', { headers: { 'If-Match': '4' } })
  check('complete (If-Match 4) → 200', r.status === 200, `status=${r.status}`)
  check('complete → version 5', r.json?.version === 5, `version=${r.json?.version}`)

  // 11. Delete existing (active) with correct If-Match → version 6
  r = await req('DELETE', '/task/api/t2', { headers: { 'If-Match': '5' } })
  check('delete active (If-Match 5) → 200', r.status === 200, `status=${r.status}`)
  check('delete → version 6', r.json?.version === 6, `version=${r.json?.version}`)

  // 12. Delete with stale If-Match → 409 (concurrency guard on delete too)
  r = await req('DELETE', '/task/api/t1', { headers: { 'If-Match': '1' } })
  check('delete stale If-Match → 409', r.status === 409, `status=${r.status}`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
