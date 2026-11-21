/**
 * Exercise library + sequence widgets + run log: runtime verification.
 *
 * Boots the REAL worker against a REAL SQLite DB built from worker/migrations
 * and drives it as users at different tiers. Proves:
 *
 *   1. The library is guest tier and up: a public caller gets 401, a guest can
 *      list, make and use. Board widgets are board storage: a guest gets 403.
 *   2. Exercises: an edit is a new version and the old one still resolves; only
 *      the owner or an admin may edit or delete; delete is soft.
 *   3. Sequences pin exercise versions: editing or deleting an exercise never
 *      changes a sequence that already uses it, and a timed node needs seconds.
 *   4. Widgets pin a sequence version: the author's edit shows as
 *      latestVersion > version until the board's owner re-pins. A readonly
 *      grantee reads but can't add; GET /boards counts them; deleting the board
 *      removes them.
 *   5. Runs log every node play — repeats and skips included — and `complete`
 *      is true only when every node has a completed play.
 *   6. Picture uploads go to the CDN under task's key, keep only images, are
 *      size- and day-capped, and an exercise can only use an uploaded key.
 *   7. Account erase removes what only the person uses and keeps what someone
 *      else depends on.
 *
 * Run via: pnpm run test:worker sequences-verify
 */
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { eraseAccountData } from '../src/account-erase'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')
const CDN_UPLOAD = 'https://hadoku.me/cdn/api/upload'
const TASK_SERVICE_KEY = 'task-service-key'

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

function makeSessionsKV(entries: Record<string, { userId: string; name?: string; tier?: string }>) {
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

interface User {
  key: string
  id: string | null
  tier: string
}
const ANON: User = { key: 'anon-key', id: null, tier: 'public' }
const GUEST: User = { key: 'guest-key', id: 'guest-uid', tier: 'guest' }
const MEMBER: User = { key: 'member-key', id: 'member-uid', tier: 'member' }
const OTHER: User = { key: 'other-key', id: 'other-uid', tier: 'friend' }
const VIEWER: User = { key: 'viewer-key', id: 'viewer-uid', tier: 'friend' }
const ADMIN: User = { key: 'admin-key', id: 'admin-uid', tier: 'admin' }

const d1: FakeD1 = makeSqliteD1(MIGRATION)
const env = {
  TASKS_KV: makeKV(),
  DB: d1,
  EDGE_AUTH_SECRET: EDGE_SECRET,
  TASK_STORAGE: 'd1',
  CDN_PUBLIC_BASE: 'https://cdn.test',
  SESSIONS_KV: makeSessionsKV({
    [VIEWER.key]: { userId: VIEWER.id as string, name: 'Viewer', tier: 'friend' },
    [OTHER.key]: { userId: OTHER.id as string, name: 'Other', tier: 'friend' }
  })
} as Record<string, unknown>
const app = createTaskHandler()

// ── A fake CDN at the real upload URL ─────────────────────────────────────────
// It sniffs like the real one does (by bytes, never the header), and records
// the key it was called with, so the test proves task sends ITS service key.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0])
const cdnCalls: Array<{ key: string | null; bytes: number }> = []
const underlying = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  if (url !== CDN_UPLOAD) return underlying(input, init)
  const bytes = new Uint8Array(await new Response(init?.body as RequestInit['body']).arrayBuffer())
  const key = new Headers(init?.headers).get('X-User-Key')
  cdnCalls.push({ key, bytes: bytes.byteLength })
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return Response.json({ key: `${hash}.png`, contentType: 'image/png' }, { status: 201 })
  }
  if (bytes[0] === 0x49 && bytes[1] === 0x44) {
    return Response.json({ key: `${hash}.mp3`, contentType: 'audio/mpeg' }, { status: 201 })
  }
  return Response.json({ message: 'Only inert images and audio are accepted' }, { status: 415 })
}) as typeof fetch

// ── Requests ─────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

async function req(
  user: User,
  method: string,
  path: string,
  body?: unknown,
  raw?: Uint8Array,
  envOverride?: Record<string, unknown>
) {
  const headers: Record<string, string> = {
    'X-Edge-Auth': EDGE_SECRET,
    'X-Hadoku-Tier': user.tier,
    'X-User-Key': user.key,
    'Content-Type': raw ? 'application/octet-stream' : 'application/json'
  }
  if (user.id) headers['X-User-Id'] = user.id
  const res = await app.request(
    'http://localhost' + path,
    {
      method,
      headers,
      body: raw
        ? (raw as unknown as RequestInit['body'])
        : body !== undefined
          ? JSON.stringify(body)
          : undefined
    },
    envOverride ?? env
  )
  let json: Json = {}
  try {
    json = await res.clone().json()
  } catch {
    json = { error: await res.text() }
  }
  return { status: res.status, json }
}

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail: unknown = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
}
const section = (t: string) => console.log(`\n${t}`)
const rowCount = async (sql: string, ...args: unknown[]) =>
  Number(
    (await (d1 as unknown as D1Database)
      .prepare(sql)
      .bind(...args)
      .first<number>('n')) ?? 0
  )

const L = '/task/api/library'
const W = (ref: string, rest = '') => `/task/api/boards/${encodeURIComponent(ref)}/sequences${rest}`
const R = (rest = '') => `/task/api/sequence-runs${rest}`
const iso = (ms: number) => new Date(ms).toISOString()

async function exercise(user: User, name: string, extra: Record<string, unknown> = {}) {
  const r = await req(user, 'POST', `${L}/exercises`, { name, ...extra })
  if (r.status !== 200) throw new Error(`exercise ${name}: ${JSON.stringify(r)}`)
  return r.json.exercise
}

async function playNode(runId: string, position: number, outcome: string, user: User = MEMBER) {
  const t = Date.now()
  return req(user, 'POST', R(`/${runId}/nodes`), {
    position,
    outcome,
    activeMs: 1000,
    startedAt: iso(t - 1000),
    endedAt: iso(t)
  })
}

async function main() {
  section('1. Tiers')
  const anon = await req(ANON, 'GET', `${L}/exercises`)
  check('a public caller is refused the library (401)', anon.status === 401, anon)
  check('…with IDENTITY_REQUIRED', anon.json.code === 'IDENTITY_REQUIRED', anon.json)
  const guestList = await req(GUEST, 'GET', `${L}/exercises`)
  check('a guest lists the library', guestList.status === 200, guestList)
  const plank = await exercise(GUEST, 'Plank', { description: 'Forearms down, body straight' })
  check('a guest makes an exercise, at version 1', plank.version === 1 && plank.mine, plank)
  const guestWidget = await req(GUEST, 'GET', W('main'))
  check(
    "…but board widgets are board storage: a guest can't (403)",
    guestWidget.status === 403 && guestWidget.json.code === 'MEMBER_NOT_VERIFIED',
    guestWidget
  )

  section('2. Exercises: versions, ownership, soft delete')
  const edit = await req(GUEST, 'PUT', `${L}/exercises/${plank.id}`, {
    name: 'Plank hold',
    description: 'Elbows under shoulders'
  })
  check('an edit saves version 2', edit.json.exercise?.version === 2, edit)
  const v1 = await req(MEMBER, 'GET', `${L}/exercises/${plank.id}?version=1`)
  check(
    '…and version 1 still resolves, knowing it is not the latest',
    v1.json.exercise?.name === 'Plank' && v1.json.exercise?.latestVersion === 2,
    v1
  )
  check(
    'someone else sees it but cannot edit it',
    v1.json.exercise?.mine === false && v1.json.exercise?.canEdit === false,
    v1.json
  )
  const otherEdit = await req(MEMBER, 'PUT', `${L}/exercises/${plank.id}`, { name: 'Mine now' })
  check("…and an edit of someone else's exercise is 403", otherEdit.status === 403, otherEdit)
  const otherDel = await req(MEMBER, 'DELETE', `${L}/exercises/${plank.id}`)
  check('…as is a delete', otherDel.status === 403, otherDel)
  const adminView = await req(ADMIN, 'GET', `${L}/exercises/${plank.id}`)
  check('an admin may edit anything', adminView.json.exercise?.canEdit === true, adminView.json)
  const adminEdit = await req(ADMIN, 'PUT', `${L}/exercises/${plank.id}`, { name: 'Plank' })
  check('…and does, as version 3', adminEdit.json.exercise?.version === 3, adminEdit)
  const squat = await exercise(MEMBER, 'Squat')
  const lunge = await exercise(MEMBER, 'Lunge')
  const search = await req(GUEST, 'GET', `${L}/exercises?q=squ`)
  check(
    'search by name finds across owners',
    search.json.exercises?.length === 1 && search.json.exercises[0].id === squat.id,
    search.json
  )
  const mine = await req(MEMBER, 'GET', `${L}/exercises?mine=1`)
  check('mine=1 lists only my own', mine.json.exercises?.length === 2, mine.json)

  section('3. Sequences pin exercise versions')
  const badTimed = await req(MEMBER, 'POST', `${L}/sequences`, {
    name: 'Broken',
    nodes: [{ exerciseId: squat.id, mode: 'timed' }]
  })
  check('a timed node without seconds is refused (400)', badTimed.status === 400, badTimed)
  const missing = await req(MEMBER, 'POST', `${L}/sequences`, {
    name: 'Ghost',
    nodes: [{ exerciseId: 'nope', mode: 'manual' }]
  })
  check('an unknown exercise is 404', missing.json.code === 'EXERCISE_NOT_FOUND', missing)
  const made = await req(MEMBER, 'POST', `${L}/sequences`, {
    name: 'Leg day',
    description: 'Quick one',
    nodes: [
      { exerciseId: squat.id, mode: 'timed', seconds: 30 },
      { exerciseId: plank.id, exerciseVersion: 1, mode: 'timed', seconds: 45 },
      { exerciseId: lunge.id, mode: 'manual' }
    ]
  })
  const legDay = made.json.sequence
  check('a sequence is made with three nodes', made.status === 200 && legDay.nodeCount === 3, made)
  check(
    '…totals its timed seconds and counts manual nodes',
    legDay.timedSeconds === 75 && legDay.manualCount === 1,
    legDay
  )
  check(
    '…and node 2 plays Plank v1 as asked, not the latest',
    legDay.nodes[1].exercise.version === 1 && legDay.nodes[1].exercise.name === 'Plank',
    legDay.nodes[1]
  )
  check('a manual node has no seconds', legDay.nodes[2].seconds === null, legDay.nodes[2])
  await req(MEMBER, 'PUT', `${L}/exercises/${squat.id}`, { name: 'Air squat' })
  await req(MEMBER, 'DELETE', `${L}/exercises/${lunge.id}`)
  const after = await req(GUEST, 'GET', `${L}/sequences/${legDay.id}`)
  check(
    "editing an exercise doesn't change the sequence using it",
    after.json.sequence?.nodes[0].exercise.name === 'Squat',
    after.json
  )
  check(
    '…and deleting one leaves it playable there (marked deleted)',
    after.json.sequence?.nodes[2].exercise.name === 'Lunge' &&
      after.json.sequence?.nodes[2].exercise.deleted === true,
    after.json
  )
  const gone = await req(GUEST, 'GET', `${L}/exercises`)
  check(
    'a deleted exercise leaves the library list',
    !gone.json.exercises.some((e: Json) => e.id === lunge.id),
    gone.json
  )
  const addDeleted = await req(GUEST, 'POST', `${L}/sequences`, {
    name: 'Late',
    nodes: [{ exerciseId: lunge.id, mode: 'manual' }]
  })
  check("…and can't be added to a new sequence", addDeleted.status === 404, addDeleted)
  const keepDeleted = await req(MEMBER, 'PUT', `${L}/sequences/${legDay.id}`, {
    name: 'Leg day',
    nodes: [
      { exerciseId: squat.id, mode: 'timed', seconds: 40 },
      { exerciseId: lunge.id, exerciseVersion: 1, mode: 'manual' }
    ]
  })
  check(
    '…but a sequence that already pins it keeps it through an edit (v2)',
    keepDeleted.status === 200 && keepDeleted.json.sequence.version === 2,
    keepDeleted
  )
  check(
    '…and the edit pinned the new squat version',
    keepDeleted.json.sequence?.nodes[0].exercise.name === 'Air squat',
    keepDeleted.json
  )
  const otherSeqEdit = await req(GUEST, 'PUT', `${L}/sequences/${legDay.id}`, {
    name: 'x',
    nodes: [{ exerciseId: squat.id, mode: 'manual' }]
  })
  check("a non-owner can't edit a sequence", otherSeqEdit.status === 403, otherSeqEdit)

  section('4. Board widgets pin a sequence version')
  await req(MEMBER, 'POST', '/task/api/boards', { id: 'gym', name: 'Gym' })
  const add = await req(MEMBER, 'POST', W('gym'), { sequenceId: legDay.id, version: 1 })
  const widget = add.json.widget
  check('a member puts v1 on a board', add.status === 200 && widget.sequence.version === 1, add)
  check(
    '…and is told v2 exists',
    widget.sequence.latestVersion === 2 && widget.sequence.nodes.length === 3,
    widget.sequence
  )
  const boards = (await req(MEMBER, 'GET', '/task/api/boards')).json.boards as Json[]
  const gym = boards.find(b => b.id === 'gym')
  check('GET /boards counts the widget', gym?.sequenceCount === 1, gym)
  check(
    '…and a board without one carries no count',
    boards.find(b => b.id === 'main')?.sequenceCount === undefined,
    boards
  )
  const repin = await req(MEMBER, 'PATCH', W('gym', `/${widget.id}`), { version: 2 })
  check(
    're-pinning moves it to v2',
    repin.json.widget?.sequence.version === 2 && repin.json.widget.sequence.nodes.length === 2,
    repin
  )
  const badPin = await req(MEMBER, 'PATCH', W('gym', `/${widget.id}`), { version: 9 })
  check('a version that does not exist is 404', badPin.status === 404, badPin)
  await req(MEMBER, 'DELETE', `${L}/sequences/${legDay.id}`)
  const stillThere = await req(MEMBER, 'GET', W('gym'))
  check(
    'deleting the sequence from the library leaves the widget playable',
    stillThere.json.widgets?.length === 1 && stillThere.json.widgets[0].sequence.deleted === true,
    stillThere.json
  )
  const addDeletedSeq = await req(MEMBER, 'POST', W('gym'), { sequenceId: legDay.id })
  check("…but it can't be newly added", addDeletedSeq.status === 404, addDeletedSeq)

  const gymHandle = gym?.handle as string
  const share = await req(MEMBER, 'POST', '/task/api/boards/gym/shares', {
    name: 'Viewer',
    level: 'readonly'
  })
  check('the board is shared read-only', share.status === 200, share)
  const viewerList = await req(VIEWER, 'GET', W(gymHandle))
  check(
    'a readonly grantee sees the widgets, without write',
    viewerList.json.widgets?.length === 1 && viewerList.json.canWrite === false,
    viewerList
  )
  const cardio = (
    await req(OTHER, 'POST', `${L}/sequences`, {
      name: 'Cardio',
      nodes: [{ exerciseId: squat.id, mode: 'timed', seconds: 5 }]
    })
  ).json.sequence
  const viewerAdd = await req(VIEWER, 'POST', W(gymHandle), { sequenceId: cardio.id })
  check("…and can't add one", viewerAdd.status === 403, viewerAdd)
  const memberAddsOthers = await req(MEMBER, 'POST', W('gym'), { sequenceId: cardio.id })
  check(
    "anyone's sequence can go on my board",
    memberAddsOthers.status === 200 && memberAddsOthers.json.widget.sequence.mine === false,
    memberAddsOthers
  )

  section('5. Runs log every node play')
  const widgetSeq = repin.json.widget.sequence // Leg day v2: 2 nodes
  const start = await req(MEMBER, 'POST', R(), {
    sequenceId: legDay.id,
    version: 2,
    board: 'gym',
    widgetId: widget.id
  })
  const run = start.json.run
  check(
    'a run starts active, sized to its version',
    run?.status === 'active' && run.nodeCount === 2,
    start
  )
  await playNode(run.id, 0, 'completed')
  await playNode(run.id, 1, 'rewound')
  await playNode(run.id, 0, 'completed')
  const last = await playNode(run.id, 1, 'skipped')
  const plays = last.json.run?.nodes as Json[]
  check(
    'every play is a row, the repeat of node 0 included',
    plays?.length === 4 &&
      plays.map(n => `${n.position}:${n.outcome}`).join(' ') ===
        '0:completed 1:rewound 0:completed 1:skipped',
    plays
  )
  check(
    '…and each names the pinned exercise, filled in by the server',
    plays?.[1].exerciseId === widgetSeq.nodes[1].exercise.id &&
      plays[1].exerciseVersion === widgetSeq.nodes[1].exercise.version,
    plays
  )
  check('a run with a skipped node is not complete', last.json.run?.complete === false, last.json)
  const outOfRange = await playNode(run.id, 5, 'completed')
  check(
    'a node the sequence lacks is 422',
    outOfRange.json.code === 'NODE_OUT_OF_RANGE',
    outOfRange
  )
  const notMine = await playNode(run.id, 0, 'completed', OTHER)
  check("another person can't log into my run (404)", notMine.status === 404, notMine)
  const fin = await req(MEMBER, 'POST', R(`/${run.id}/finish`), { status: 'completed' })
  check(
    'finishing sets the status',
    fin.json.run?.status === 'completed' && fin.json.run.endedAt,
    fin
  )
  const again = await req(MEMBER, 'POST', R(`/${run.id}/finish`), { status: 'stopped' })
  check('…once (409 RUN_FINISHED)', again.json.code === 'RUN_FINISHED', again)
  const late = await playNode(run.id, 1, 'completed')
  check('…and takes no more plays', late.json.code === 'RUN_FINISHED', late)

  const run2 = (await req(GUEST, 'POST', R(), { sequenceId: cardio.id, version: 1 })).json.run
  await playNode(run2.id, 0, 'completed', GUEST)
  const done2 = await req(GUEST, 'POST', R(`/${run2.id}/finish`), { status: 'completed' })
  check(
    'a guest runs from the library (no board), and a full run is complete',
    done2.json.run?.complete === true && done2.json.run.widgetId === null,
    done2.json
  )
  const guestRuns = await req(GUEST, 'GET', R())
  check(
    "a runner's own history lists only their runs",
    guestRuns.json.runs?.length === 1 && guestRuns.json.runs[0].id === run2.id,
    guestRuns.json
  )
  const viewerRun = await req(VIEWER, 'POST', R(), {
    sequenceId: legDay.id,
    version: 2,
    board: gymHandle,
    widgetId: widget.id
  })
  check("a readonly grantee can't log a run against the board", viewerRun.status === 403, viewerRun)
  const boardRuns = await req(MEMBER, 'GET', W('gym'))
  check(
    'the board lists runs started from its widgets',
    boardRuns.json.runs?.length === 1 && boardRuns.json.runs[0].widgetId === widget.id,
    boardRuns.json
  )

  section('6. Pictures')
  const noKey = await req(GUEST, 'POST', `${L}/images`, undefined, PNG)
  check(
    'without a service key, uploads are unavailable (503)',
    noKey.status === 503 && noKey.json.code === 'UPLOADS_UNAVAILABLE',
    noKey
  )
  const keyed = { ...env, HADOKU_SERVICE_KEY: TASK_SERVICE_KEY }
  const up = await req(GUEST, 'POST', `${L}/images`, undefined, PNG, keyed)
  check('a guest uploads a PNG', up.status === 200 && /\.png$/.test(up.json.imageKey), up)
  check(
    '…sent to the CDN under task’s service key',
    cdnCalls.at(-1)?.key === TASK_SERVICE_KEY && cdnCalls.at(-1)?.bytes === PNG.byteLength,
    cdnCalls
  )
  check(
    '…and served from the configured CDN base',
    up.json.imageUrl === `https://cdn.test/${up.json.imageKey}`,
    up.json
  )
  const audio = await req(GUEST, 'POST', `${L}/images`, undefined, MP3, keyed)
  check('audio the CDN would take is refused here (415)', audio.status === 415, audio)
  const junk = await req(GUEST, 'POST', `${L}/images`, undefined, new Uint8Array([1, 2, 3]), keyed)
  check(
    "the CDN's refusal comes back as UPLOAD_REFUSED",
    junk.status === 415 && junk.json.code === 'UPLOAD_REFUSED',
    junk
  )
  const callsBefore = cdnCalls.length
  const big = await req(
    GUEST,
    'POST',
    `${L}/images`,
    undefined,
    new Uint8Array(5 * 1024 * 1024 + 1),
    keyed
  )
  check(
    'over 5 MB is 413, never sent on',
    big.status === 413 && cdnCalls.length === callsBefore,
    big
  )
  const withPic = await req(GUEST, 'POST', `${L}/exercises`, {
    name: 'Bridge',
    imageKey: up.json.imageKey
  })
  check(
    'an uploaded key goes on an exercise',
    withPic.json.exercise?.imageUrl === up.json.imageUrl,
    withPic
  )
  const forged = await req(GUEST, 'POST', `${L}/exercises`, {
    name: 'Forged',
    imageKey: `${'a'.repeat(64)}.png`
  })
  check('a key never uploaded here is 422', forged.json.code === 'IMAGE_UNKNOWN', forged)
  const notImage = await req(GUEST, 'POST', `${L}/exercises`, { name: 'X', imageKey: 'a.svg' })
  check('a malformed key is 400', notImage.status === 400, notImage)
  for (
    let i = await rowCount("SELECT COUNT(*) AS n FROM library_uploads WHERE user_id = 'guest-uid'");
    i < 30;
    i++
  ) {
    await (d1 as unknown as D1Database)
      .prepare("INSERT INTO library_uploads (user_id, image_key, at) VALUES ('guest-uid', 'x', ?)")
      .bind(new Date().toISOString())
      .run()
  }
  const capped = await req(GUEST, 'POST', `${L}/images`, undefined, PNG, keyed)
  check('the 31st picture in a day is 429', capped.json.code === 'UPLOAD_LIMIT', capped)

  section('7. Account erase')
  // OTHER's Cardio is on MEMBER's board, so it (and the squat it pins, which is
  // MEMBER's) must survive OTHER's erase. OTHER's unused one must not.
  const unused = (
    await req(OTHER, 'POST', `${L}/sequences`, {
      name: 'Unused',
      nodes: [{ exerciseId: (await exercise(OTHER, 'Burpee')).id, mode: 'manual' }]
    })
  ).json.sequence
  const otherRun = (await req(OTHER, 'POST', R(), { sequenceId: unused.id, version: 1 })).json.run
  await playNode(otherRun.id, 0, 'completed', OTHER)
  const erased = await eraseAccountData(d1 as never, OTHER.id as string)
  check(
    'erase removes the unused sequence and its exercise',
    erased.sequences === 1 && erased.exercises === 1 && erased.sequence_nodes === 1,
    erased
  )
  check('…and their runs', erased.sequence_runs === 1 && erased.sequence_run_nodes === 1, erased)
  check(
    "…but keeps the sequence on someone else's board",
    (await rowCount('SELECT COUNT(*) AS n FROM sequences WHERE id = ?', cardio.id)) === 1
  )
  const memberGym = await req(MEMBER, 'GET', W('gym'))
  check(
    '…which still plays there',
    memberGym.json.widgets?.some((w: Json) => w.sequence.id === cardio.id),
    memberGym.json
  )

  // GUEST's Plank is pinned by MEMBER's Leg day v1 (node 2), so it stays.
  const guestErase = await eraseAccountData(d1 as never, GUEST.id as string)
  check(
    "a guest's exercise used in someone else's sequence is kept",
    (await rowCount('SELECT COUNT(*) AS n FROM exercises WHERE id = ?', plank.id)) === 1,
    guestErase
  )
  check(
    '…their unused one (Bridge) goes, with its upload records',
    guestErase.exercises === 1 && guestErase.library_uploads === 30,
    guestErase
  )

  const delBoard = await req(MEMBER, 'DELETE', '/task/api/boards/gym')
  check('deleting a board succeeds', delBoard.status === 200, delBoard)
  check(
    '…and removes its sequence widgets',
    (await rowCount("SELECT COUNT(*) AS n FROM board_sequences WHERE board_id = 'gym'")) === 0
  )
  check(
    '…leaving the runs in their runners’ history',
    (await rowCount('SELECT COUNT(*) AS n FROM sequence_runs WHERE id = ?', run.id)) === 1
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
