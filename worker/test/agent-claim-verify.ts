/**
 * T7 agent claim-protocol runtime verification — the CONCURRENCY proof (§4, §11).
 *
 * Boots the REAL worker against a REAL SQLite D1 and drives claim / heartbeat /
 * set-lane / release over HTTP + MCP. Proves:
 *
 *   - N concurrent claims on one task → EXACTLY ONE wins, the rest 409 CLAIM_HELD;
 *   - a live lease can't be stolen; an EXPIRED one can (forced via raw SQL, no sleep);
 *   - heartbeat with a stale token → 409 LEASE_LOST;
 *   - set-lane is the agent path (may enter an `agent` lane), LANE_UNKNOWN on a
 *     non-lane, LEASE_LOST without the claim;
 *   - release moves the task + writes notes + unclaims, is idempotent on token,
 *     and 409 LANE_CHANGED when `ifCurrentLane` doesn't match;
 *   - release never changes state / never completes-or-deletes (§5.6);
 *   - an unclaimed agent lane is escapable by a human (§5.2);
 *   - the change feed cursors forward with zero extra writes;
 *   - MCP forwards the structured error `code` (§4.3).
 *
 * Run via: pnpm run test:worker  (or `... agent-claim-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')
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

const d1: FakeD1 = makeSqliteD1(MIGRATION)

const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1'
} as Record<string, unknown>
const app = createTaskHandler()

const OWNER = { key: 'owner-key', id: 'owner-uid' }

import { type Body, type Ctx } from './scenarios/agent-claim-context'
import { runClaimProtocol } from './scenarios/agent-claim-protocol'
import { runAgentSurface } from './scenarios/agent-claim-surface'

async function req(
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
        'X-User-Key': OWNER.key,
        'X-User-Id': OWNER.id,
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
    /* */
  }
  return { status: res.status, json }
}

async function mcp(tool: string, args: Record<string, unknown> = {}): Promise<Body> {
  const res = await app.request(
    'http://localhost/task/api/mcp',
    {
      method: 'POST',
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': 'friend',
        'X-User-Key': OWNER.key,
        'X-User-Id': OWNER.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args }
      })
    },
    env
  )
  return ((await res.json()) as { result?: Body }).result ?? {}
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

async function tag(taskId: string): Promise<string | null | undefined> {
  const r = await req('GET', '/task/api/tasks?boardId=auto')
  return r.json?.tasks?.find(t => t.id === taskId)?.tag
}
function forceExpire(taskId: string) {
  const past = new Date(Date.now() - 60_000).toISOString()
  d1.__raw
    .prepare('UPDATE task_claims SET expires_at = ? WHERE user_id = ? AND task_id = ?')
    .run(past, OWNER.id, taskId)
}

async function main() {
  console.log('T7 agent claim-protocol runtime verification (concurrency)')

  const ctx: Ctx = { req, mcp, check, section, tag, forceExpire, app, env, EDGE_SECRET }

  // Ordered, not independent: the surface sections act on the board and task
  // the protocol sections leave behind.
  await runClaimProtocol(ctx)
  await runAgentSurface(ctx)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
