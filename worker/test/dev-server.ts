/**
 * Local dev/E2E stand-in for the deployed stack: the REAL worker over HTTP, plus
 * a stub preset provider — so the browser exercises the same code prod runs.
 *
 * Two servers:
 *   :3001  the worker (vite proxies /task/api here), fronted by a shim that
 *          injects the headers edge-router adds in production (X-Edge-Auth,
 *          X-Hadoku-Tier, X-User-Key, X-User-Id). Without that shim the worker
 *          sees an unauthenticated request and every board read is empty.
 *   :3002  a provider serving automation presets, so the activation picker has
 *          something real to fetch. Serves a strong ETag and honours
 *          If-None-Match, like a real origin — the revalidation path is what
 *          keeps unchanged contracts from being re-downloaded.
 *
 * Not a *-verify.ts harness (it's a server, not an assertion run), so
 * run-worker-verify.mjs ignores it. Started by scripts/dev-api.mjs.
 */
import { createServer } from 'node:http'
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const API_PORT = Number(process.env.DEV_API_PORT ?? 3001)
const PROVIDER_PORT = Number(process.env.DEV_PROVIDER_PORT ?? 3002)
const EDGE_SECRET = 'dev-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations/0002_boards_and_tasks.sql')

// The dev user every browser request is attributed to.
const USER = { key: 'dev-key', id: 'dev-uid', tier: 'friend' }

const PRESETS = {
  presets: [
    {
      schemaId: 'tenhands',
      schemaVersion: 1,
      label: 'TenHands OSS Contribution',
      description: 'Plan → work → submit, with human review gates between each agent step.',
      lanes: [
        { tag: 'triage', label: 'Triage', order: 0, editableBy: 'user' },
        { tag: 'planning', label: 'Planning', order: 1, editableBy: 'agent' },
        { tag: 'plan-review', label: 'Plan Review', order: 2, editableBy: 'user' },
        { tag: 'approved', label: 'Approved', order: 3, editableBy: 'user' },
        { tag: 'working', label: 'Working', order: 4, editableBy: 'agent' },
        { tag: 'pr-review', label: 'PR Review', order: 5, editableBy: 'user' },
        { tag: 'submit', label: 'Submit', order: 6, editableBy: 'user' },
        { tag: 'submitting', label: 'Submitting', order: 7, editableBy: 'agent' },
        { tag: 'submitted', label: 'Submitted', order: 8, editableBy: 'user' },
        { tag: 'stalled', label: 'Stalled', order: 9, editableBy: 'user' }
      ]
    },
    {
      schemaId: 'tenhands-simple',
      schemaVersion: 1,
      label: 'TenHands Simple Work',
      description: 'One agent step, one review gate.',
      lanes: [
        { tag: 'todo', label: 'To Do', order: 0, editableBy: 'user' },
        { tag: 'working', label: 'Working', order: 1, editableBy: 'agent' },
        { tag: 'review', label: 'Review', order: 2, editableBy: 'user' }
      ]
    }
  ]
}
const PRESETS_BODY = JSON.stringify(PRESETS)
const PRESETS_ETAG = '"dev-presets-1"'

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

const d1: FakeD1 = makeSqliteD1(MIGRATION)
// Not in 0002 — board stats read it, and a missing table takes the whole server
// down on the first /boards call.
d1.__raw.exec(`
  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_key TEXT NOT NULL, board_id TEXT NOT NULL,
    task_id TEXT, event_type TEXT NOT NULL, metadata TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')));`)
const app = createTaskHandler()

const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  // Defaults to the local stub so the e2e specs are hermetic. Point it at a real
  // provider to smoke-test the live contract:
  //   DEV_PRESET_SOURCES='[{"id":"tenhands","label":"TenHands","url":"https://…"}]'
  AUTOMATION_PRESET_SOURCES:
    process.env.DEV_PRESET_SOURCES ??
    JSON.stringify([
      {
        id: 'tenhands',
        label: 'TenHands',
        url: `http://localhost:${PROVIDER_PORT}/automation/presets`
      }
    ])
} as Record<string, unknown>

// ── Provider stub ───────────────────────────────────────────────────────────
createServer((req, res) => {
  if (!req.url?.startsWith('/automation/presets')) {
    res.writeHead(404).end()
    return
  }
  console.log(`[provider] ${req.method} ${req.url} if-none-match=${req.headers['if-none-match'] ?? '-'}`)
  if (req.headers['if-none-match'] === PRESETS_ETAG) {
    res.writeHead(304, { ETag: PRESETS_ETAG }).end()
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json', ETag: PRESETS_ETAG }).end(PRESETS_BODY)
}).listen(PROVIDER_PORT, () => console.log(`[provider] :${PROVIDER_PORT}/automation/presets`))

// ── Worker, behind an edge-router shim ──────────────────────────────────────
createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length ? Buffer.concat(chunks) : undefined

    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v)
    }
    // What edge-router stamps in production, from the session cookie.
    headers.set('X-Edge-Auth', EDGE_SECRET)
    headers.set('X-Hadoku-Tier', USER.tier)
    headers.set('X-User-Key', USER.key)
    headers.set('X-User-Id', USER.id)

    const response = await app.request(
      `http://localhost${req.url}`,
      { method: req.method, headers, body: body as unknown as BodyInit },
      env
    )
    const out = Buffer.from(await response.arrayBuffer())
    const outHeaders: Record<string, string> = {}
    response.headers.forEach((v, k) => (outHeaders[k] = v))
    res.writeHead(response.status, outHeaders).end(out)
  } catch (e) {
    // One bad request must not take the dev stack down mid-test-run.
    console.error(`[worker] ${req.method} ${req.url} →`, e)
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
    )
  }
}).listen(API_PORT, () => console.log(`[worker]   :${API_PORT} (user=${USER.key}/${USER.tier})`))
