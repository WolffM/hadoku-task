/**
 * Tier-hierarchy runtime verification.
 *
 * Boots the REAL worker (createTaskHandler) in-process and asserts that access
 * is decided by RANK — public < friend < service < wife < admin — not by matching a
 * tier name. Every tier at or above a route's minimum must get in.
 *
 * This is the property that used to break. The gates here were hand-rolled
 * string comparisons (`auth.userType !== USER_TYPES.ADMIN`, `=== 'public'`)
 * against a USER_TYPES map that predated the `service` tier and so could not
 * name it. Exact-match gating silently locks a HIGHER tier out of a LOWER
 * tier's route — a service caller failing a friend-gated route — which is
 * exactly backwards. The gates now go through `tierAtLeast` from
 * @wolffm/worker-utils; these checks pin that behaviour.
 *
 * Run: pnpm run test:worker
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
    },
    async list() {
      return { keys: [...store.keys()].map(name => ({ name })), list_complete: true }
    }
  }
}

// Minimal D1 stub — these routes are gated before they reach storage.
function makeD1() {
  const stmt: Record<string, unknown> = {
    bind: () => stmt,
    run: async () => ({ success: true, meta: {} }),
    all: async () => ({ results: [], success: true, meta: {} }),
    first: async () => null
  }
  return { prepare: () => stmt }
}

const app = createTaskHandler()

function envFor() {
  return { TASKS_KV: makeKV(), DB: makeD1(), EDGE_AUTH_SECRET: EDGE_SECRET }
}

/**
 * Request as an edge-proxied caller resolved to `tier`. Provenance
 * (X-Edge-Auth) is what makes the stamped tier trustworthy; without it the
 * worker degrades the caller to public.
 */
async function asTier(
  tier: string,
  method: string,
  path: string,
  opts: { provenance?: boolean; body?: unknown } = {}
): Promise<number> {
  const headers: Record<string, string> = {
    'X-Hadoku-Tier': tier,
    'X-User-Key': `key-for-${tier}`,
    'X-User-Id': `uuid-${tier}`,
    'Content-Type': 'application/json'
  }
  if (opts.provenance !== false) headers['X-Edge-Auth'] = EDGE_SECRET

  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    },
    envFor()
  )
  return res.status
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
function section(title: string) {
  console.log(`\n${title}`)
}

// An admin-gated route and a friend-gated one.
const ADMIN_ROUTE = '/task/api/admin/throttle/some-session'
const FRIEND_ROUTE = '/task/api/validate-key'

async function main() {
  // ---------------------------------------------------------------------
  section('1. Admin-gated route admits admin only')
  // ---------------------------------------------------------------------
  check(
    'admin reaches an admin route',
    (await asTier('admin', 'GET', ADMIN_ROUTE)) !== 403,
    `status=${await asTier('admin', 'GET', ADMIN_ROUTE)}`
  )
  // `wife` belongs in this list precisely because it outranks service: the
  // reflex is to assume the highest non-admin tier reaches an admin route.
  for (const tier of ['wife', 'service', 'friend', 'public']) {
    const status = await asTier(tier, 'GET', ADMIN_ROUTE)
    check(`${tier} is refused by an admin route`, status === 403, `status=${status}`)
  }

  // ---------------------------------------------------------------------
  section('2. Friend-gated route admits friend AND everything above it')
  // ---------------------------------------------------------------------
  // The regression this guards: `service` outranks `friend`, so a service
  // caller must NOT be turned away from a friend-tier route.
  for (const tier of ['friend', 'service', 'wife', 'admin']) {
    const res = await app.request(
      'http://localhost' + FRIEND_ROUTE,
      {
        method: 'POST',
        headers: {
          'X-Edge-Auth': EDGE_SECRET,
          'X-Hadoku-Tier': tier,
          'X-User-Key': `key-for-${tier}`,
          'Content-Type': 'application/json'
        }
      },
      envFor()
    )
    const body = (await res.json()) as { valid?: boolean; userType?: string }
    check(`${tier} validates as an authenticated caller`, body.valid === true, JSON.stringify(body))
  }

  // ---------------------------------------------------------------------
  section('3. Public is not an authenticated caller')
  // ---------------------------------------------------------------------
  {
    const res = await app.request(
      'http://localhost' + FRIEND_ROUTE,
      {
        method: 'POST',
        headers: { 'X-Edge-Auth': EDGE_SECRET, 'X-Hadoku-Tier': 'public' },
        body: undefined
      },
      envFor()
    )
    const body = (await res.json()) as { valid?: boolean }
    check('public does not validate', body.valid === false, JSON.stringify(body))
  }

  // ---------------------------------------------------------------------
  section('4. A tier outside the hierarchy has no rank')
  // ---------------------------------------------------------------------
  {
    // 'authenticated' is not a tier. tierAtLeast gives it rank -1, so it must
    // fail even the lowest gate rather than being treated as some middle tier.
    const status = await asTier('authenticated', 'GET', ADMIN_ROUTE)
    check('unknown tier is refused', status === 403, `status=${status}`)
  }

  // ---------------------------------------------------------------------
  section('5. A forged tier without provenance degrades to public')
  // ---------------------------------------------------------------------
  {
    const status = await asTier('admin', 'GET', ADMIN_ROUTE, { provenance: false })
    check('direct hit claiming admin is refused', status === 403, `status=${status}`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
