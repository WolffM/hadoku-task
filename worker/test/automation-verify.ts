/**
 * T6 automation-board runtime verification (§5).
 *
 * Boots the REAL worker against a REAL SQLite D1 and drives it over HTTP + MCP.
 * Proves activation-as-migration and lane enforcement:
 *
 *   - dryRun previews the tag->lane migration + a digest and writes NOTHING;
 *   - a commit echoing the digest applies it: mapped tags kept, unmapped tags
 *     cleared to the Inbox with the original preserved in metadata;
 *   - a stale/bogus digest -> 409 DIGEST_MISMATCH;
 *   - the human path (HTTP PATCH + MCP update_task) may land a task only in a
 *     `user` lane: an `agent` lane -> 403 LANE_NOT_EDITABLE, a non-lane -> 422
 *     LANE_INVALID, clearing to Inbox is allowed;
 *   - the lane structure is locked: createTag/deleteTag/batchClearTag -> 409;
 *   - a bad lane set -> 422 LANE_SET_INVALID; activation is owner-only;
 *   - re-activation clears tasks in removed lanes to the Inbox;
 *   - deactivate restores the standard tag list;
 *   - an owner's committing activation auto-shares the board with the automation
 *     runner (resolved by registry NAME), proven functionally: the runner reads,
 *     claims and set-lanes a board nobody hand-shared. Idempotent, never escalates
 *     an owner's deliberate `readonly`, owner-only, and reports why when it can't;
 *   - connecting a repo shares the board with THAT repo's service key, derived by
 *     the `<repo minus "hadoku->-service-key` convention: owner segment dropped,
 *     trim case-insensitive, an unminted key can't cost the repo mapping, and
 *     clearing the repo neither grants nor revokes;
 *   - POST /boards/reconcile-shares backfills links made BEFORE the auto-grants
 *     existed (legacy rows written straight into D1): dry run by default, both the
 *     repo (GitHub-probed, stubbed here) and the key name verified before any
 *     grant, force repairs a sub-contributor share and names what it replaced,
 *     and re-running grants nothing new.
 *
 * Run via: pnpm run test:worker  (or `... automation-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')

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

// Mock the read-only key registry: key:{rawKey} → { userId, name, tier }. `list` is
// needed as well as `get` because resolving a grantee by NAME (which is how the
// automation runner is found) scans the `key:` prefix.
function makeSessionsKV(
  entries: Record<string, { userId?: string; name?: string; tier?: string; retiredAt?: number }>
) {
  const store = new Map<string, string>()
  for (const [rawKey, rec] of Object.entries(entries)) {
    store.set(`key:${rawKey}`, JSON.stringify(rec))
  }
  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async list({ prefix }: { prefix: string } = { prefix: '' }) {
      return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }
    },
    async put() {},
    async delete() {}
  }
}

const d1: FakeD1 = makeSqliteD1(MIGRATION)

const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  SESSIONS_KV: makeSessionsKV({
    'contrib-key': { userId: 'contrib-uid' },
    // The automation runner's real prod identity (§7): the name auto-share resolves.
    'tenhands-key': { userId: 'tenhands-uid', name: 'tenhands-service-key', tier: 'service' },
    // The operator-side dev-vault caller shares the stem but must never be picked.
    'tenhands-devvault-key': { userId: 'devvault-uid', name: 'tenhands-devvault', tier: 'service' },
    // A repo's own service key, named by the convention
    // `<repo, minus a leading "hadoku-">-service-key` (§5.5).
    'aggregator-key': { userId: 'aggregator-uid', name: 'aggregator-service-key', tier: 'service' },
    // The real key for WolffM/hadoku_site — the one repo that spells the prefix
    // with an underscore, which a hyphen-only trim would fail to resolve.
    'site-key': { userId: 'site-uid', name: 'site-service-key', tier: 'service' }
  })
} as Record<string, unknown>

/**
 * Stub GitHub, so the reconcile's repo probe is deterministic and offline. Only
 * api.github.com is intercepted; `app.request()` doesn't route through global
 * fetch, so nothing else in the harness is affected.
 */
const GITHUB_KNOWN = new Set([
  'WolffM/hadoku-aggregator',
  'WolffM/hadoku_site',
  'WolffM/tenhands',
  'WolffM/hadoku-task'
])
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const m = url.match(/^https:\/\/api\.github\.com\/repos\/(.+)$/)
  if (!m) return realFetch(input as RequestInfo, init)
  const full = m[1]
  if (!GITHUB_KNOWN.has(full)) return new Response('{}', { status: 404 })
  return new Response(JSON.stringify({ full_name: full, private: true, default_branch: 'main' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}) as typeof fetch

const app = createTaskHandler()

import { type Body, type Ctx, type User } from './scenarios/automation-context'
import { runCoreFlow } from './scenarios/automation-core'
import { runShareGrants } from './scenarios/automation-grants'
import { runReconcile } from './scenarios/automation-reconcile'

async function req(
  user: User,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Body | null }> {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': user.key,
        'X-User-Id': user.id,
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

/** Same as `req`, but stamps a specific tier — edge-router sets this in prod. */
async function reqTier(
  user: User,
  tier: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Body | null }> {
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': tier,
        'X-User-Key': user.key,
        'X-User-Id': user.id,
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

async function mcp(
  user: User,
  tool: string,
  toolArgs: Record<string, unknown> = {}
): Promise<Body> {
  const res = await app.request(
    'http://localhost/task/api/mcp',
    {
      method: 'POST',
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': user.key,
        'X-User-Id': user.id,
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

async function tasks(user: User, board: string) {
  const r = await req(user, 'GET', `/task/api/tasks?boardId=${encodeURIComponent(board)}`)
  return r.json?.tasks ?? []
}

async function main() {
  console.log('T6 automation-board runtime verification')

  const ctx: Ctx = { req, reqTier, mcp, check, section, tasks, env, d1 }

  // Ordered, not independent: each phase acts on the boards the last left behind.
  await runCoreFlow(ctx) // 1-11  activation as a migration, and the lane rules
  await runShareGrants(ctx) // 12-13 the shares a board grants on its own behalf
  await runReconcile(ctx) // 14-15 backfilling the boards that predate them

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
