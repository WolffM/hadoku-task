/**
 * Preferences identity + migration runtime verification.
 *
 * Boots the REAL worker (createTaskHandler) in-process against an instrumented
 * in-memory KV and asserts the thing that was broken:
 *
 *   Preferences were keyed by `X-Session-Id`, which edge-router mints fresh on
 *   every login (16 random bytes). Every login therefore wrote a NEW
 *   `prefs:{sessionId}` blob and orphaned the previous one — 302 such keys had
 *   accumulated in production TASKS_KV for ~9 real users. Boards and tasks were
 *   already keyed correctly, by the stable edge-injected `X-User-Id`.
 *
 * These checks pin both halves of the fix: writes land on the stable identity,
 * and anything already stranded is recovered and copied forward.
 *
 * Run: pnpm run test:worker
 */
import { createTaskHandler } from '../src/index'
import { SessionHandshakeResponseSchema } from '../src/schemas'

const EDGE_SECRET = 'test-edge-secret'

interface InstrumentedKV {
  get(key: string, type?: string): Promise<unknown>
  put(key: string, val: unknown): Promise<void>
  delete(key: string): Promise<void>
  /** Every key read since the last resetLog(), in order. */
  reads: string[]
  /** Every key written since the last resetLog(), in order. */
  writes: string[]
  resetLog(): void
  seed(key: string, val: unknown): void
  raw(key: string): unknown
  keys(): string[]
}

function makeKV(): InstrumentedKV {
  const store = new Map<string, string>()
  const kv: InstrumentedKV = {
    reads: [],
    writes: [],
    async get(key: string, type?: string) {
      kv.reads.push(key)
      const v = store.get(key)
      if (v === undefined) return null
      return type === 'json' ? JSON.parse(v) : v
    },
    async put(key: string, val: unknown) {
      kv.writes.push(key)
      store.set(key, typeof val === 'string' ? val : JSON.stringify(val))
    },
    async delete(key: string) {
      store.delete(key)
    },
    resetLog() {
      kv.reads = []
      kv.writes = []
    },
    seed(key: string, val: unknown) {
      store.set(key, typeof val === 'string' ? val : JSON.stringify(val))
    },
    raw(key: string) {
      const v = store.get(key)
      return v === undefined ? null : JSON.parse(v)
    },
    keys() {
      return [...store.keys()].sort()
    }
  }
  return kv
}

// Minimal D1 stub: every query resolves empty/ok. Preferences never touch D1.
function makeD1() {
  const stmt: Record<string, unknown> = {
    bind: () => stmt,
    run: async () => ({ success: true, meta: {} }),
    all: async () => ({ results: [], success: true, meta: {} }),
    first: async () => null
  }
  return { prepare: () => stmt }
}

let kv = makeKV()
const app = createTaskHandler()

function envFor() {
  return { TASKS_KV: kv, DB: makeD1(), EDGE_AUTH_SECRET: EDGE_SECRET }
}

interface Identity {
  /** Raw credential — X-User-Key. Changes on key rotation. */
  key: string
  /** Stable registry UUID — X-User-Id. Survives key rotation. */
  userId?: string
  /** Ephemeral per-login session id — X-Session-Id. */
  sessionId?: string
}

async function req(
  method: string,
  path: string,
  id: Identity,
  opts: { body?: unknown } = {}
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const headers: Record<string, string> = {
    'X-Edge-Auth': EDGE_SECRET,
    'X-Hadoku-Tier': 'friend',
    'X-User-Key': id.key,
    'Content-Type': 'application/json'
  }
  if (id.userId) headers['X-User-Id'] = id.userId
  if (id.sessionId) headers['X-Session-Id'] = id.sessionId

  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    },
    envFor()
  )
  let json: Record<string, unknown> | null = null
  try {
    json = await res.clone().json()
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

function section(title: string) {
  console.log(`\n${title}`)
}

async function main() {
  console.log('Preferences identity + migration runtime verification')

  // ---------------------------------------------------------------------
  section('1. Writes land on the stable identity, never the session id')
  // ---------------------------------------------------------------------
  kv = makeKV()
  const u1 = { key: 'raw-key-1', userId: 'uuid-user-1', sessionId: 'ephemeral-session-aaa' }

  let r = await req('PUT', '/task/api/preferences', u1, { body: { theme: 'forest-dark' } })
  check('PUT preferences → 200', r.status === 200, `status=${r.status}`)
  check(
    'wrote prefs:{userId}',
    kv.raw('prefs:uuid-user-1') !== null,
    `keys=${JSON.stringify(kv.keys())}`
  )
  check(
    'did NOT write prefs:{sessionId}',
    kv.raw('prefs:ephemeral-session-aaa') === null,
    `keys=${JSON.stringify(kv.keys())}`
  )
  check(
    'did NOT write prefs:{rawKey}',
    kv.raw('prefs:raw-key-1') === null,
    `keys=${JSON.stringify(kv.keys())}`
  )

  // The regression this pins: a SECOND login mints a new session id. Under the
  // old code that produced a second, empty prefs blob and served defaults.
  const u1NewLogin = { ...u1, sessionId: 'ephemeral-session-bbb' }
  r = await req('GET', '/task/api/preferences', u1NewLogin)
  check(
    'new login (fresh X-Session-Id) still sees saved theme',
    r.json?.theme === 'forest-dark',
    JSON.stringify(r.json)
  )
  check(
    'new login did not spawn a second prefs blob',
    kv.keys().filter(k => k.startsWith('prefs:')).length === 1,
    `keys=${JSON.stringify(kv.keys().filter(k => k.startsWith('prefs:')))}`
  )

  // ---------------------------------------------------------------------
  section('2. Prefs stranded under an old session id are recovered')
  // ---------------------------------------------------------------------
  kv = makeKV()
  const u2 = { key: 'raw-key-2', userId: 'uuid-user-2', sessionId: 'brand-new-session' }

  // Exactly the production shape: a real blob under a long-dead session id,
  // reachable ONLY through the authKey → sessionIds mapping.
  kv.seed('prefs:dead-session-1', {
    theme: 'ocean-dark',
    experimentalThemes: true,
    lastUpdated: '2026-01-01T00:00:00.000Z'
  })
  kv.seed('session-map:raw-key-2', {
    authKey: 'raw-key-2',
    sessionIds: ['dead-session-1'],
    lastSessionId: 'dead-session-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  })

  r = await req('GET', '/task/api/preferences', u2)
  check('recovered theme from dead session', r.json?.theme === 'ocean-dark', JSON.stringify(r.json))
  check('recovered all fields', r.json?.experimentalThemes === true, JSON.stringify(r.json))
  check(
    'copied forward to prefs:{userId}',
    (kv.raw('prefs:uuid-user-2') as Record<string, unknown> | null)?.theme === 'ocean-dark',
    JSON.stringify(kv.raw('prefs:uuid-user-2'))
  )
  check(
    'left the legacy blob in place (rollback stays possible)',
    kv.raw('prefs:dead-session-1') !== null
  )
  check(
    'preserved the original lastUpdated (no false freshness)',
    (kv.raw('prefs:uuid-user-2') as Record<string, unknown> | null)?.lastUpdated ===
      '2026-01-01T00:00:00.000Z',
    JSON.stringify(kv.raw('prefs:uuid-user-2'))
  )

  // Second read must be a direct hit — no legacy sweep, no session-map read.
  kv.resetLog()
  r = await req('GET', '/task/api/preferences', u2)
  check('second read still correct', r.json?.theme === 'ocean-dark', JSON.stringify(r.json))
  check(
    'second read never touches the legacy namespace',
    !kv.reads.some(k => k.includes('dead-session-1')),
    `reads=${JSON.stringify(kv.reads)}`
  )
  check(
    'second read never re-reads the session map',
    !kv.reads.some(k => k.startsWith('session-map:')),
    `reads=${JSON.stringify(kv.reads)}`
  )

  // ---------------------------------------------------------------------
  section('3. Recovery picks the NEWEST stranded blob, not the last-appended')
  // ---------------------------------------------------------------------
  kv = makeKV()
  const u3 = { key: 'raw-key-3', userId: 'uuid-user-3', sessionId: 'fresh' }
  // Append order deliberately disagrees with recency: the newest prefs sit
  // under the FIRST-appended session id.
  kv.seed('prefs:sess-old-but-newest', { theme: 'newest', lastUpdated: '2026-06-01T00:00:00.000Z' })
  kv.seed('prefs:sess-new-but-stale', { theme: 'stale', lastUpdated: '2025-02-01T00:00:00.000Z' })
  kv.seed('session-map:raw-key-3', {
    authKey: 'raw-key-3',
    sessionIds: ['sess-old-but-newest', 'sess-new-but-stale'],
    lastSessionId: 'sess-new-but-stale',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z'
  })

  r = await req('GET', '/task/api/preferences', u3)
  check(
    'picked the most recently updated blob, not lastSessionId',
    r.json?.theme === 'newest',
    JSON.stringify(r.json)
  )

  // ---------------------------------------------------------------------
  section('4. Pre-rotation raw-key namespace is recovered')
  // ---------------------------------------------------------------------
  kv = makeKV()
  const u4 = { key: 'raw-key-4', userId: 'uuid-user-4', sessionId: 'fresh-4' }
  kv.seed('prefs:raw-key-4', { theme: 'legacy-rawkey', lastUpdated: '2025-05-05T00:00:00.000Z' })

  r = await req('GET', '/task/api/preferences', u4)
  check('recovered from prefs:{rawKey}', r.json?.theme === 'legacy-rawkey', JSON.stringify(r.json))
  check(
    'copied forward to prefs:{userId}',
    (kv.raw('prefs:uuid-user-4') as Record<string, unknown> | null)?.theme === 'legacy-rawkey'
  )

  // ---------------------------------------------------------------------
  section('5. Key rotation does not strand preferences')
  // ---------------------------------------------------------------------
  kv = makeKV()
  const before = { key: 'key-before-rotation', userId: 'uuid-user-5', sessionId: 's-before' }
  const after = { key: 'key-AFTER-rotation', userId: 'uuid-user-5', sessionId: 's-after' }

  await req('PUT', '/task/api/preferences', before, { body: { theme: 'survives-rotation' } })
  r = await req('GET', '/task/api/preferences', after)
  check(
    'rotated key, same userId → prefs survive',
    r.json?.theme === 'survives-rotation',
    JSON.stringify(r.json)
  )

  // ---------------------------------------------------------------------
  section('6. PUT merges onto recovered prefs instead of clobbering them')
  // ---------------------------------------------------------------------
  kv = makeKV()
  const u6 = { key: 'raw-key-6', userId: 'uuid-user-6', sessionId: 'fresh-6' }
  kv.seed('prefs:stranded-6', {
    theme: 'keep-me',
    experimentalThemes: true,
    lastUpdated: '2026-01-01T00:00:00.000Z'
  })
  kv.seed('session-map:raw-key-6', {
    authKey: 'raw-key-6',
    sessionIds: ['stranded-6'],
    lastSessionId: 'stranded-6',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  })

  // A write BEFORE any read is the dangerous ordering: the old code would have
  // merged onto {} and destroyed the stranded blob.
  r = await req('PUT', '/task/api/preferences', u6, { body: { alwaysVerticalLayout: true } })
  check('PUT → 200', r.status === 200, `status=${r.status}`)
  const merged = kv.raw('prefs:uuid-user-6') as Record<string, unknown> | null
  check('patch applied', merged?.alwaysVerticalLayout === true, JSON.stringify(merged))
  check('recovered field survived the patch', merged?.theme === 'keep-me', JSON.stringify(merged))
  check(
    'other recovered field survived too',
    merged?.experimentalThemes === true,
    JSON.stringify(merged)
  )

  // ---------------------------------------------------------------------
  section('7. Handshake stores prefs on the stable id, not the new session id')
  // ---------------------------------------------------------------------
  kv = makeKV()
  const u7 = { key: 'raw-key-7', userId: 'uuid-user-7', sessionId: 'irrelevant' }
  kv.seed('prefs:old-handshake-session', {
    theme: 'handshake-theme',
    lastUpdated: '2026-02-02T00:00:00.000Z'
  })

  r = await req('POST', '/task/api/session/handshake', u7, {
    body: { oldSessionId: 'old-handshake-session', newSessionId: 'minted-session-xyz' }
  })
  check('handshake → 200', r.status === 200, `status=${r.status}`)
  check(
    'handshake returned the migrated prefs',
    (r.json?.preferences as Record<string, unknown> | undefined)?.theme === 'handshake-theme',
    JSON.stringify(r.json)
  )

  // The published contract must describe the response that just came back.
  //
  // This is here because it silently didn't: SessionHandshakeResponseSchema
  // declared `success` and `migrated`, which the handler has never sent, and
  // omitted `userType`, which it always sends and which the frontend reads to
  // detect an expired session. Nothing caught it — @hono/zod-openapi validates
  // requests, not responses, so the schema is documentation, and the route is
  // registered through an `as never` cast that stops TypeScript comparing the
  // two. The only consumer that felt it was TenHands, codegenning a Python
  // client from a spec that was wrong in both directions.
  //
  // `.strict()` is the point: a plain parse strips unknown keys and would pass
  // an undocumented field straight through, which is exactly the `userType`
  // half of the bug. Only the TOP level is strict — `preferences` is an open
  // blob by design (UserPreferences has an index signature).
  const contract = SessionHandshakeResponseSchema.strict().safeParse(r.json)
  check(
    'the real handshake response satisfies its own OpenAPI schema, exactly',
    contract.success,
    contract.success ? '' : JSON.stringify(contract.error.issues)
  )
  check(
    'handshake wrote prefs to prefs:{userId}',
    (kv.raw('prefs:uuid-user-7') as Record<string, unknown> | null)?.theme === 'handshake-theme',
    JSON.stringify(kv.raw('prefs:uuid-user-7'))
  )
  check(
    'handshake did NOT write prefs:{newSessionId}',
    kv.raw('prefs:minted-session-xyz') === null,
    `keys=${JSON.stringify(kv.keys())}`
  )
  check(
    'handshake still records session-info for the new session',
    kv.raw('session-info:minted-session-xyz') !== null,
    `keys=${JSON.stringify(kv.keys())}`
  )

  // An explicit oldSessionId migration is a MOVE: the handshake deletes the old
  // blob once it has been copied to the stable id. Verify the move completed
  // rather than assuming the source lingers.
  check(
    'explicit migration removed the old session blob (it moved, not copied)',
    kv.raw('prefs:old-handshake-session') === null,
    `keys=${JSON.stringify(kv.keys())}`
  )

  // Repeated handshakes (i.e. repeated logins) must not multiply prefs blobs —
  // this is the exact mechanism that produced 302 keys in production.
  for (const sid of ['login-2', 'login-3', 'login-4']) {
    await req('POST', '/task/api/session/handshake', u7, {
      body: { oldSessionId: null, newSessionId: sid }
    })
  }
  const prefsKeys = kv.keys().filter(k => k.startsWith('prefs:'))
  check(
    'four logins left exactly one prefs blob, on the stable id',
    prefsKeys.length === 1 && prefsKeys[0] === 'prefs:uuid-user-7',
    `prefs keys=${JSON.stringify(prefsKeys)}`
  )
  check(
    'and it still holds the migrated value',
    (kv.raw('prefs:uuid-user-7') as Record<string, unknown> | null)?.theme === 'handshake-theme',
    JSON.stringify(kv.raw('prefs:uuid-user-7'))
  )

  // ---------------------------------------------------------------------
  section('8. Callers with no X-User-Id (direct workers.dev) still work')
  // ---------------------------------------------------------------------
  kv = makeKV()
  const noEdge = { key: 'raw-key-8' } // no userId, no session id
  r = await req('PUT', '/task/api/preferences', noEdge, { body: { theme: 'direct' } })
  check('PUT without X-User-Id → 200', r.status === 200, `status=${r.status}`)
  r = await req('GET', '/task/api/preferences', noEdge)
  check('GET without X-User-Id round-trips', r.json?.theme === 'direct', JSON.stringify(r.json))

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
