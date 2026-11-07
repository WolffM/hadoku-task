/**
 * Who gets server storage — the member model (#107), against the REAL worker
 * and a real sqlite D1.
 *
 *   - no edge-stamped userId (anonymous; a member the edge withheld) → 401,
 *     and nothing is written under the old shared `'public'` owner;
 *   - an unverified member → 403;
 *   - a verified member → stores and reads back, exactly as a friend does,
 *     including the share-name search a friend gets;
 *   - friend and up → unchanged, with or without the verified header;
 *   - routes that need no identity (health, validate-key, openapi) stay open.
 *
 * Run via: pnpm run test:worker  (or `... storage-access-verify`).
 */
import { join } from 'node:path'
import { TIER_RANK } from '@wolffm/worker-utils'
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
    },
    async list({ prefix }: { prefix?: string } = {}) {
      return {
        keys: [...store.keys()].filter(k => k.startsWith(prefix ?? '')).map(name => ({ name })),
        list_complete: true
      }
    }
  }
}

const d1: FakeD1 = makeSqliteD1(MIGRATION)
const env = {
  TASKS_KV: makeKV(),
  SESSIONS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET
} as Record<string, unknown>
const app = createTaskHandler()

interface Caller {
  tier: string
  userId?: string
  verified?: boolean
}

async function req(
  who: Caller,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const headers: Record<string, string> = {
    'X-Edge-Auth': EDGE_SECRET,
    'X-Hadoku-Tier': who.tier,
    'Content-Type': 'application/json'
  }
  if (who.userId) {
    headers['X-User-Key'] = `key-${who.userId}`
    headers['X-User-Id'] = who.userId
  }
  if (who.verified) headers['X-Hadoku-Verified'] = '1'
  const res = await app.request(
    'http://localhost' + path,
    { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined },
    env
  )
  let json: Record<string, unknown> | null = null
  try {
    json = (await res.clone().json()) as Record<string, unknown>
  } catch {
    // Not JSON (openapi.json is, health is) — callers only read status then.
    json = null
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
function section(t: string) {
  console.log(`\n${t}`)
}

const ANON: Caller = { tier: 'public' }
const MEMBER: Caller = { tier: 'member', userId: 'member-uid' }
const VERIFIED: Caller = { tier: 'member', userId: 'verified-uid', verified: true }
const FRIEND: Caller = { tier: 'friend', userId: 'friend-uid' }

const createTask = (title: string) => ({ id: `t-${title}`, title, board: 'main' })

async function rowsOwnedBy(userId: string): Promise<number> {
  const db = d1 as unknown as {
    prepare(sql: string): { bind(...a: unknown[]): { first<T>(): Promise<T | null> } }
  }
  const boards = await db
    .prepare('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>()
  const tasks = await db
    .prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>()
  return (boards?.n ?? 0) + (tasks?.n ?? 0)
}

async function main() {
  section('1. No identity: refused, and the shared public owner gets nothing')
  for (const [method, path, body] of [
    ['GET', '/task/api/boards', undefined],
    ['POST', '/task/api', createTask('anon')],
    ['GET', '/task/api/tasks?board=main', undefined],
    ['GET', '/task/api/users/search?q=a', undefined]
  ] as const) {
    const r = await req(ANON, method, path, body)
    check(
      `anonymous ${method} ${path} → 401 IDENTITY_REQUIRED`,
      r.status === 401 && r.json?.code === 'IDENTITY_REQUIRED',
      `status=${r.status} ${JSON.stringify(r.json)}`
    )
  }
  {
    const r = await req(ANON, 'POST', '/task/api/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    })
    check('anonymous MCP → 401', r.status === 401, `status=${r.status}`)
  }
  check("nothing was written under 'public'", (await rowsOwnedBy('public')) === 0)

  section('2. An unverified member: refused')
  for (const [method, path, body] of [
    ['GET', '/task/api/boards', undefined],
    ['POST', '/task/api', createTask('member')]
  ] as const) {
    const r = await req(MEMBER, method, path, body)
    check(
      `unverified member ${method} ${path} → 403 MEMBER_NOT_VERIFIED`,
      r.status === 403 && r.json?.code === 'MEMBER_NOT_VERIFIED',
      `status=${r.status} ${JSON.stringify(r.json)}`
    )
  }
  check('nothing was written for the unverified member', (await rowsOwnedBy('member-uid')) === 0)

  section('3. A verified member stores like a friend')
  for (const [who, userId] of [
    [VERIFIED, 'verified-uid'],
    [FRIEND, 'friend-uid']
  ] as const) {
    const label = who === VERIFIED ? 'verified member' : 'friend'
    const created = await req(who, 'POST', '/task/api', createTask(label))
    check(`${label} creates a task → 200`, created.status === 200, `status=${created.status}`)
    const boards = await req(who, 'GET', '/task/api/boards')
    const tasks = (boards.json?.boards as Array<{ tasks: Array<{ title: string }> }> | undefined)
      ?.flatMap(b => b.tasks)
      .map(t => t.title)
    check(
      `${label} reads it back from GET /boards`,
      boards.status === 200 && !!tasks?.includes(label),
      `status=${boards.status} ${JSON.stringify(tasks)}`
    )
    check(`${label}'s rows are under their own userId`, (await rowsOwnedBy(userId)) > 0)
    const search = await req(who, 'GET', '/task/api/users/search?q=a')
    check(
      `${label} may search names to share with`,
      search.status === 200,
      `status=${search.status}`
    )
  }

  section('4. Friend and up need no verified header; a member still does')
  // Derived from the ladder rather than a hand-typed "friend and up" list, so
  // a tier added above friend is covered automatically. member is the one
  // non-public tier that fails this (sections 2-3 already pin why: it needs
  // the header).
  for (const tier of Object.keys(TIER_RANK).filter(t => t !== 'public')) {
    const r = await req({ tier, userId: `${tier}-2` }, 'GET', '/task/api/boards')
    const want = TIER_RANK[tier] >= TIER_RANK.friend ? 200 : 403
    check(`${tier} without X-Hadoku-Verified → ${want}`, r.status === want, `status=${r.status}`)
  }

  section('5. Routes that need no identity stay open')
  check('health', (await req(ANON, 'GET', '/task/api/health')).status === 200)
  check('validate-key', (await req(ANON, 'POST', '/task/api/validate-key', {})).status !== 401)
  check('openapi.json', (await req(ANON, 'GET', '/task/api/openapi.json')).status === 200)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
