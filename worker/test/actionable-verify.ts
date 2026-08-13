/**
 * Open-items scan runtime verification (§5.6) — `GET /boards/{ref}/actionable`.
 *
 * Boots the REAL worker against a STUBBED TenHands, so we control what the
 * provider says and how it fails. What matters here is that a board LOAD calls
 * this: every failure has to come back as an explained empty list, never a 500
 * and never an outage dressed up as "nothing left to do". Proves:
 *
 *   - the provider base is derived from the preset source, not a second binding;
 *   - our OWN service key is sent (X-User-Key), never the caller's credential;
 *   - the board's HANDLE is what the provider is asked about;
 *   - a board with no repo, a standard board, and a public caller each answer
 *     without touching the network;
 *   - provider 4xx/5xx, timeouts, and junk payloads degrade to ok:false + reason;
 *   - malformed items are dropped, and a missing suggested_title is derived;
 *   - readonly access is refused (it could not create the tasks anyway);
 *   - the items round-trip into ordinary Inbox tasks — untagged, notes intact.
 *
 * Run via: pnpm run test:worker  (or `... actionable-verify`).
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')
const PRESETS_URL = 'https://tenhands.test/tenhands/automation/presets'
const ACTIONABLE_PREFIX = 'https://tenhands.test/tenhands/api/taskauto/actionable'
const SERVICE_KEY = 'tenhands-service-key-value'

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
  { tag: 'todo', label: 'To Do', order: 0, editableBy: 'user' },
  { tag: 'working', label: 'Working', order: 1, editableBy: 'agent' }
]

// ── Provider stub ───────────────────────────────────────────────────────────
interface Call {
  url: string
  key: string | null
}
const calls: Call[] = []
/** What the stub answers next. Set per scenario. */
let respond: () => { status?: number; body?: unknown; throws?: 'timeout' | 'refused' } = () => ({
  body: { success: true, repo: 'WolffM/hadoku-task', items: [] }
})

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith(ACTIONABLE_PREFIX)) return realFetch(input as RequestInfo, init)
  const headers = new Headers(init?.headers as HeadersInit)
  calls.push({ url, key: headers.get('X-User-Key') })
  const r = respond()
  // What AbortSignal.timeout() actually throws, name and all — a hand-rolled
  // Error would let a detection bug pass here and fail against a real origin.
  if (r.throws === 'timeout') {
    const err = new Error('The operation was aborted due to timeout')
    err.name = 'TimeoutError'
    throw err
  }
  if (r.throws === 'refused') throw new Error('connect ECONNREFUSED')
  return new Response(JSON.stringify(r.body ?? {}), {
    status: r.status ?? 200,
    headers: { 'Content-Type': 'application/json' }
  })
}) as typeof fetch

const env: Record<string, unknown> = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  AUTOMATION_PRESET_SOURCES: JSON.stringify([
    { id: 'tenhands', label: 'TenHands', url: PRESETS_URL }
  ]),
  TENHANDS_SERVICE_KEY: SERVICE_KEY
}
/** The same install with one binding removed/changed. */
function envWithout(key: string, replacement?: unknown): Record<string, unknown> {
  const copy = { ...env }
  if (replacement === undefined) delete copy[key]
  else copy[key] = replacement
  return copy
}

const OWNER = { key: 'owner-key', id: 'owner-uid' }
const OTHER = { key: 'other-key', id: 'other-uid' }

function headersFor(user: { key: string; id: string }, tier = 'friend') {
  return {
    'X-Edge-Auth': EDGE_SECRET,
    'X-Hadoku-Tier': tier,
    'X-User-Key': user.key,
    'X-User-Id': user.id,
    'Content-Type': 'application/json'
  }
}

interface ScanBody {
  ok: boolean
  repo: string | null
  items: Array<{
    kind: string
    number: number
    title: string
    url: string
    suggestedTitle: string
    bodySnippet?: string
    headRef?: string
    author?: string
  }>
  reason?: string
}

async function scan(
  ref: string,
  opts: { user?: { key: string; id: string }; tier?: string; env?: Record<string, unknown> } = {}
): Promise<{ status: number; body: ScanBody }> {
  const res = await app.request(
    `http://localhost/task/api/boards/${ref}/actionable`,
    { headers: headersFor(opts.user ?? OWNER, opts.tier ?? 'friend') },
    opts.env ?? env
  )
  return { status: res.status, body: (await res.json()) as ScanBody }
}

async function seedBoard(
  id: string,
  opts: { repo?: string; automation?: boolean; user?: { key: string; id: string } } = {}
) {
  const user = opts.user ?? OWNER
  await app.request(
    'http://localhost/task/api/boards',
    { method: 'POST', headers: headersFor(user), body: JSON.stringify({ id, name: id }) },
    env
  )
  if (opts.automation) {
    await app.request(
      `http://localhost/task/api/boards/${id}/activate-automation`,
      { method: 'POST', headers: headersFor(user), body: JSON.stringify({ lanes: LANES }) },
      env
    )
  }
  if (opts.repo) {
    await app.request(
      `http://localhost/task/api/boards/${id}/repo`,
      { method: 'POST', headers: headersFor(user), body: JSON.stringify({ repo: opts.repo }) },
      env
    )
  }
}

/** The board's handle, which is what the provider is addressed by. */
async function handleOf(id: string): Promise<string> {
  const row = await d1
    .prepare('SELECT handle FROM boards WHERE user_id = ? AND id = ?')
    .bind(OWNER.id, id)
    .first<{ handle: string }>()
  return row?.handle ?? ''
}

const ITEMS = [
  {
    kind: 'issue',
    number: 42,
    title: 'Board switch drops the filter',
    url: 'https://github.com/WolffM/hadoku-task/issues/42',
    author: 'someone',
    suggested_title: 'Address #42',
    body_snippet: 'Switching boards leaves the old filter applied.'
  },
  {
    kind: 'pr',
    number: 17,
    title: 'Add a retry to the sync path',
    url: 'https://github.com/WolffM/hadoku-task/pull/17',
    author: 'contributor',
    head_ref: 'feature-sync-retry',
    suggested_title: 'Address PR #17',
    body_snippet: 'CI is red and review left comments.'
  }
]

async function main() {
  console.log('Open-items scan (§5.6)')

  // ────────────────────────────────────────────────────────────────────────────
  section('1. Structural answers cost no network call')
  {
    await seedBoard('standard-board', { repo: 'WolffM/hadoku-task' })
    const before = calls.length
    const std = await scan('standard-board')
    check('standard board → ok, reason names why', std.body.reason === 'not_automation')
    check('standard board → no items', std.body.items.length === 0)
    check('standard board → trustworthy (ok:true)', std.body.ok === true)

    await seedBoard('no-repo-board', { automation: true })
    const noRepo = await scan('no-repo-board')
    check('automation board with no repo → reason no_repo', noRepo.body.reason === 'no_repo')
    check('…and ok:true — definitely nothing to do', noRepo.body.ok === true)

    const pub = await scan('no-repo-board', { tier: 'public' })
    check('public caller → signed_out', pub.body.reason === 'signed_out')
    check('public caller → ok:false', pub.body.ok === false)

    check('none of the above contacted the provider', calls.length === before, `${calls.length}`)
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('2. The provider is asked with OUR key, about the board’s HANDLE')
  {
    await seedBoard('auto-board', { automation: true, repo: 'WolffM/hadoku-task' })
    respond = () => ({ body: { success: true, repo: 'WolffM/hadoku-task', items: ITEMS } })
    const before = calls.length
    const r = await scan('auto-board')

    check('provider contacted exactly once', calls.length === before + 1)
    const call = calls[calls.length - 1]
    check(
      'base derived from the preset source URL',
      call.url.startsWith('https://tenhands.test/tenhands/api/taskauto/actionable'),
      call.url
    )
    check('our service key is sent', call.key === SERVICE_KEY, `${call.key}`)
    check(
      'the CALLER’s credential is never forwarded',
      call.key !== OWNER.key && call.key !== OTHER.key
    )
    const handle = await handleOf('auto-board')
    check('handle is non-empty', handle.length > 0)
    check(
      'the board is identified by its handle',
      call.url.endsWith(`board=${encodeURIComponent(handle)}`),
      `${call.url} (handle=${handle})`
    )

    check('both items come back', r.body.items.length === 2, JSON.stringify(r.body))
    check('repo reported', r.body.repo === 'WolffM/hadoku-task')
    const issue = r.body.items.find(i => i.kind === 'issue')
    const pr = r.body.items.find(i => i.kind === 'pr')
    check('issue keeps its suggested title', issue?.suggestedTitle === 'Address #42')
    check('issue keeps its snippet', issue?.bodySnippet?.startsWith('Switching boards') === true)
    check('PR carries its head ref', pr?.headRef === 'feature-sync-retry')
    check('PR keeps its suggested title', pr?.suggestedTitle === 'Address PR #17')
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('3. A junk payload is filtered, not trusted wholesale')
  {
    respond = () => ({
      body: {
        success: true,
        repo: 'WolffM/hadoku-task',
        items: [
          { kind: 'issue', number: 7, url: 'https://github.com/x/y/issues/7' }, // no title
          { kind: 'issue', number: 8, title: 'no url' },
          { kind: 'discussion', number: 9, title: 'wrong kind', url: 'https://x/9' },
          { kind: 'pr', number: 'ten', title: 'bad number', url: 'https://x/10' },
          null,
          'not an object'
        ]
      }
    })
    const r = await scan('auto-board')
    check('only the usable item survives', r.body.items.length === 1, JSON.stringify(r.body.items))
    check('…and it is the one with a url', r.body.items[0]?.number === 7)
    check(
      'a missing suggested_title is derived',
      r.body.items[0]?.suggestedTitle === 'Address #7',
      r.body.items[0]?.suggestedTitle
    )
    check(
      'a missing title falls back rather than dropping the work',
      r.body.items[0]?.title === 'Issue #7',
      r.body.items[0]?.title
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('4. Provider failures degrade — a board load never fails')
  {
    const cases: Array<[string, () => ReturnType<typeof respond>, string]> = [
      ['401', () => ({ status: 401, body: { error: 'unauthorized' } }), 'provider_401'],
      ['500', () => ({ status: 500, body: {} }), 'provider_500'],
      ['timeout', () => ({ throws: 'timeout' as const }), 'provider_timeout'],
      ['unreachable', () => ({ throws: 'refused' as const }), 'provider_unreachable'],
      ['junk body', () => ({ body: { success: true, repo: 'x' } }), 'bad_payload'],
      [
        'success:false',
        () => ({ body: { success: false, error: 'no such board' } }),
        'provider_reported_failure'
      ]
    ]
    for (const [name, r, reason] of cases) {
      respond = r
      const res = await scan('auto-board')
      check(`${name} → 200 to the browser`, res.status === 200, `${res.status}`)
      check(`${name} → ok:false`, res.body.ok === false)
      check(`${name} → reason ${reason}`, res.body.reason === reason, res.body.reason)
      check(`${name} → no items invented`, res.body.items.length === 0)
    }
  }

  section('5. An unconfigured install says so instead of calling out')
  {
    respond = () => ({ body: { success: true, repo: 'r', items: ITEMS } })
    const before = calls.length
    const noKey = await scan('auto-board', { env: envWithout('TENHANDS_SERVICE_KEY') })
    check('no service key → reason no_service_key', noKey.body.reason === 'no_service_key')
    const noProvider = await scan('auto-board', { env: envWithout('AUTOMATION_PRESET_SOURCES') })
    check(
      'no provider → reason no_provider_configured',
      noProvider.body.reason === 'no_provider_configured'
    )
    const ambiguous = await scan('auto-board', {
      env: envWithout(
        'AUTOMATION_PRESET_SOURCES',
        JSON.stringify([
          { id: 'a', label: 'A', url: 'https://a.test/automation/presets' },
          { id: 'b', label: 'B', url: 'https://b.test/automation/presets' }
        ])
      )
    })
    check(
      'two anonymous providers → we do not guess which is TenHands',
      ambiguous.body.reason === 'no_provider_configured',
      ambiguous.body.reason
    )
    check('none of those reached the network', calls.length === before, `${calls.length}`)

    // …but a source explicitly declared `tenhands` alongside others IS found.
    const picked = await scan('auto-board', {
      env: envWithout(
        'AUTOMATION_PRESET_SOURCES',
        JSON.stringify([
          { id: 'other', label: 'Other', url: 'https://a.test/automation/presets' },
          { id: 'tenhands', label: 'TenHands', url: PRESETS_URL }
        ])
      )
    })
    check('the tenhands source wins over a sibling', picked.body.ok === true, picked.body.reason)
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('6. Access gates')
  {
    const missing = await scan('a-board-that-is-not-a-handle-owned-by-anyone', { user: OTHER })
    // An unknown slug is the caller's own not-yet-created board; it has no row,
    // so the config read is what turns it into a 404 rather than a scan.
    check('unknown board → 404', missing.status === 404, `${missing.status}`)

    // Share the automation board readonly and try from the grantee.
    const handle = await handleOf('auto-board')
    const granted = await app.request(
      `http://localhost/task/api/boards/auto-board/shares`,
      {
        method: 'POST',
        headers: headersFor(OWNER),
        body: JSON.stringify({ userId: OTHER.id, level: 'readonly' })
      },
      env
    )
    check('readonly share granted', granted.status === 200, `${granted.status}`)
    respond = () => ({ body: { success: true, repo: 'r', items: ITEMS } })
    const before = calls.length
    const ro = await scan(handle, { user: OTHER })
    check('readonly caller → 403', ro.status === 403, `${ro.status}`)
    check('readonly caller → provider not contacted', calls.length === before)
  }

  // ────────────────────────────────────────────────────────────────────────────
  section('7. The items become ordinary Inbox tasks (the point of all this)')
  {
    respond = () => ({ body: { success: true, repo: 'WolffM/hadoku-task', items: ITEMS } })
    const r = await scan('auto-board')
    check('scan returned the items', r.body.items.length === 2)

    let seq = 0
    for (const item of r.body.items) {
      const notes = [
        item.url,
        item.title,
        '',
        item.bodySnippet ?? '',
        '',
        item.kind === 'pr'
          ? `Check out branch ${item.headRef} and address the outstanding review/CI feedback.`
          : 'Reproduce if needed, fix it, and open a PR.'
      ].join('\n')
      const created = await app.request(
        'http://localhost/task/api',
        {
          method: 'POST',
          headers: headersFor(OWNER),
          // A client-generated id, exactly as the browser sends one.
          body: JSON.stringify({
            id: `actionable-${++seq}`,
            title: item.suggestedTitle,
            notes,
            boardId: 'auto-board'
          })
        },
        env
      )
      check(`created "${item.suggestedTitle}"`, created.status === 200, `${created.status}`)
    }

    const board = await app.request(
      'http://localhost/task/api/boards/auto-board',
      { headers: headersFor(OWNER) },
      env
    )
    const body = (await board.json()) as {
      tasks?: Array<{ title: string; tag?: string | null; notes?: string | null }>
    }
    const tasks = body.tasks ?? []
    const addressed = tasks.filter(t => /^Address (PR )?#\d+$/.test(t.title))
    check(
      'both tasks are on the board',
      addressed.length === 2,
      JSON.stringify(tasks.map(t => t.title))
    )
    check(
      'they are UNTAGGED — the Inbox, not a lane',
      addressed.every(t => !t.tag),
      JSON.stringify(addressed.map(t => t.tag))
    )
    const prTask = addressed.find(t => t.title === 'Address PR #17')
    check('the PR task links the PR', prTask?.notes?.includes('/pull/17') === true)
    check(
      'the PR task names the branch to check out',
      prTask?.notes?.includes('Check out branch feature-sync-retry') === true,
      prTask?.notes ?? ''
    )
    const issueTask = addressed.find(t => t.title === 'Address #42')
    check(
      'the issue task carries the fix instruction',
      issueTask?.notes?.includes('Reproduce if needed, fix it, and open a PR.') === true
    )
    check(
      'the issue task carries the snippet',
      issueTask?.notes?.includes('Switching boards leaves the old filter applied.') === true
    )
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
