/**
 * Lazy route-group routing verification (issue #101).
 *
 * Root no longer mounts the route groups. It registers one stub per row of the
 * generated route-manifest.ts, loads the row's group on first use and forwards
 * the request to it as a separate app. Two things can go wrong with that, and
 * this pins both:
 *
 *   1. DRIFT. A route added to a group but not to the manifest is unreachable —
 *      root 404s it, and nothing else would notice. The manifest must equal what
 *      the groups actually register, in mount order (row order is precedence).
 *   2. WHAT FORWARDING DROPS. A forwarded request starts a fresh Context, so
 *      root's `c.var` and onError do not carry over on their own. Auth +
 *      identity scoping must reach the handler, the throttle must run exactly
 *      once, domain errors must still map to their status, and root's CORS must
 *      still decorate the response.
 *
 * Fix drift with `pnpm run gen:worker`. Run: pnpm run test:worker
 */
import { createTaskHandler } from '../src/index'
import { ROUTE_MANIFEST } from '../src/route-manifest'
import { collectRouteManifest } from './lib/route-manifest'
import { makeSqliteD1 } from './lib/d1-sqlite'
import { join } from 'node:path'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')
const ORIGIN = 'https://task-api.hadoku.me'

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
function section(title: string) {
  console.log(`\n${title}`)
}

/** KV that counts reads per key, so the throttle's passes can be counted. */
function makeKV() {
  const store = new Map<string, string>()
  const reads = new Map<string, number>()
  return {
    kv: {
      async get(key: string, type?: string) {
        reads.set(key, (reads.get(key) ?? 0) + 1)
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
    },
    reads
  }
}

function makeEnv() {
  const { kv, reads } = makeKV()
  return {
    env: { TASKS_KV: kv, DB: makeSqliteD1(MIGRATION), EDGE_AUTH_SECRET: EDGE_SECRET },
    reads
  }
}

function asTier(tier: string, extra: Record<string, string> = {}) {
  return {
    'X-Edge-Auth': EDGE_SECRET,
    'X-Hadoku-Tier': tier,
    'X-User-Key': `key-for-${tier}`,
    'X-User-Id': `uuid-${tier}`,
    'Content-Type': 'application/json',
    ...extra
  }
}

async function main() {
  // ---------------------------------------------------------------------
  section('1. The manifest equals the routes the groups register')
  // ---------------------------------------------------------------------
  {
    const live = await collectRouteManifest()
    const want = JSON.stringify(live)
    const have = JSON.stringify(ROUTE_MANIFEST)
    check('route-manifest.ts is current (else: pnpm run gen:worker)', want === have)
    if (want !== have) {
      const key = (r: readonly string[]) => r.join(' ')
      const liveKeys = new Set(live.map(key))
      const fileKeys = new Set(ROUTE_MANIFEST.map(key))
      for (const k of liveKeys) if (!fileKeys.has(k)) console.log(`      missing: ${k}`)
      for (const k of fileKeys) if (!liveKeys.has(k)) console.log(`      stale:   ${k}`)
    }
    check('manifest is non-trivial', ROUTE_MANIFEST.length > 40, `rows=${ROUTE_MANIFEST.length}`)
  }

  // ---------------------------------------------------------------------
  section('2. Root answers /health and 404s on its own')
  // ---------------------------------------------------------------------
  {
    const app = createTaskHandler()
    const { env } = makeEnv()
    const health = await app.request('http://localhost/task/api/health', {}, env)
    const body = (await health.json()) as { status?: string; service?: string }
    check('health is 200 ok', health.status === 200 && body.status === 'ok', JSON.stringify(body))
    check('health service name unchanged', body.service === 'task-api-adapter')

    const missing = await app.request('http://localhost/task/api/no/such/route', {}, env)
    check('an unrouted path is 404', missing.status === 404, `status=${missing.status}`)
  }

  // ---------------------------------------------------------------------
  section('3. Auth + identity scoping reach the group')
  // ---------------------------------------------------------------------
  {
    const app = createTaskHandler()
    const { env } = makeEnv()
    const res = await app.request(
      'http://localhost/task/api/validate-key',
      { method: 'POST', headers: asTier('friend') },
      env
    )
    const body = (await res.json()) as { valid?: boolean; userType?: string; userId?: string }
    check('friend validates inside the group', res.status === 200 && body.valid === true)
    check('tier crossed the forward', body.userType === 'friend', `userType=${body.userType}`)
    check(
      'X-User-Id scoping crossed the forward',
      body.userId === 'uuid-friend',
      `userId=${body.userId}`
    )

    const anon = await app.request(
      'http://localhost/task/api/validate-key',
      { method: 'POST' },
      env
    )
    const anonBody = (await anon.json()) as { valid?: boolean; userType?: string }
    check(
      'no provenance stays public inside the group',
      anonBody.valid === false && anonBody.userType === 'public'
    )
  }

  // ---------------------------------------------------------------------
  section('4. The throttle runs exactly once per forwarded request')
  // ---------------------------------------------------------------------
  {
    const app = createTaskHandler()
    const { env, reads } = makeEnv()
    // Public is a throttled tier; its scope falls back to the default session.
    for (let i = 0; i < 3; i++) await app.request('http://localhost/task/api/boards', {}, env)
    const throttleReads = [...reads].filter(([k]) => k.startsWith('throttle:'))
    const total = throttleReads.reduce((n, [, c]) => n + c, 0)
    check('3 requests → 3 throttle checks', total === 3, JSON.stringify(throttleReads))
  }

  // ---------------------------------------------------------------------
  section('5. Group responses still go through root')
  // ---------------------------------------------------------------------
  {
    const app = createTaskHandler()
    const { env } = makeEnv()
    const res = await app.request(
      'http://localhost/task/api/boards',
      { headers: asTier('friend', { Origin: ORIGIN }) },
      env
    )
    check('forwarded GET /boards is 200', res.status === 200, `status=${res.status}`)
    check(
      "root's CORS decorates a forwarded response",
      res.headers.get('Access-Control-Allow-Origin') === ORIGIN,
      `acao=${res.headers.get('Access-Control-Allow-Origin')}`
    )

    // A DomainError thrown inside a group is caught by the GROUP's onError, not
    // root's — so the group must carry the same mapping, or this is a bare 500.
    // tasks.ts has no catch, so its TaskNotFound is thrown into onError.
    const missing = await app.request(
      'http://localhost/task/api/does-not-exist',
      { method: 'DELETE', headers: asTier('friend') },
      env
    )
    const body = (await missing.json().catch(() => ({}))) as { code?: string }
    check(
      'a domain error thrown inside a group maps to 404 TASK_NOT_FOUND',
      missing.status === 404 && body.code === 'TASK_NOT_FOUND',
      `status=${missing.status} body=${JSON.stringify(body)}`
    )

    const preflight = await app.request(
      'http://localhost/task/api/boards',
      {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' }
      },
      env
    )
    check(
      'CORS preflight is answered at root',
      preflight.status === 204 && preflight.headers.get('Access-Control-Allow-Origin') === ORIGIN,
      `status=${preflight.status}`
    )
  }

  // ---------------------------------------------------------------------
  section('6. Precedence survives the split across groups')
  // ---------------------------------------------------------------------
  {
    // /batch-tag (tags-batch) is registered before tasks' PATCH /:id. If the
    // stubs lost mount order, this would reach the task route as id "batch-tag".
    const app = createTaskHandler()
    const { env } = makeEnv()
    const res = await app.request(
      'http://localhost/task/api/batch-tag',
      { method: 'PATCH', headers: asTier('friend'), body: JSON.stringify({}) },
      env
    )
    const at = ROUTE_MANIFEST.findIndex(r => r[0] === 'PATCH' && r[1] === '/task/api/batch-tag')
    const generic = ROUTE_MANIFEST.findIndex(r => r[0] === 'PATCH' && r[1] === '/task/api/:id')
    check('batch-tag row precedes the generic /:id row', at >= 0 && at < generic)
    // The batch route validates its body (400 on {}); the task route would not
    // know "batch-tag" and answer otherwise. Either way it must not be a 404.
    check(
      'PATCH /batch-tag reaches tags-batch (400 on an empty body)',
      res.status === 400,
      `status=${res.status}`
    )
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
