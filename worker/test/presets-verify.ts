/**
 * Automation preset-source runtime verification (§5.4).
 *
 * Boots the REAL worker and drives `GET /task/api/automation/presets` against a
 * STUBBED provider — global fetch is intercepted so we control the status, body,
 * ETag and failures a real provider would produce. Proves:
 *
 *   - no AUTOMATION_PRESET_SOURCES binding -> no picker, no network;
 *   - all three payload shapes normalise ({presets:[…]}, […], a bare payload);
 *   - a provider's lane set is validated with the SAME validator activation uses,
 *     so a broken preset is dropped rather than offered;
 *   - inside the TTL we serve from memory and DON'T hit the provider;
 *   - past it we revalidate with If-None-Match; a 304 keeps the parsed lanes;
 *   - a provider that breaks AFTER a good fetch serves the last good copy (stale),
 *     and one that was never reachable reports the failure instead of an empty
 *     picker that reads as "no presets exist";
 *   - http:// sources are refused (a preset drives a destructive migration);
 *   - a public caller gets nothing;
 *   - a preset feeds activate-automation unchanged (the whole point).
 *
 * Run via: pnpm run test:worker  (or `... presets-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')

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
const app = createTaskHandler()

const LANES = [
  { tag: 'triage', label: 'Triage', order: 0, editableBy: 'user' },
  { tag: 'planning', label: 'Planning', order: 1, editableBy: 'agent' },
  { tag: 'done', label: 'Done', order: 2, editableBy: 'user' }
]

// ── Provider stub ───────────────────────────────────────────────────────────
// Every source URL is distinct per scenario so one case's cache entry can't leak
// into the next (the module cache is keyed by URL and lives as long as the isolate).
interface StubResponse {
  status?: number
  body?: unknown
  etag?: string
  throws?: boolean
}
const routes = new Map<string, () => StubResponse>()
const hits = new Map<string, number>()
const conditional = new Map<string, string[]>() // url -> If-None-Match values seen

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const handler = routes.get(url)
  if (!handler) return realFetch(input as RequestInfo, init)

  hits.set(url, (hits.get(url) ?? 0) + 1)
  const headers = new Headers(init?.headers as HeadersInit)
  const inm = headers.get('If-None-Match')
  if (inm) conditional.set(url, [...(conditional.get(url) ?? []), inm])

  const r = handler()
  if (r.throws) throw new Error('connect ECONNREFUSED')
  // Honour the conditional request the way a real origin would.
  if (inm && r.etag && inm === r.etag) {
    return new Response(null, { status: 304, headers: { ETag: r.etag } })
  }
  return new Response(JSON.stringify(r.body ?? {}), {
    status: r.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(r.etag ? { ETag: r.etag } : {})
    }
  })
}) as typeof fetch

interface PresetRow {
  providerId: string
  providerLabel: string
  schemaId: string
  schemaVersion: number | null
  label: string
  description: string | null
  lanes: Array<{ tag: string; editableBy: string }>
}
interface SourceRow {
  id: string
  label: string
  ok: boolean
  count: number
  cached?: boolean
  notModified?: boolean
  stale?: boolean
  error?: string
}

function envWith(sources: unknown): Record<string, unknown> {
  return {
    TASKS_KV: makeKV(),
    DB: d1,
    EDGE_AUTH_SECRET: EDGE_SECRET,
    TASK_STORAGE: 'd1',
    ...(sources === undefined ? {} : { AUTOMATION_PRESET_SOURCES: JSON.stringify(sources) })
  }
}

async function getPresets(
  env: Record<string, unknown>,
  tier = 'friend'
): Promise<{ presets: PresetRow[]; sources: SourceRow[] }> {
  const res = await app.request(
    'http://localhost/task/api/automation/presets',
    {
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': tier,
        ...(tier === 'public' ? {} : { 'X-User-Key': 'owner-key', 'X-User-Id': 'owner-uid' })
      }
    },
    env
  )
  return (await res.json()) as { presets: PresetRow[]; sources: SourceRow[] }
}

async function main() {
  console.log('Automation preset sources (§5.4)')

  // ────────────────────────────────────────────────────────────────────────────
  section('1. No providers configured → no picker, and no outbound request')
  {
    const before = [...hits.values()].reduce((a, b) => a + b, 0)
    const r = await getPresets(envWith(undefined))
    check('no binding → empty presets', r.presets.length === 0)
    check('no binding → empty sources (UI renders no picker)', r.sources.length === 0)
    check(
      'no binding → provider never contacted',
      [...hits.values()].reduce((a, b) => a + b, 0) === before
    )

    const bad = await getPresets(envWith('not-an-array'))
    check('malformed binding → empty, not a 500', bad.sources.length === 0)
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('2. The three payload shapes all normalise')
  {
    const shapes: Array<[string, unknown]> = [
      [
        'https://p.test/wrapped',
        {
          presets: [{ schemaId: 'tenhands', schemaVersion: 1, label: 'TenHands OSS', lanes: LANES }]
        }
      ],
      ['https://p.test/array', [{ schemaId: 'tenhands', schemaVersion: 2, lanes: LANES }]],
      ['https://p.test/single', { schemaId: 'solo', schemaVersion: 3, lanes: LANES }]
    ]
    for (const [url, body] of shapes) routes.set(url, () => ({ body }))

    for (const [url] of shapes) {
      const r = await getPresets(envWith([{ id: 'tenhands', label: 'TenHands', url }]))
      const p = r.presets[0]
      check(`${url.split('/').pop()} → 1 preset`, r.presets.length === 1, JSON.stringify(r))
      check(`${url.split('/').pop()} → lanes carried through`, p?.lanes?.length === 3)
      check(`${url.split('/').pop()} → provider identity attached`, p?.providerLabel === 'TenHands')
    }

    const wrapped = await getPresets(
      envWith([{ id: 'tenhands', label: 'TenHands', url: 'https://p.test/wrapped' }])
    )
    check('provider label wins when given', wrapped.presets[0]?.label === 'TenHands OSS')
    const derived = await getPresets(
      envWith([{ id: 'tenhands', label: 'TenHands', url: 'https://p.test/array' }])
    )
    check(
      'label derived from schemaId+version when absent',
      derived.presets[0]?.label === 'tenhands v2',
      derived.presets[0]?.label
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('3. A provider cannot hand us a lane set activation would reject')
  {
    routes.set('https://p.test/mixed', () => ({
      body: {
        presets: [
          { schemaId: 'good', schemaVersion: 1, lanes: LANES },
          { schemaId: 'dupe', schemaVersion: 1, lanes: [LANES[0], LANES[0]] },
          { schemaId: 'nolanes', schemaVersion: 1, lanes: [] },
          { schemaId: 'badby', schemaVersion: 1, lanes: [{ ...LANES[0], editableBy: 'robot' }] },
          { schemaId: 'spacey', schemaVersion: 1, lanes: [{ ...LANES[0], tag: 'has space' }] }
        ]
      }
    }))
    const r = await getPresets(envWith([{ id: 'p', label: 'P', url: 'https://p.test/mixed' }]))
    check('only the valid preset survives', r.presets.length === 1, JSON.stringify(r.presets))
    check('the survivor is the good one', r.presets[0]?.schemaId === 'good')
    check('one bad preset does not blank the others', r.sources[0]?.ok === true)

    routes.set('https://p.test/allbad', () => ({ body: { presets: [{ lanes: [] }] } }))
    const none = await getPresets(envWith([{ id: 'p', label: 'P', url: 'https://p.test/allbad' }]))
    check('no usable lane sets → reported, not silent', none.sources[0]?.error !== undefined)
    check('no usable lane sets → ok:false', none.sources[0]?.ok === false)
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('4. Caching: unchanged presets are not re-downloaded')
  {
    const url = 'https://p.test/cached'
    let served = 0
    routes.set(url, () => {
      served++
      return {
        body: { presets: [{ schemaId: 'c', schemaVersion: 1, lanes: LANES }] },
        etag: '"v1"'
      }
    })
    const env = envWith([{ id: 'p', label: 'P', url }])

    const first = await getPresets(env)
    check('first call fetches', hits.get(url) === 1, `hits=${hits.get(url)}`)
    check('first call → 1 preset', first.presets.length === 1)
    check('first call is not flagged cached', !first.sources[0]?.cached)

    const second = await getPresets(env)
    check(
      'second call inside TTL → no network at all',
      hits.get(url) === 1,
      `hits=${hits.get(url)}`
    )
    check('second call flagged cached', second.sources[0]?.cached === true)
    check('second call still returns the presets', second.presets.length === 1)
    check('provider body served exactly once', served === 1, `served=${served}`)
  }

  section('5. Past the TTL we revalidate — a 304 keeps the lanes we parsed')
  {
    const url = 'https://p.test/revalidate'
    routes.set(url, () => ({
      body: { presets: [{ schemaId: 'r', schemaVersion: 1, lanes: LANES }] },
      etag: '"rev-1"'
    }))
    const env = envWith([{ id: 'p', label: 'P', url }])

    await getPresets(env)
    check('primed', hits.get(url) === 1)

    // Age the entry past the TTL the only way a black-box test can: move the clock.
    const realNow = Date.now
    Date.now = () => realNow() + 6 * 60 * 1000

    const revalidated = await getPresets(env)
    Date.now = realNow

    check('stale entry triggers a revalidation', hits.get(url) === 2, `hits=${hits.get(url)}`)
    check(
      'revalidation sends If-None-Match with the stored ETag',
      conditional.get(url)?.[0] === '"rev-1"',
      JSON.stringify(conditional.get(url))
    )
    check(
      'provider answered 304 → flagged notModified',
      revalidated.sources[0]?.notModified === true
    )
    check('304 keeps the previously parsed lanes', revalidated.presets[0]?.lanes?.length === 3)
  }

  section('6. A changed contract replaces the cached one')
  {
    const url = 'https://p.test/changed'
    let version = 1
    routes.set(url, () => ({
      body: { presets: [{ schemaId: 'ch', schemaVersion: version, lanes: LANES }] },
      etag: `"ch-${version}"`
    }))
    const env = envWith([{ id: 'p', label: 'P', url }])

    const before = await getPresets(env)
    check('v1 cached', before.presets[0]?.schemaVersion === 1)

    version = 2 // provider publishes a new contract; its ETag changes with it
    const realNow = Date.now
    Date.now = () => realNow() + 6 * 60 * 1000
    const after = await getPresets(env)
    Date.now = realNow

    check('new ETag → 200, not 304', after.sources[0]?.notModified !== true)
    check('the new contract replaces the old', after.presets[0]?.schemaVersion === 2)
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('7. Provider failures degrade, never blank the picker mid-use')
  {
    const url = 'https://p.test/flaky'
    let healthy = true
    routes.set(url, () =>
      healthy
        ? { body: { presets: [{ schemaId: 'f', schemaVersion: 1, lanes: LANES }] }, etag: '"f1"' }
        : { throws: true }
    )
    const env = envWith([{ id: 'p', label: 'TenHands', url }])

    await getPresets(env)
    healthy = false
    const realNow = Date.now
    Date.now = () => realNow() + 6 * 60 * 1000
    const degraded = await getPresets(env)
    Date.now = realNow

    check('provider down → last good copy still offered', degraded.presets.length === 1)
    check('…and flagged stale', degraded.sources[0]?.stale === true)
    check('…with a reason naming the provider', (degraded.sources[0]?.error ?? '').length > 0)

    // Never-reachable provider: report the failure rather than an empty picker.
    routes.set('https://p.test/dead', () => ({ throws: true }))
    const dead = await getPresets(
      envWith([{ id: 'p', label: 'TenHands', url: 'https://p.test/dead' }])
    )
    check('never-reachable → ok:false', dead.sources[0]?.ok === false)
    check('never-reachable → error explains why', dead.sources[0]?.error === 'Provider unreachable')
    check('never-reachable → no presets invented', dead.presets.length === 0)

    routes.set('https://p.test/500', () => ({ status: 500, body: {} }))
    const boom = await getPresets(envWith([{ id: 'p', label: 'P', url: 'https://p.test/500' }]))
    check('5xx → reported with the status', boom.sources[0]?.error === 'Provider returned 500')
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('8. Transport + caller gates')
  {
    routes.set('http://p.test/insecure', () => ({ body: { presets: [{ lanes: LANES }] } }))
    const insecure = await getPresets(
      envWith([{ id: 'p', label: 'P', url: 'http://p.test/insecure' }])
    )
    check('http:// source is refused outright', insecure.sources.length === 0)
    check('http:// source is never fetched', hits.get('http://p.test/insecure') === undefined)

    // Loopback is the one http exception — a local dev stub nobody can intercept.
    routes.set('http://localhost:9999/presets', () => ({
      body: { presets: [{ schemaId: 'local', schemaVersion: 1, lanes: LANES }] }
    }))
    const loopback = await getPresets(
      envWith([{ id: 'dev', label: 'Dev', url: 'http://localhost:9999/presets' }])
    )
    check('http://localhost source is allowed (dev stub)', loopback.presets.length === 1)

    const pub = await getPresets(
      envWith([{ id: 'p', label: 'P', url: 'https://p.test/wrapped' }]),
      'public'
    )
    check('public caller → no presets', pub.presets.length === 0)
    check('public caller → no sources', pub.sources.length === 0)
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('9. A fetched preset activates a board unchanged (the point of all this)')
  {
    const url = 'https://p.test/e2e'
    routes.set(url, () => ({
      body: { presets: [{ schemaId: 'tenhands', schemaVersion: 1, lanes: LANES }] }
    }))
    const env = envWith([{ id: 'tenhands', label: 'TenHands', url }])

    const { presets } = await getPresets(env)
    const preset = presets[0]
    check('preset fetched', !!preset)

    const headers = {
      'X-Edge-Auth': EDGE_SECRET,
      'X-Hadoku-Tier': 'friend',
      'X-User-Key': 'owner-key',
      'X-User-Id': 'owner-uid',
      'Content-Type': 'application/json'
    }
    // Seed a board to convert.
    const created = await app.request(
      'http://localhost/task/api/boards',
      { method: 'POST', headers, body: JSON.stringify({ id: 'auto', name: 'Auto' }) },
      env
    )
    check('board seeded', created.status === 200 || created.status === 201, `${created.status}`)

    // Exactly what the UI sends: the preset's own fields, nothing hand-edited.
    const payload = {
      schemaId: preset.schemaId,
      schemaVersion: preset.schemaVersion,
      lanes: preset.lanes
    }
    const dry = await app.request(
      'http://localhost/task/api/boards/auto/activate-automation',
      { method: 'POST', headers, body: JSON.stringify({ ...payload, dryRun: true }) },
      env
    )
    const dryBody = (await dry.json()) as { preview?: { digest: string; lanes?: unknown[] } }
    check('dryRun with the fetched preset → 200', dry.status === 200, `status=${dry.status}`)
    check('preview covers every lane', dryBody.preview?.lanes?.length === 3)

    const commit = await app.request(
      'http://localhost/task/api/boards/auto/activate-automation',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, digest: dryBody.preview?.digest })
      },
      env
    )
    const applied = (await commit.json()) as { applied?: { mode: string; laneCount: number } }
    check('commit → 200', commit.status === 200, `status=${commit.status}`)
    check('board is now an automation board', applied.applied?.mode === 'automation')
    check('with the provider’s lane count', applied.applied?.laneCount === 3)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
