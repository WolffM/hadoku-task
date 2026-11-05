/**
 * The REAL prefs-api worker, served locally on :3003 behind an edge-router shim.
 *
 * WHY THIS EXISTS
 * ---------------
 * @wolffm/prefs-client talks to `https://hadoku.me/prefs` unless told otherwise,
 * so before this file the only way to keep an E2E run off production was to
 * intercept `/prefs/api/v1/*` with Playwright routes. Those interceptors were
 * not a neutral stand-in — they hid a real bug for months. `useThemePrefsMigration`
 * bailed whenever the shared row read back as null, and the specs never noticed
 * because they only ever mocked the 'task' row; the 'portfolio' request escaped
 * to hadoku.me, where a row that FAILS to resolve is indistinguishable from an
 * empty one. The mock made a permanently-disabled migration look healthy.
 *
 * So the fix is not a better mock. It is the actual worker, with actual auth and
 * an actual database, reachable at an actual URL:
 *
 *   :3003  prefs-api, fronted by the same edge-router shim
 *          shape dev-server.ts uses for :3001 — X-Edge-Auth, X-Hadoku-Tier,
 *          X-User-Key, X-User-Id — because the worker trusts edge-stamped
 *          headers (createEdgeAuth) and a browser can't set them itself.
 *
 * WHAT IS STILL SHIMMED, AND WHY THAT IS NOT A MOCK
 * ------------------------------------------------
 * `/session/whoami` is served here rather than by prefs-api, because in
 * production it belongs to EDGE-ROUTER, not to this worker. The shim already
 * stands in for edge-router's header injection; answering its one endpoint is
 * the same job. The system under test — prefs-api, the SDK's fetch path, its
 * cache keying, the migration — is entirely real.
 *
 * WHERE THE WORKER COMES FROM
 * ---------------------------
 * `@wolffm/e2e-harness/prefs-api`: hadoku_site's workers/prefs-api, bundled
 * whole and published from the same commit, with its migrations beside it.
 * Not a copy kept here — that would be a mock that drifts. It used to be
 * imported from a sibling ../hadoku_site checkout, which CI can never have
 * (the repo is private, and this one holds no token for it), so the nightly
 * e2e skipped every prefs-backed spec.
 *
 * THE OPERATOR, FOR SPECS THAT NEED ONE
 * -------------------------------------
 * Every caller is the dev user at friend tier, as a signed-in browser is. A spec
 * that must act as the operator (gifting avatar cosmetics: admin routes that
 * name a person through the key registry) sends `X-Dev-Tier: admin` from the
 * test runner; the browser never sends it. The registry holds the dev user's
 * row so a name resolves the way it does in production.
 */
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import prefsApi from '@wolffm/e2e-harness/prefs-api'
import { makeSqliteD1 } from './lib/d1-sqlite'
import { NO_IDLE_CLOSE } from './lib/dev-http'

const PREFS_PORT = Number(process.env.DEV_PREFS_PORT ?? 3003)
const EDGE_SECRET = 'dev-edge-secret'

/** Must match dev-server.ts's user, or the two rows key to different people. */
const USER = { key: 'dev-key', id: 'dev-uid', tier: 'friend', name: 'dev' }

// Real schema: the migration files prod runs, shipped in the same package as
// the worker. Resolved from the repo root (dev-api.mjs's cwd), not from this
// file — it runs as a bundle out of a temp dir, where there is no node_modules.
const PREFS_MIGRATIONS = join(
  dirname(
    createRequire(join(process.cwd(), 'package.json')).resolve('@wolffm/e2e-harness/package.json')
  ),
  'dist/prefs-api-migrations'
)

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
      return { keys: [...store.keys()].map(name => ({ name })) }
    }
  }
}

/** The registry row edge-router keeps for the dev user's key (worker-utils KeyRegistryRecord). */
const registry = makeKV()
await registry.put(`key:${USER.key}`, {
  name: USER.name,
  tier: USER.tier,
  createdAt: 0,
  lastSeenAt: 0,
  userId: USER.id
})

/** Tiers a spec may ask for with X-Dev-Tier. */
const SPEC_TIERS = new Set(['admin'])

const env = {
  PREFS_DB: makeSqliteD1(PREFS_MIGRATIONS),
  SESSIONS_KV: registry,
  EDGE_AUTH_SECRET: EDGE_SECRET
} as unknown as Record<string, unknown>

/**
 * Who this request is. The dev user, unless the spec set a `dev_user` cookie
 * (helpers/prefs.ts `asFreshUser`) to be someone with no rows yet.
 *
 * Device rows are isolated per test for free (a fresh context mints a fresh
 * device id), user rows are not: every spec is the same person, so one that
 * picks a theme leaves a user-scope theme every later spec inherits. A spec
 * whose premise is "this person has no shared prefs" must be a new person.
 */
function userIdOf(req: { headers: Record<string, string | string[] | undefined> }): string {
  const cookie = typeof req.headers.cookie === 'string' ? req.headers.cookie : ''
  const m = /(?:^|;\s*)dev_user=([a-z0-9-]{1,64})(?:;|$)/.exec(cookie)
  return m ? m[1] : USER.id
}

createServer(NO_IDLE_CLOSE, async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const userId = userIdOf(req)

    // Edge-router's endpoint, not prefs-api's. The SDK derives it by stripping
    // `/prefs` off apiBase, and uses the userId purely to key its localStorage
    // cache (`prefs-cache:{userId}:{appId}`).
    if (url.pathname === '/session/whoami') {
      const origin = req.headers.origin
      res
        .writeHead(200, {
          'Content-Type': 'application/json',
          ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
          'Access-Control-Allow-Credentials': 'true'
        })
        .end(
          JSON.stringify({
            valid: true,
            userId,
            userType: USER.tier,
            name: USER.name
          })
        )
      return
    }

    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length ? Buffer.concat(chunks) : undefined

    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v)
    }
    // What edge-router stamps from the session cookie in production. The worker
    // reads X-User-Id as the canonical identity and verifies X-Edge-Auth against
    // EDGE_AUTH_SECRET, so without these every request is tier 'public' and each
    // authed route answers 401.
    headers.set('X-Edge-Auth', EDGE_SECRET)
    const asked = req.headers['x-dev-tier']
    headers.delete('x-dev-tier')
    headers.set(
      'X-Hadoku-Tier',
      typeof asked === 'string' && SPEC_TIERS.has(asked) ? asked : USER.tier
    )
    headers.set('X-User-Key', USER.key)
    headers.set('X-User-Id', userId)

    // Edge-router strips the /prefs prefix before forwarding; the worker mounts
    // its routes at /api/v1/*. Forwarding the prefix unchanged would 404 every
    // call — and a 404 read is precisely the failure mode that reads as "empty
    // row" and re-hides the migration bug, so it must not be approximated.
    const path = url.pathname.replace(/^\/prefs/, '') || '/'

    const response = await prefsApi.fetch(
      new Request(`http://localhost${path}${url.search}`, {
        method: req.method,
        headers,
        body: body as unknown as BodyInit
      }),
      env as never
    )

    const out = Buffer.from(await response.arrayBuffer())
    const outHeaders: Record<string, string> = {}
    response.headers.forEach((v, k) => (outHeaders[k] = v))
    res.writeHead(response.status, outHeaders).end(out)
  } catch (e) {
    console.error(`[prefs]    ${req.method} ${req.url} →`, e)
    res
      .writeHead(500, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
  }
}).listen(PREFS_PORT, () => console.log(`[prefs]    :${PREFS_PORT} (real prefs-api, sqlite D1)`))
