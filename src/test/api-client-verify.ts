/**
 * Characterization harness for src/api/client.ts.
 *
 * WHY THIS EXISTS
 * ---------------
 * `createApi` is a 780-line factory returning 27 methods, and the only thing
 * exercising it was Playwright driving the whole app — which covers the paths a
 * user walks and nothing else. That is thin cover for a refactor, because the
 * risk of moving a method between modules is not that the app breaks loudly; it
 * is that one of the 27 quietly changes the request it sends, or stops being
 * returned at all, on a path no spec happens to click.
 *
 * So this pins the observable contract rather than the implementation: the exact
 * method surface, and for each method the HTTP verb, URL, headers and body it
 * puts on the wire. Anything that survives a pure code move is fair game to
 * assert; nothing here reaches inside the factory.
 *
 * It runs under `pnpm run test:worker` (scripts/run-worker-verify.mjs already
 * scans src/test alongside worker/test), which is what CI runs.
 */
import { createApi } from '../api/client'

/**
 * `src/**` is compiled by the app's tsconfig, which carries no node types — so
 * this harness is typechecked (worker/test is not), and the one node global it
 * needs is declared rather than pulled in wholesale.
 */
declare const process: { exit(code: number): never }

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

/** One recorded outbound request. */
interface Call {
  method: string
  url: string
  body: unknown
  headers: Record<string, string>
}

/** A localStorage good enough for the client: real get/set/remove semantics. */
function installBrowserGlobals() {
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    }
  }
  const g = globalThis as Record<string, unknown>
  g.localStorage = ls
  g.window = { localStorage: ls, performance: { now: () => 0 } }
  return store
}

/**
 * Record every request and answer it. `body` is whatever the route should hand
 * back; the client only cares that it is JSON and `ok`.
 */
function installFetch(calls: Call[], reply: (url: string) => unknown) {
  ;(globalThis as Record<string, unknown>).fetch = async (
    url: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> }
  ) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      body: init?.body ? JSON.parse(init.body) : undefined,
      headers: init?.headers ?? {}
    })
    const payload = reply(String(url))
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      clone() {
        return this
      },
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    }
  }
}

/** The boards payload the client expects back from a sync. */
const BOARDS = {
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  boards: [{ id: 'main', name: 'Main', tasks: [], tags: [] }]
}

async function main() {
  console.log('src/api/client.ts characterization')

  installBrowserGlobals()

  // -------------------------------------------------------------------
  section('1. The method surface is exactly what callers depend on')
  // -------------------------------------------------------------------
  const api = createApi('friend', 'sess-1')
  const surface = Object.keys(api).sort()

  // Spelled out rather than snapshotted to a file: a rename is then a visible
  // diff in the test, not a silently-regenerated fixture.
  const EXPECTED = [
    'activateAutomation',
    'batchClearTag',
    'batchMoveTasks',
    'batchUpdateTags',
    'completeTask',
    'createBoard',
    'createTag',
    'createTask',
    'deactivateAutomation',
    'deleteBoard',
    'deleteTag',
    'deleteTask',
    'getBoards',
    'getPresetUpdate',
    'grantShare',
    'listActionable',
    'listAutomationPresets',
    'listShares',
    'patchTask',
    'renameBoard',
    'revokeShare',
    'searchUsers',
    'setPinnedBoards',
    'setRepo',
    'syncFromApi',
    'validateKey',
    'validateRepo'
  ]
  check(
    `all ${EXPECTED.length} methods are present, and no others`,
    JSON.stringify(surface) === JSON.stringify(EXPECTED),
    `missing=${JSON.stringify(EXPECTED.filter(m => !surface.includes(m)))} extra=${JSON.stringify(
      surface.filter(m => !EXPECTED.includes(m))
    )}`
  )
  check(
    'every one of them is callable',
    surface.every(k => typeof (api as Record<string, unknown>)[k] === 'function'),
    JSON.stringify(surface.filter(k => typeof (api as Record<string, unknown>)[k] !== 'function'))
  )

  // -------------------------------------------------------------------
  section('2. A public user never gets the syncing client')
  // -------------------------------------------------------------------
  const pub = createApi('public', 'anon-1') as unknown as Record<string, unknown>
  check(
    'public mode returns the localStorage client, which does not sync',
    !('syncFromApi' in pub),
    JSON.stringify(Object.keys(pub).sort())
  )
  for (const tier of ['friend', 'admin', 'wife', 'service'] as const) {
    const t = createApi(tier, 's') as unknown as Record<string, unknown>
    check(`${tier} gets the syncing client`, 'syncFromApi' in t)
  }

  // -------------------------------------------------------------------
  section('3. Each method puts the same request on the wire')
  // -------------------------------------------------------------------
  const calls: Call[] = []
  installFetch(calls, url => {
    if (url.includes('/boards')) return BOARDS
    if (url.includes('/automation/presets')) return { presets: [], sources: [] }
    if (url.includes('/actionable')) return { ok: true, repo: null, items: [] }
    if (url.includes('/preset-update')) return null
    if (url.includes('/repos/validate')) return { repo: 'a/b', valid: true, reason: 'ok' }
    if (url.includes('/users/search')) return { users: [] }
    if (url.includes('/shares')) return { shares: [] }
    if (url.includes('/validate-key')) return { valid: true }
    return { ok: true }
  })

  /**
   * Run one method and return the requests it made.
   *
   * The optimistic writes fire their fetch WITHOUT awaiting it — the local write
   * is what the UI sees, and the server call reconciles later — so the recorded
   * calls only settle after the microtask queue drains.
   */
  async function wire(label: string, run: () => Promise<unknown>): Promise<Call[]> {
    calls.length = 0
    try {
      await run()
    } catch (err) {
      check(`${label} did not throw`, false, String(err))
    }
    await new Promise(r => setTimeout(r, 0))
    return [...calls]
  }

  // Narrowed the way useTasks does it: createApi's return is a union of the
  // localStorage-only client and the syncing one, and `'syncFromApi' in api` is
  // how the real consumer picks the branch. Keeping the same idiom means the
  // harness fails if that discriminator ever stops working for callers.
  const maybe = createApi('friend', 'sess-1')
  if (!('syncFromApi' in maybe)) throw new Error('friend tier did not get the syncing client')
  const w = maybe

  const boards = await wire('getBoards', () => w.syncFromApi())
  check(
    'syncFromApi GETs /task/api/boards',
    boards.some(c => c.method === 'GET' && c.url.includes('/task/api/boards')),
    JSON.stringify(boards.map(c => `${c.method} ${c.url}`))
  )

  const created = await wire('createTask', () => w.createTask({ title: 'T' }, 'main'))
  check(
    'createTask POSTs /task/api carrying boardId in the BODY, not the query',
    created.some(
      c =>
        c.method === 'POST' &&
        c.url === '/task/api' &&
        (c.body as { boardId?: string })?.boardId === 'main'
    ),
    JSON.stringify(created.map(c => `${c.method} ${c.url} ${JSON.stringify(c.body)}`))
  )
  check(
    'and sends the client-generated id, so the server keeps the same one',
    created.some(c => typeof (c.body as { id?: string })?.id === 'string'),
    JSON.stringify(created.map(c => c.body))
  )

  // Seed a real task to act on. It has to happen AFTER the syncFromApi checks
  // above: a sync replaces the cached board with the stub's copy, which carries
  // no tasks, so anything seeded earlier is wiped. patch/complete/delete each
  // read the local task first — so a refusal can put it back — and throw
  // TaskNotFoundError against a cache that does not hold it.
  const seeded = await w.createTask({ title: 'seed' }, 'main')
  const seededId = (seeded as { id: string }).id
  check(
    'the seed task got a client-generated id',
    typeof seededId === 'string' && seededId.length > 0,
    String(seededId)
  )

  const patched = await wire('patchTask', () => w.patchTask(seededId, { title: 'x' }, 'main'))
  check(
    'patchTask PATCHes /task/api/{id}',
    patched.some(c => c.method === 'PATCH' && c.url.includes(`/task/api/${seededId}`)),
    JSON.stringify(patched.map(c => `${c.method} ${c.url}`))
  )

  const completed = await wire('completeTask', () => w.completeTask(seededId, 'main'))
  check(
    'completeTask POSTs /task/api/{id}/complete',
    completed.some(c => c.method === 'POST' && c.url.includes(`/${seededId}/complete`)),
    JSON.stringify(completed.map(c => `${c.method} ${c.url}`))
  )

  const deleted = await wire('deleteTask', () => w.deleteTask(seededId, 'main'))
  check(
    'deleteTask DELETEs /task/api/{id}',
    deleted.some(c => c.method === 'DELETE' && c.url.includes(`/task/api/${seededId}`)),
    JSON.stringify(deleted.map(c => `${c.method} ${c.url}`))
  )

  const batch = await wire('batchUpdateTags', () =>
    w.batchUpdateTags('main', [{ taskId: seededId, tag: 'x' }])
  )
  // The LEGACY alias, deliberately pinned: the client still calls
  // PATCH /task/api/batch-tag, not the newer /boards/{id}/tasks/batch/update-tags.
  // Both are live on the worker; which one this sends is the contract.
  check(
    'batchUpdateTags PATCHes the batch endpoint, not the single-task route',
    batch.some(c => c.method === 'PATCH' && c.url === '/task/api/batch-tag'),
    JSON.stringify(batch.map(c => `${c.method} ${c.url}`))
  )

  await w.createBoard('b2')
  const moved = await wire('batchMoveTasks', () => w.batchMoveTasks('main', 'b2', [seededId]))
  // Legacy alias again, same as batch-tag: the client calls /task/api/batch-move,
  // not /task/api/batch/move-tasks. Pinned because which alias ships is the
  // contract, and a refactor is exactly when one would quietly become the other.
  check(
    'batchMoveTasks POSTs /task/api/batch-move',
    moved.some(c => c.method === 'POST' && c.url === '/task/api/batch-move'),
    JSON.stringify(moved.map(c => `${c.method} ${c.url}`))
  )

  const cleared = await wire('batchClearTag', () => w.batchClearTag('main', 'x', [seededId]))
  check(
    'batchClearTag POSTs /batch-clear-tag',
    cleared.some(c => c.method === 'POST' && c.url.includes('/batch-clear-tag')),
    JSON.stringify(cleared.map(c => `${c.method} ${c.url}`))
  )

  const board = await wire('createBoard', () => w.createBoard('b1'))
  check(
    'createBoard POSTs /task/api/boards',
    board.some(c => c.method === 'POST' && c.url.endsWith('/task/api/boards')),
    JSON.stringify(board.map(c => `${c.method} ${c.url}`))
  )

  const renamed = await wire('renameBoard', () => w.renameBoard('b1', 'New'))
  check(
    'renameBoard PATCHes /task/api/boards/{id}',
    renamed.some(c => c.method === 'PATCH' && c.url.includes('/task/api/boards/b1')),
    JSON.stringify(renamed.map(c => `${c.method} ${c.url}`))
  )

  const pinned = await wire('setPinnedBoards', () => w.setPinnedBoards(['a', 'b']))
  check(
    'setPinnedBoards PUTs /task/api/boards/pinned',
    pinned.some(c => c.method === 'PUT' && c.url.includes('/boards/pinned')),
    JSON.stringify(pinned.map(c => `${c.method} ${c.url}`))
  )

  const shares = await wire('listShares', () => w.listShares('main'))
  check(
    'listShares GETs /task/api/boards/{ref}/shares',
    shares.some(c => c.url.includes('/boards/main/shares')),
    JSON.stringify(shares.map(c => `${c.method} ${c.url}`))
  )

  const granted = await wire('grantShare', () =>
    w.grantShare('main', { name: 'x', level: 'contributor' })
  )
  check(
    'grantShare POSTs the share, carrying the level',
    granted.some(
      c =>
        c.method === 'POST' &&
        c.url.includes('/shares') &&
        (c.body as { level?: string })?.level === 'contributor'
    ),
    JSON.stringify(granted.map(c => `${c.method} ${c.url} ${JSON.stringify(c.body)}`))
  )

  const revoked = await wire('revokeShare', () => w.revokeShare('main', 'u1'))
  check(
    'revokeShare DELETEs the grantee',
    revoked.some(c => c.method === 'DELETE' && c.url.includes('/shares/u1')),
    JSON.stringify(revoked.map(c => `${c.method} ${c.url}`))
  )

  const presets = await wire('listAutomationPresets', () => w.listAutomationPresets())
  check(
    'listAutomationPresets GETs /automation/presets',
    presets.some(c => c.url.includes('/automation/presets')),
    JSON.stringify(presets.map(c => `${c.method} ${c.url}`))
  )

  const activated = await wire('activateAutomation', () =>
    w.activateAutomation('main', { lanes: [], dryRun: true })
  )
  check(
    'activateAutomation POSTs activate-automation and forwards dryRun',
    activated.some(
      c => c.url.includes('/activate-automation') && (c.body as { dryRun?: boolean })?.dryRun
    ),
    JSON.stringify(activated.map(c => `${c.method} ${c.url} ${JSON.stringify(c.body)}`))
  )

  const deactivated = await wire('deactivateAutomation', () => w.deactivateAutomation('main'))
  check(
    'deactivateAutomation POSTs deactivate-automation',
    deactivated.some(c => c.url.includes('/deactivate-automation')),
    JSON.stringify(deactivated.map(c => `${c.method} ${c.url}`))
  )

  const repo = await wire('setRepo', () => w.setRepo('main', 'W/r'))
  check(
    'setRepo POSTs the board repo',
    repo.some(c => c.method === 'POST' && c.url.includes('/boards/main/repo')),
    JSON.stringify(repo.map(c => `${c.method} ${c.url}`))
  )

  const key = await wire('validateKey', () => w.validateKey('k'))
  check(
    'validateKey POSTs /task/api/validate-key',
    key.some(c => c.url.includes('/validate-key')),
    JSON.stringify(key.map(c => `${c.method} ${c.url}`))
  )

  // -------------------------------------------------------------------
  section('4. Every request carries the identity headers')
  // -------------------------------------------------------------------
  const idCalls = await wire('createTask', () => w.createTask({ title: 'T' }, 'main'))
  const withHeaders = idCalls.filter(c => Object.keys(c.headers).length)
  check(
    'the write carries X-Session-Id and X-User-Type',
    withHeaders.every(c => c.headers['X-Session-Id'] && c.headers['X-User-Type']),
    JSON.stringify(withHeaders.map(c => c.headers))
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
