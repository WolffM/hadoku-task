import { test, expect, type APIRequestContext } from '@playwright/test'
import { API, apiUp } from './helpers/stack'

/**
 * "Your provider's contract has moved" (§5.5), end to end against the real worker.
 *
 * An automation board stores a snapshot of the lane contract it was activated
 * from, and the provider keeps publishing. Nothing used to notice — the board
 * silently sat on a superseded contract until a human re-ran the activation
 * handshake by hand, which is the drifting local copy the preset endpoint exists
 * to kill. `GET /boards/:ref` now says so.
 *
 * The stub provider publishes `tenhands` at v1, so a board activated at v0 is
 * genuinely behind a genuinely-fetched contract — no mocking, no clock games.
 *
 * Requires the local API stack (`node scripts/dev-api.mjs`). Skipped when it
 * isn't up, so the default `pnpm test:e2e` stays green.
 */

const APP_HEADER = 'h1.app-header__title'
const KEY = { 'X-User-Key': 'dev-key', 'Content-Type': 'application/json' }

/** The stub's `tenhands` lanes, fetched rather than transcribed. */
async function providerLanes(req: APIRequestContext): Promise<unknown[]> {
  const res = await req.get(`${API}/automation/presets`, { headers: KEY })
  const body = (await res.json()) as { presets: Array<{ schemaId: string; lanes: unknown[] }> }
  const p = body.presets.find(x => x.schemaId === 'tenhands')
  if (!p) throw new Error('stub provider is not serving the `tenhands` preset')
  return p.lanes
}

/** Unique per test AND per run — the dev stack's DB outlives a single run. */
const boardId = (slug: string) => `pu-${slug}-${Date.now().toString(36)}`

/**
 * A board activated at `schemaVersion`, with the given lanes. Activation is the
 * mandated dryRun → echo-digest → commit handshake, so this exercises the same
 * path a human does rather than writing D1 behind the route's back.
 */
async function activate(
  req: APIRequestContext,
  id: string,
  schemaVersion: number,
  lanes: unknown[]
) {
  const created = await req.post(`${API}/boards`, {
    headers: KEY,
    data: { id, name: id }
  })
  expect(created.ok(), `board ${id} should be created`).toBeTruthy()

  const payload = { schemaId: 'tenhands', schemaVersion, lanes }
  const dry = await req.post(`${API}/boards/${id}/activate-automation`, {
    headers: KEY,
    data: { ...payload, dryRun: true }
  })
  expect(dry.ok(), 'dryRun should succeed').toBeTruthy()
  const { preview } = (await dry.json()) as { preview: { digest: string } }

  const commit = await req.post(`${API}/boards/${id}/activate-automation`, {
    headers: KEY,
    data: { ...payload, digest: preview.digest }
  })
  expect(commit.ok(), 'commit should succeed').toBeTruthy()
}

interface PresetUpdate {
  providerId: string
  schemaVersion: number
  safe: boolean
  toInbox: number
}

async function readBoard(
  req: APIRequestContext,
  ref: string,
  headers: Record<string, string> = KEY
) {
  const res = await req.get(`${API}/boards/${ref}`, { headers })
  expect(res.ok(), `GET /boards/${ref} should succeed`).toBeTruthy()
  return (await res.json()) as {
    board: { handle: string; access: string; presetUpdate?: PresetUpdate }
    tasks: Array<{ tag: string | null }>
  }
}

test.describe('Preset update detection', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(
      !(await apiUp(request, KEY)),
      'local API stack not running (node scripts/dev-api.mjs)'
    )
    // The read path answers from cache and never fetches, so a cold isolate has
    // nothing to say. The picker is what warms it in practice; do that first so
    // these assertions test detection rather than cache timing.
    await request.get(`${API}/automation/presets`, { headers: KEY })
  })

  test('flags a board left behind, and says applying it moves nothing', async ({ request }) => {
    const id = boardId('behind')
    await activate(request, id, 0, await providerLanes(request))

    const { board } = await readBoard(request, id)
    expect(board.presetUpdate).toBeDefined()
    expect(board.presetUpdate?.providerId).toBe('tenhands')
    expect(board.presetUpdate?.schemaVersion).toBe(1)
    // Same lane tags, only the version moved — a re-order, not a migration.
    expect(board.presetUpdate?.safe).toBe(true)
    expect(board.presetUpdate?.toInbox).toBe(0)
  })

  test('says nothing when the board is already current', async ({ request }) => {
    const id = boardId('current')
    await activate(request, id, 1, await providerLanes(request))

    const { board } = await readBoard(request, id)
    expect(board.presetUpdate).toBeUndefined()
  })

  test('refuses to call it safe when a task would be stranded', async ({ request }) => {
    const id = boardId('unsafe')
    // A lane the provider does not publish — applying its contract drops this
    // lane, so whatever sits in it is cleared to the Inbox.
    const lanes = [
      ...(await providerLanes(request)),
      { tag: 'legacy', label: 'Legacy', order: 99, editableBy: 'user' }
    ]
    await activate(request, id, 0, lanes)

    const task = await request.post(API, {
      headers: KEY,
      data: { id: `${id}-t1`, boardId: id, title: 'stuck in legacy', tag: 'legacy' }
    })
    expect(task.ok(), 'task should be created in the doomed lane').toBeTruthy()

    const { board, tasks } = await readBoard(request, id)
    expect(tasks.map(t => t.tag)).toContain('legacy')
    expect(board.presetUpdate?.schemaVersion).toBe(1)
    expect(board.presetUpdate?.safe).toBe(false)
    expect(board.presetUpdate?.toInbox).toBe(1)
  })

  test('tells only the owner — a contributor cannot act on it', async ({ request }) => {
    const id = boardId('shared')
    await activate(request, id, 0, await providerLanes(request))

    const owner = await readBoard(request, id)
    expect(owner.board.access).toBe('owner')
    expect(owner.board.presetUpdate).toBeDefined()

    const grant = await request.post(`${API}/boards/${id}/shares`, {
      headers: KEY,
      data: { userId: 'other-uid', level: 'contributor' }
    })
    expect(grant.ok(), 'share should be granted').toBeTruthy()

    // Same board, same drift — only the reader differs. A slug resolves solely
    // inside its owner's namespace, so the grantee reads it by handle.
    const other = await readBoard(request, owner.board.handle, {
      'X-Dev-As': 'other-uid',
      'Content-Type': 'application/json'
    })
    expect(other.board.access).toBe('contributor')
    expect(other.board.presetUpdate).toBeUndefined()
  })

  test('offers the update in the panel and applies it in one click', async ({ page, request }) => {
    const id = boardId('ui')
    await activate(request, id, 0, await providerLanes(request))

    await page.addInitScript(() => {
      localStorage.clear()
      localStorage.setItem('hadoku_session_id', 'dev-uid')
      localStorage.setItem('hadoku_user_type', 'friend')
    })
    await page.goto('/')
    await page.waitForSelector(APP_HEADER, { timeout: 15000 })
    await page.getByRole('button', { name: 'Edit boards' }).click()
    await page.getByRole('button', { name: `Automation for ${id}` }).click()

    const banner = page.locator('.automation-panel__update')
    await expect(banner).toBeVisible({ timeout: 10000 })
    await expect(banner).toContainText('published v1')
    await expect(banner).toContainText('no task moves')
    await expect(banner).not.toHaveClass(/is-unsafe/)

    // Applying IS one click: it fetches the newer contract and commits it
    // immediately, same as picking a preset on a fresh board.
    await page.getByRole('button', { name: 'Apply update' }).click()
    await expect(page.locator('.automation-panel__update')).toBeHidden({ timeout: 10000 })

    // The board is on v1 now, so the banner has nothing left to say.
    const { board } = await readBoard(request, id)
    expect(board.presetUpdate).toBeUndefined()
  })
})
