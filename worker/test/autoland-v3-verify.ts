/**
 * Autoland v3 runtime verification — the three server-side additions (§5.2, §5.3, §5.5).
 *
 * Boots the REAL worker against a REAL SQLite D1 (the real migrations, including
 * 0007) and drives it over HTTP and MCP. Nothing here is asserted against a
 * mock: every claim below is about a row the worker actually wrote, or refused
 * to write.
 *
 * ── `ifNotesHash` (§5.2, the blocking ask) ──────────────────────────────────
 *
 * The failure it exists to prevent has no recovery path: an agent reads a plan,
 * works for twenty minutes, and releases a rewritten document over the reply a
 * human typed in the meantime. The reply is not versioned anywhere, so it is
 * simply gone. The proof that matters is therefore NOT "a mismatch returns 409"
 * — it is that a refused release WROTE NOTHING: the human's text is still in the
 * column, the lane didn't move, the claim is still held, and the agent can
 * retry. A guard that answered 409 after half-applying the release would pass a
 * status-code assertion and still lose the text.
 *
 * ── `status` (§5.3) ─────────────────────────────────────────────────────────
 *
 * A generic field with a CLOSED `kind` set. Checked, not carried: a typo'd kind
 * is a 422 at the write, not a blank chip nobody can explain later. Accepted on
 * set-lane as well as release, so a long job reports progress without dropping
 * its lease. And the three-way shape matters — omitting `status` must LEAVE it,
 * not clear it, or every release that doesn't mention the chip wipes it.
 *
 * ── `claimed` (§5.5) ────────────────────────────────────────────────────────
 *
 * The flag has been on the hydrated agent read since v1 and the board read the
 * UI actually calls has never carried it. With pipeline state leaving the lanes
 * there is otherwise nothing on a card that says an agent is on it.
 *
 * Run via: pnpm run test:worker  (or `... autoland-v3-verify`).
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

interface TaskView {
  id: string
  tag?: string | null
  notes?: string | null
  status?: { kind: string; label: string; href?: string } | null
  claimed?: boolean
}
type Body = Record<string, unknown> & {
  tasks?: TaskView[]
  boards?: Array<{ id: string; tasks?: TaskView[] }>
  code?: string
  currentNotesHash?: string
  token?: string
}

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
    /* non-JSON body */
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
const section = (t: string) => console.log(`\n${t}`)

/** SHA-256 hex of the UTF-8 notes — the published `ifNotesHash` definition. */
async function hashNotes(notes: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(notes))
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Read a task straight out of D1 — never through the layer under test. */
function rawTask(id: string): { tag: string | null; notes: string | null; status: string | null } {
  return d1.__raw
    .prepare('SELECT tag, notes, status FROM tasks WHERE user_id = ? AND id = ?')
    .get(OWNER.id, id) as { tag: string | null; notes: string | null; status: string | null }
}

const LANES = [
  { tag: 'hadoku-conjure', label: 'hadoku-conjure', order: 1, editableBy: 'user' as const },
  { tag: 'hadoku-aggregator', label: 'hadoku-aggregator', order: 2, editableBy: 'user' as const },
  { tag: 'tenhands', label: 'tenhands', order: 3, editableBy: 'user' as const }
]

async function activate(board: string) {
  await req('POST', '/task/api/boards', { id: board, name: 'Auto' })
  const pv = await req('POST', `/task/api/boards/${board}/activate-automation`, {
    lanes: LANES,
    schemaId: 'autoland',
    schemaVersion: 3,
    dryRun: true
  })
  const digest = (pv.json as { preview?: { digest?: string } } | null)?.preview?.digest
  await req('POST', `/task/api/boards/${board}/activate-automation`, {
    lanes: LANES,
    schemaId: 'autoland',
    schemaVersion: 3,
    digest
  })
}

async function claim(taskId: string): Promise<string> {
  const r = await req('POST', '/task/api/agent/claim', {
    board: 'auto',
    taskId,
    agentId: 'tenhands'
  })
  return r.json?.token as string
}

async function main() {
  console.log('Autoland v3 runtime verification (ifNotesHash / status / claimed)')

  // v3 shape: ONE board, lanes ARE repos, all editableBy user.
  await activate('auto')

  // -------------------------------------------------------------------------
  section('1. `ifNotesHash` refuses a stale release — and writes NOTHING (§5.2)')
  // -------------------------------------------------------------------------
  const PLAN = '## Questions\n\n- Which branch?\n'
  await req('POST', '/task/api', {
    id: 'n1',
    title: 'Guarded release',
    boardId: 'auto',
    tag: 'hadoku-conjure',
    notes: PLAN
  })
  const planned = await hashNotes(PLAN)
  let token = await claim('n1')

  // The human edits the plan while the agent works. This is the whole hazard:
  // with every lane editableBy user there is no agent lane to keep them out.
  const HUMAN = `${PLAN}\nUse main, and mind the TTL.\n`
  await req('PATCH', '/task/api/n1', { boardId: 'auto', notes: HUMAN })

  const stale = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 'n1',
    token,
    lane: 'tenhands',
    notes: '## Outcome\n\nOpened PR #42.\n',
    ifNotesHash: planned
  })
  check('a mismatch is 409', stale.status === 409, `status=${stale.status}`)
  check('…coded NOTES_CHANGED', stale.json?.code === 'NOTES_CHANGED', JSON.stringify(stale.json))
  check(
    '…and carries the digest to re-plan against',
    stale.json?.currentNotesHash === (await hashNotes(HUMAN)),
    String(stale.json?.currentNotesHash)
  )

  // The part that actually matters. Read raw, not through the API.
  const afterRefusal = rawTask('n1')
  check(
    "the human's text survived untouched",
    afterRefusal.notes === HUMAN,
    String(afterRefusal.notes)
  )
  check('the lane did not move', afterRefusal.tag === 'hadoku-conjure', String(afterRefusal.tag))
  const stillHeld = d1.__raw
    .prepare('SELECT token FROM task_claims WHERE user_id = ? AND task_id = ?')
    .get(OWNER.id, 'n1') as { token: string } | undefined
  check('the claim is still held, so the agent can retry', stillHeld?.token === token)

  // Re-guarding against what it now sees succeeds.
  const retry = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 'n1',
    token,
    lane: 'tenhands',
    notes: '## Outcome\n\nOpened PR #42.\n',
    ifNotesHash: stale.json?.currentNotesHash
  })
  check(
    're-guarding against the current digest succeeds',
    retry.status === 200,
    `status=${retry.status}`
  )
  check('…and the release landed', rawTask('n1').notes === '## Outcome\n\nOpened PR #42.\n')

  // Absent notes hash as the empty string — the documented convention, and what
  // lets a runner guard "this task had no plan when I claimed it".
  await req('POST', '/task/api', { id: 'n2', title: 'No plan yet', boardId: 'auto' })
  token = await claim('n2')
  const emptyOk = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 'n2',
    token,
    lane: 'tenhands',
    notes: '## Plan\n\nFirst pass.\n',
    ifNotesHash: await hashNotes('')
  })
  check('null notes hash as the empty string', emptyOk.status === 200, `status=${emptyOk.status}`)

  // Omitting the guard keeps the v1/v2 behaviour: an unguarded release still wins.
  await req('POST', '/task/api', { id: 'n3', title: 'Unguarded', boardId: 'auto', notes: 'old' })
  token = await claim('n3')
  await req('PATCH', '/task/api/n3', { boardId: 'auto', notes: 'human edit' })
  const unguarded = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 'n3',
    token,
    lane: 'tenhands',
    notes: 'agent wrote this'
  })
  check('omitting ifNotesHash is unchanged behaviour', unguarded.status === 200)
  check('…and overwrites, as it always did', rawTask('n3').notes === 'agent wrote this')

  // Both guards on one release: the lane one still fires.
  await req('POST', '/task/api', {
    id: 'n4',
    title: 'Both guards',
    boardId: 'auto',
    tag: 'tenhands',
    notes: 'p'
  })
  token = await claim('n4')
  await req('PATCH', '/task/api/n4', { boardId: 'auto', tag: 'hadoku-conjure' })
  const laneFirst = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 'n4',
    token,
    lane: 'tenhands',
    ifCurrentLane: 'tenhands',
    ifNotesHash: await hashNotes('p')
  })
  check('ifCurrentLane still fires alongside it', laneFirst.json?.code === 'LANE_CHANGED')

  // MCP carries the guard too — the runner's other transport.
  const mcpGuard = (await mcp('release_claim', {
    board: 'auto',
    taskId: 'n4',
    token,
    lane: 'tenhands',
    ifNotesHash: await hashNotes('nope')
  })) as Body & { isError?: boolean; content?: Array<{ text?: string }> }
  check(
    'MCP forwards NOTES_CHANGED',
    JSON.stringify(mcpGuard).includes('NOTES_CHANGED'),
    JSON.stringify(mcpGuard).slice(0, 200)
  )

  // -------------------------------------------------------------------------
  section('2. `status` is checked, claim-gated, and three-way (§5.3)')
  // -------------------------------------------------------------------------
  await req('POST', '/task/api', {
    id: 's1',
    title: 'Status me',
    boardId: 'auto',
    tag: 'hadoku-conjure'
  })
  token = await claim('s1')

  const setStatus = await req('POST', '/task/api/agent/set-lane', {
    board: 'auto',
    taskId: 's1',
    token,
    lane: 'hadoku-conjure',
    status: { kind: 'working', label: 'implementing · 3 files' }
  })
  check('set-lane accepts a status', setStatus.status === 200, `status=${setStatus.status}`)
  check(
    '…and it is stored as its own column, not in metadata',
    rawTask('s1').status === '{"kind":"working","label":"implementing · 3 files"}',
    String(rawTask('s1').status)
  )

  // The three-way shape: omitting it must LEAVE it.
  await req('POST', '/task/api/agent/set-lane', {
    board: 'auto',
    taskId: 's1',
    token,
    lane: 'hadoku-conjure'
  })
  check(
    'omitting status leaves it alone',
    rawTask('s1').status !== null,
    String(rawTask('s1').status)
  )

  const badKind = await req('POST', '/task/api/agent/set-lane', {
    board: 'auto',
    taskId: 's1',
    token,
    lane: 'hadoku-conjure',
    status: { kind: 'queued', label: 'nope' }
  })
  check(
    'an unknown kind is refused',
    badKind.status === 400 || badKind.status === 422,
    `status=${badKind.status}`
  )
  check('…and the stored status is unchanged', rawTask('s1').status?.includes('working') === true)

  const badHref = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 's1',
    token,
    lane: 'tenhands',
    status: { kind: 'done', label: 'shipped', href: 'javascript:alert(1)' }
  })
  check(
    'a non-http href is refused (STATUS_INVALID)',
    badHref.status === 422 && badHref.json?.code === 'STATUS_INVALID',
    `${badHref.status} ${JSON.stringify(badHref.json)}`
  )
  check('…and the release wrote nothing', rawTask('s1').tag === 'hadoku-conjure')

  const released = await req('POST', '/task/api/agent/release', {
    board: 'auto',
    taskId: 's1',
    token,
    lane: 'tenhands',
    status: { kind: 'done', label: 'merged', href: 'https://github.com/WolffM/x/pull/42' }
  })
  check('release writes a valid status', released.status === 200, `status=${released.status}`)

  const board = await req('GET', '/task/api/boards')
  const s1 = board.json?.boards?.find(b => b.id === 'auto')?.tasks?.find(t => t.id === 's1')
  check(
    '…and the board read hands it back',
    s1?.status?.kind === 'done',
    JSON.stringify(s1?.status)
  )
  check('…with the label verbatim', s1?.status?.label === 'merged')
  check('…and the href', s1?.status?.href === 'https://github.com/WolffM/x/pull/42')

  // Not claim-free: the chip is the claim holder's to write.
  const noClaim = await req('POST', '/task/api/agent/set-lane', {
    board: 'auto',
    taskId: 's1',
    token,
    lane: 'tenhands',
    status: { kind: 'working', label: 'sneaking in' }
  })
  check(
    'a released token can no longer write status',
    noClaim.status === 409,
    `status=${noClaim.status}`
  )

  // MCP writes it too.
  await req('POST', '/task/api', { id: 's2', title: 'Via MCP', boardId: 'auto' })
  const mcpToken = (await mcp('claim_task', { board: 'auto', taskId: 's2', agentId: 'a' })) as Body
  const t2 = JSON.parse(
    (mcpToken as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '{}'
  ).token as string
  await mcp('set_lane', {
    board: 'auto',
    taskId: 's2',
    token: t2,
    lane: 'tenhands',
    status: { kind: 'blocked', label: 'waiting on CI' }
  })
  check(
    'MCP set_lane writes a status',
    rawTask('s2').status?.includes('blocked') === true,
    String(rawTask('s2').status)
  )

  // Clearing is explicit.
  await mcp('release_claim', {
    board: 'auto',
    taskId: 's2',
    token: t2,
    lane: 'tenhands',
    status: null
  })
  check('null clears it', rawTask('s2').status === null, String(rawTask('s2').status))

  // -------------------------------------------------------------------------
  section('3. `claimed` reaches the board read the UI actually calls (§5.5)')
  // -------------------------------------------------------------------------
  await req('POST', '/task/api', { id: 'c1', title: 'Held', boardId: 'auto', tag: 'tenhands' })
  await req('POST', '/task/api', { id: 'c2', title: 'Free', boardId: 'auto', tag: 'tenhands' })
  await claim('c1')

  const boards = await req('GET', '/task/api/boards')
  const tasks = boards.json?.boards?.find(b => b.id === 'auto')?.tasks ?? []
  check('a live lease shows as claimed', tasks.find(t => t.id === 'c1')?.claimed === true)
  check(
    'an unclaimed task is not flagged',
    tasks.find(t => t.id === 'c2')?.claimed === undefined,
    JSON.stringify(tasks.find(t => t.id === 'c2'))
  )

  // An expired lease is not a live one — the flag must follow the lease, not the row.
  d1.__raw
    .prepare('UPDATE task_claims SET expires_at = ? WHERE user_id = ? AND task_id = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), OWNER.id, 'c1')
  const afterExpiry = await req('GET', '/task/api/boards')
  const c1 = afterExpiry.json?.boards?.find(b => b.id === 'auto')?.tasks?.find(t => t.id === 'c1')
  check('an EXPIRED lease is not claimed', c1?.claimed === undefined, JSON.stringify(c1))

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
