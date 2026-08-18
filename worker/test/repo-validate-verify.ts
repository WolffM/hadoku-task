/**
 * GET /task/api/repos/validate — the repo-link check, which nothing tested.
 *
 * WHY THIS EXISTS
 * ---------------
 * vibeCompact flags worker/src/routes/automation.ts on size, and splitting it
 * needs a test first. Most of that file is covered hard — automation-verify,
 * presets-verify and actionable-verify drive activate/deactivate, the repo
 * link, presets and the actionable scan over real HTTP. This route was covered
 * by nothing: no harness referenced `/repos/validate`, and no Playwright spec
 * did either, even though AutomationPanel calls it every time someone types a
 * repo into the automation flow.
 *
 * It is the branchiest function in the file — five outcomes, each with its own
 * user-facing message, and a message that changes depending on whether a token
 * is bound. So it gets characterized before it moves.
 *
 * GitHub is stubbed. `app.request()` does not route through global fetch, so
 * only api.github.com is intercepted and nothing else in the worker is affected.
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
function section(t: string) {
  console.log(`\n${t}`)
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

/** What the stubbed api.github.com answers next, and what it was asked. */
let githubReply: { status: number; body?: unknown } = { status: 200 }
let lastRequest: { url: string; headers: Record<string, string> } | null = null

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (!url.startsWith('https://api.github.com/')) return realFetch(input as string, init)
  lastRequest = { url, headers: (init?.headers ?? {}) as Record<string, string> }
  return new Response(JSON.stringify(githubReply.body ?? {}), {
    status: githubReply.status,
    headers: { 'Content-Type': 'application/json' }
  })
}) as typeof fetch

interface Body {
  repo?: string
  valid?: boolean
  reason?: string
  message?: string
  private?: boolean
  defaultBranch?: string
}

/** Call the route as `tier`, with or without a GITHUB_READ_TOKEN bound. */
async function validate(
  repo: string,
  opts: { tier?: string; token?: string } = {}
): Promise<{ status: number; json: Body }> {
  const env: Record<string, unknown> = {
    TASKS_KV: makeKV(),
    DB: d1,
    EDGE_AUTH_SECRET: EDGE_SECRET,
    TASK_STORAGE: 'd1'
  }
  if (opts.token) env.GITHUB_READ_TOKEN = opts.token
  const res = await app.request(
    `http://localhost/task/api/repos/validate?repo=${encodeURIComponent(repo)}`,
    {
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': opts.tier ?? 'friend',
        'X-User-Key': 'user-key',
        'X-User-Id': 'user-uid'
      }
    },
    env
  )
  return { status: res.status, json: (await res.json()) as Body }
}

async function main() {
  console.log('repo validation (GET /task/api/repos/validate)')

  // -------------------------------------------------------------------
  section('1. The shape is wrong before GitHub is ever asked')
  // -------------------------------------------------------------------
  lastRequest = null
  let r = await validate('not-a-repo', { token: 't' })
  check('a malformed ref → 200 (never a 4xx)', r.status === 200, `status=${r.status}`)
  check('reason is bad_format', r.json.reason === 'bad_format', JSON.stringify(r.json))
  check('and it is not valid', r.json.valid === false, JSON.stringify(r.json))
  check('the message says what to type', /owner\/repo/.test(r.json.message ?? ''), r.json.message)
  check('GitHub was never called', lastRequest === null, JSON.stringify(lastRequest))

  r = await validate('  WolffM/hadoku-task  ', { token: 't' })
  check(
    'a ref is trimmed before the format check',
    r.json.reason !== 'bad_format',
    JSON.stringify(r.json)
  )

  // -------------------------------------------------------------------
  section('2. A repo GitHub knows')
  // -------------------------------------------------------------------
  githubReply = {
    status: 200,
    body: { full_name: 'WolffM/hadoku-task', private: true, default_branch: 'main' }
  }
  r = await validate('WolffM/hadoku-task', { token: 'tok-123' })
  check('valid', r.json.valid === true, JSON.stringify(r.json))
  check('reason is ok', r.json.reason === 'ok', JSON.stringify(r.json))
  check(
    'it echoes GitHub full_name, not what was typed',
    r.json.repo === 'WolffM/hadoku-task',
    r.json.repo
  )
  check('private is reported', r.json.private === true, JSON.stringify(r.json))
  check('so is the default branch', r.json.defaultBranch === 'main', JSON.stringify(r.json))
  check(
    'the bound token is sent as a Bearer credential',
    lastRequest?.headers.Authorization === 'Bearer tok-123',
    JSON.stringify(lastRequest?.headers)
  )

  // -------------------------------------------------------------------
  section('3. 404 — and the message depends on whether a token is bound')
  // -------------------------------------------------------------------
  githubReply = { status: 404 }
  r = await validate('WolffM/nope', { token: 'tok-123' })
  check(
    'not_found_or_no_access',
    r.json.reason === 'not_found_or_no_access',
    JSON.stringify(r.json)
  )
  check(
    'with a token, the message blames token ACCESS',
    /lacks access/.test(r.json.message ?? ''),
    r.json.message
  )

  r = await validate('WolffM/nope')
  check(
    'without one, it says private validation needs the binding',
    /private-repo validation/.test(r.json.message ?? ''),
    r.json.message
  )
  check(
    'and no Authorization header goes out',
    lastRequest?.headers.Authorization === undefined,
    JSON.stringify(lastRequest?.headers)
  )

  // -------------------------------------------------------------------
  section('4. GitHub refusing us is not the same as the repo missing')
  // -------------------------------------------------------------------
  for (const status of [401, 403]) {
    githubReply = { status }
    r = await validate('WolffM/hadoku-task', { token: 'tok-123' })
    check(`${status} → reason token`, r.json.reason === 'token', JSON.stringify(r.json))
    check(
      `${status} names scope or rate limit`,
      /scope\/rate limit/.test(r.json.message ?? ''),
      r.json.message
    )
  }

  githubReply = { status: 500 }
  r = await validate('WolffM/hadoku-task', { token: 'tok-123' })
  check('any other status → reason error', r.json.reason === 'error', JSON.stringify(r.json))
  check('and it reports the status it saw', /500/.test(r.json.message ?? ''), r.json.message)

  // -------------------------------------------------------------------
  section('5. Signed out')
  // -------------------------------------------------------------------
  lastRequest = null
  r = await validate('WolffM/hadoku-task', { tier: 'public', token: 'tok-123' })
  check('a public caller still gets 200', r.status === 200, `status=${r.status}`)
  check('reason token', r.json.reason === 'token', JSON.stringify(r.json))
  check('the message asks them to sign in', /Sign in/.test(r.json.message ?? ''), r.json.message)
  check('the repo echoes back empty', r.json.repo === '', JSON.stringify(r.json))
  check('and GitHub is never consulted for them', lastRequest === null, JSON.stringify(lastRequest))

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
