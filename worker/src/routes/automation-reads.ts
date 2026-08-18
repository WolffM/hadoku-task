/**
 * The two automation reads a board load performs: the lane contracts our
 * providers publish, and the actionable scan.
 *
 * Neither ever fails a board. A provider that is down, unconfigured or slow
 * comes back as `ok:false` with a reason, and the UI hides its button.
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { getBoardConfig } from './board-automation'
import { listPresets } from './board-presets'
import { fetchActionable } from './board-actionable'
import { tierAtLeast } from '@wolffm/worker-utils'
import { ActionableResponseSchema, ListPresetsResponseSchema } from '../schemas-agent'
import { forbidden, boardNotFound, refParam } from './automation-shared'
import type { AppContext } from '../types'

export function registerPresetsRoute(app: OpenAPIHono<AppContext>) {
  // The lane contracts our configured providers publish, fetched live so a board
  // is activated from the provider's current schema rather than a JSON blob some
  // human pasted months ago. Signed-in only (a public visitor can't activate
  // anything, so there's nothing for them to pick).
  const presetsRoute = createRoute({
    method: 'get',
    path: '/automation/presets',
    tags: ['Automation'],
    summary: 'Lane contracts published by configured providers',
    description:
      'Fetched server-side from each provider in AUTOMATION_PRESET_SOURCES and validated with the same lane-set validator activation uses. Revalidated with If-None-Match, so an unchanged contract costs a 304. `sources` reports each provider individually — an empty `presets` with a failing source means "provider down", not "none exist".',
    responses: {
      200: {
        description: 'Presets + per-source status',
        content: { 'application/json': { schema: ListPresetsResponseSchema } }
      }
    }
  })
  app.openapi(presetsRoute, async c => {
    const auth = c.get('authContext')
    if (!tierAtLeast(auth, 'friend')) return c.json({ presets: [], sources: [] }, 200)
    const result = await listPresets(c.env.AUTOMATION_PRESET_SOURCES)
    return c.json(result, 200)
  })
}

export function registerActionableRoute(app: OpenAPIHono<AppContext>) {
  // What this board's repo has open that the pipeline could take on (§5.6).
  //
  // Read on every board load, which is what shapes the failure behaviour: this
  // route NEVER fails a board. A provider that is down, unconfigured, or slow
  // comes back as `ok:false` + a reason, and the UI hides its button.
  const actionableRoute = createRoute({
    method: 'get',
    path: '/boards/{ref}/actionable',
    tags: ['Automation'],
    summary: "Open issues/PRs on this board's repo that could be automated",
    description:
      'Fetched server-side from TenHands (`/api/taskauto/actionable`), which has already dropped the pipeline\'s own `taskauto/*` PRs and bot authors. Addressed by the board\'s HANDLE, the same identifier the runner discovers boards by. `ok` means the answer is trustworthy, not that the list is non-empty: a board with no repo answers `ok:true` with `reason:"no_repo"` (definitely nothing to do), while a provider outage answers `ok:false` (unknown, do not present as an empty backlog). Nothing is created here — the caller creates ordinary Inbox tasks from the result.',
    request: { params: refParam },
    responses: {
      200: {
        description: 'The open items, or an explained empty list',
        content: { 'application/json': { schema: ActionableResponseSchema } }
      },
      403: { description: 'Read-only access to this board (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(actionableRoute, async c => {
    const auth = c.get('authContext')
    // A public visitor has no board to automate and no identity to scan with.
    if (!tierAtLeast(auth, 'friend')) {
      return c.json({ ok: false, repo: null, items: [], reason: 'signed_out' }, 200)
    }
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' as const }, 404)
    // Readonly can't create the tasks this feeds, so scanning for them is a
    // round-trip to the provider spent on a button that would never work.
    if (ctx.access === 'readonly') {
      return c.json({ error: 'Read-only access to this board', code: 'FORBIDDEN' as const }, 403)
    }
    const cfg = await getBoardConfig(c.env.DB, ctx.ownerId, ctx.boardId)
    // An unknown slug resolves to "your own not-yet-created board" (branch 4 of
    // resolveBoardAccess), so a null config here is a board that isn't stored.
    if (!cfg)
      return c.json({ error: `Board ${ref} not found`, code: 'BOARD_NOT_FOUND' as const }, 404)
    if (cfg.mode !== 'automation') {
      return c.json({ ok: true, repo: cfg.repo ?? null, items: [], reason: 'not_automation' }, 200)
    }
    if (!cfg.repo?.trim()) {
      return c.json({ ok: true, repo: null, items: [], reason: 'no_repo' }, 200)
    }

    // The board's OWN handle, not the ref the caller happened to use: a shared
    // board is addressable by handle only, and the handle is what the runner
    // knows the board by. A ref that is someone's local slug means nothing there.
    const scan = await fetchActionable(c.env, cfg.handle || ref)
    logRequest('GET', `/task/api/boards/${ref}/actionable`, {
      board: ctx.boardId,
      repo: cfg.repo,
      ok: scan.ok,
      items: scan.items.length,
      ...(scan.reason && { reason: scan.reason })
    })
    return c.json({ ...scan, repo: scan.repo ?? cfg.repo }, 200)
  })
}
