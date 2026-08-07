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
 *   :3003  prefs-api from ../hadoku_site, fronted by the same edge-router shim
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
 * WHY A SEPARATE ENTRY POINT
 * --------------------------
 * It statically imports across the repo boundary into ../hadoku_site. That is
 * deliberate (a copy here would be a mock that drifts), but it means the file
 * cannot build when the sibling checkout is absent — CI, a fresh clone. Keeping
 * it out of dev-server.ts lets scripts/dev-api.mjs build and start it only when
 * the sibling exists, and lets worker/tsconfig.json exclude it from typecheck.
 */
import { createServer } from 'node:http'
// Resolved by an esbuild alias in scripts/dev-api.mjs, NOT by node or tsc. A
// relative '../../../hadoku_site/…' would be wrong the moment this runs from a
// git worktree, where the repo root sits three levels deeper than the sibling
// checkout — and worktrees are the normal way to work here. The build script
// locates hadoku_site from the MAIN checkout (git --git-common-dir) and points
// this specifier at it.
import prefsApi from 'hadoku-site-prefs-api'
import { makeSqliteD1 } from './lib/d1-sqlite'

const PREFS_PORT = Number(process.env.DEV_PREFS_PORT ?? 3003)
const EDGE_SECRET = 'dev-edge-secret'

/** Must match dev-server.ts's user, or the two rows key to different people. */
const USER = { key: 'dev-key', id: 'dev-uid', tier: 'friend' }

// Real schema, applied from the sibling repo's migration files — the same ones
// prod runs. Supplied by dev-api.mjs for the same worktree reason as the import
// above; there is no correct relative path to hardcode here.
const PREFS_MIGRATIONS = process.env.DEV_PREFS_MIGRATIONS
if (!PREFS_MIGRATIONS) {
  throw new Error(
    'DEV_PREFS_MIGRATIONS is unset — start this through scripts/dev-api.mjs, which resolves ' +
      'the hadoku_site checkout and passes the migrations directory.'
  )
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
    },
    async list() {
      return { keys: [...store.keys()].map(name => ({ name })) }
    }
  }
}

const env = {
  PREFS_DB: makeSqliteD1(PREFS_MIGRATIONS),
  SESSIONS_KV: makeKV(),
  EDGE_AUTH_SECRET: EDGE_SECRET
} as unknown as Record<string, unknown>

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')

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
            userId: USER.id,
            userType: USER.tier,
            name: 'dev'
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
    headers.set('X-Hadoku-Tier', USER.tier)
    headers.set('X-User-Key', USER.key)
    headers.set('X-User-Id', USER.id)

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
