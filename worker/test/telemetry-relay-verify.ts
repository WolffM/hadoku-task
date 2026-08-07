/**
 * Client telemetry relay — runtime verification.
 *
 * Boots the REAL worker and drives POST /task/api/telemetry, with global fetch
 * captured so the outbound call to monitoring-api is inspected rather than
 * sent. What is proven here is the contract the browser cannot prove for
 * itself:
 *
 *   - a valid batch forwards ONE upstream POST PER EVENT, carrying the service
 *     credential from the binding and never anything the client supplied;
 *   - the body matches monitoring-api's ingest schema exactly (source/level/
 *     type/message), because a shape it rejects is a silently lost signal —
 *     and losing the signal is the whole failure mode this feature exists to
 *     end;
 *   - identity in the forwarded context comes from the EDGE-STAMPED auth
 *     context, so a client cannot forge who it is;
 *   - caps hold: oversize batches, long messages and fat context bags are
 *     trimmed, so a looping client cannot use this as an amplifier;
 *   - EVERY path answers 204 — malformed body, missing binding, upstream 500.
 *     Telemetry must never fail the app that reports it, and a client has no
 *     retry path anyway.
 *
 * The no-binding case matters most in practice: local dev and the E2E stack
 * both run without MONITORING_INGEST_KEY, and that must be an ordinary drop
 * rather than an error surfacing in someone's console.
 *
 * Run: pnpm run test:worker
 */
import { createTaskHandler } from '../src/index'

const EDGE_SECRET = 'test-edge-secret'
const INGEST_KEY = 'service-key-under-test'

function makeD1() {
  const stmt: Record<string, unknown> = {
    bind: () => stmt,
    run: async () => ({ success: true, meta: {} }),
    all: async () => ({ results: [], success: true, meta: {} }),
    first: async () => null
  }
  return { prepare: () => stmt }
}

function makeKV() {
  const store = new Map<string, string>()
  return {
    async get(k: string, t?: string) {
      const v = store.get(k)
      return v === undefined ? null : t === 'json' ? JSON.parse(v) : v
    },
    async put(k: string, v: unknown) {
      store.set(k, typeof v === 'string' ? v : JSON.stringify(v))
    },
    async delete(k: string) {
      store.delete(k)
    }
  }
}

const app = createTaskHandler()

interface Captured {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

let captured: Captured[] = []
let upstreamStatus = 200
const realFetch = globalThis.fetch

/** Capture outbound calls instead of performing them. Only the monitoring
 *  ingest is intercepted; anything else falls through untouched. */
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
  if (url.includes('/health/api/telemetry')) {
    const headers: Record<string, string> = {}
    const h = init?.headers as Record<string, string> | undefined
    if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v
    captured.push({
      url,
      headers,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    })
    return new Response(upstreamStatus === 200 ? '{"success":true}' : '{"error":"nope"}', {
      status: upstreamStatus,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  return realFetch(input as RequestInfo, init)
}) as typeof fetch

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(title: string) {
  console.log(`\n${title}`)
}

function envFor(withKey = true) {
  return {
    TASKS_KV: makeKV(),
    DB: makeD1(),
    EDGE_AUTH_SECRET: EDGE_SECRET,
    ...(withKey ? { MONITORING_INGEST_KEY: INGEST_KEY } : {})
  }
}

async function post(body: unknown, opts: { withKey?: boolean; tier?: string } = {}) {
  captured = []
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Edge-Auth': EDGE_SECRET,
    'X-Hadoku-Tier': opts.tier ?? 'friend',
    'X-User-Key': 'caller-key',
    'X-User-Id': 'caller-uid'
  }
  return app.request(
    'http://localhost/task/api/telemetry',
    {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    },
    envFor(opts.withKey ?? true)
  )
}

async function main() {
  section('1. A valid batch forwards one upstream POST per event')
  let r = await post({
    events: [
      {
        level: 'warn',
        type: 'theme',
        message: '[theme] requested theme could not be applied',
        context: { requested: 'coffee', applied: 'light', reason: 'unknown-theme' }
      },
      { level: 'error', type: 'log', message: '[themePrefsMigration] skipped' }
    ]
  })
  check('responds 204', r.status === 204, `status=${r.status}`)
  check('forwarded both events', captured.length === 2, `captured=${captured.length}`)
  check(
    'targets the service-tier ingest, not the admin batch route',
    captured.every(c => c.url === 'https://hadoku.me/health/api/telemetry'),
    JSON.stringify(captured.map(c => c.url))
  )
  check(
    'carries the binding credential',
    captured.every(c => c.headers['x-user-key'] === INGEST_KEY),
    JSON.stringify(captured.map(c => c.headers['x-user-key']))
  )

  section("2. The body matches monitoring-api's ingest schema")
  const first = captured[0]
  check('source is browser', first.body.source === 'browser', String(first.body.source))
  check('level preserved', first.body.level === 'warn', String(first.body.level))
  check('type preserved', first.body.type === 'theme', String(first.body.type))
  check(
    'message preserved',
    first.body.message === '[theme] requested theme could not be applied',
    String(first.body.message)
  )
  const ctx = first.body.context as Record<string, unknown>
  check('client context survives', ctx.requested === 'coffee', JSON.stringify(ctx))
  check('app attribution added', ctx.app === 'task', JSON.stringify(ctx))
  check(
    'type defaults to log when omitted',
    captured[1].body.type === 'log',
    String(captured[1].body.type)
  )

  section('3. Identity comes from the edge stamp, not the payload')
  await post({
    events: [
      {
        level: 'warn',
        message: 'spoof attempt',
        // A client trying to claim admin attribution.
        context: { userType: 'admin', app: 'not-task' }
      }
    ]
  })
  const spoofCtx = captured[0].body.context as Record<string, unknown>
  check(
    'client-supplied userType is overwritten by the auth context',
    spoofCtx.userType === 'friend',
    String(spoofCtx.userType)
  )
  check('client-supplied app is overwritten', spoofCtx.app === 'task', String(spoofCtx.app))

  section('4. Caps hold — this cannot be used as an amplifier')
  await post({
    events: Array.from({ length: 25 }, (_, i) => ({
      level: 'warn' as const,
      message: `event ${i}`
    }))
  })
  check(
    'a 25-event batch is rejected by the schema, not forwarded',
    captured.length === 0,
    `captured=${captured.length}`
  )

  await post({
    events: [{ level: 'warn', message: 'x'.repeat(500) }]
  })
  check(
    'an over-long message is rejected by the schema',
    captured.length === 0,
    `captured=${captured.length}`
  )

  const fatContext: Record<string, unknown> = {}
  for (let i = 0; i < 40; i++) fatContext[`k${i}`] = 'v'.repeat(400)
  await post({ events: [{ level: 'warn', message: 'fat context', context: fatContext }] })
  const clamped = captured[0].body.context as Record<string, unknown>
  check(
    'context key count is clamped',
    Object.keys(clamped).length <= 14,
    String(Object.keys(clamped).length)
  )
  check(
    'context values are clamped',
    Object.values(clamped).every(v => typeof v !== 'string' || v.length <= 200),
    'a value exceeded 200 chars'
  )

  section('5. Every failure path is a silent 204')
  r = await post('not json at all')
  check('malformed body → 204', r.status === 204, `status=${r.status}`)
  check('and nothing is forwarded', captured.length === 0, `captured=${captured.length}`)

  r = await post({ events: [{ level: 'debug', message: 'too chatty' }] })
  check('a level outside warn/error → 204, dropped', r.status === 204, `status=${r.status}`)
  check('and nothing is forwarded', captured.length === 0, `captured=${captured.length}`)

  r = await post({ events: [{ level: 'warn', message: 'no binding' }] }, { withKey: false })
  check('missing MONITORING_INGEST_KEY → 204', r.status === 204, `status=${r.status}`)
  check(
    'and nothing is forwarded (local dev / E2E is a normal state)',
    captured.length === 0,
    `captured=${captured.length}`
  )

  upstreamStatus = 500
  r = await post({ events: [{ level: 'warn', message: 'upstream is down' }] })
  check('upstream 500 → still 204 to the caller', r.status === 204, `status=${r.status}`)
  check('and the attempt was made', captured.length === 1, `captured=${captured.length}`)
  upstreamStatus = 200

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
