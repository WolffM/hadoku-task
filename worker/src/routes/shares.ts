/**
 * Board share management routes (§7).
 *
 * Owner-only: grant, list, revoke. Grantee-only: leave (remove own access).
 * Grantee identity is resolved by KEY via the read-only SESSIONS_KV registry
 * (never stored, never logged), or by a raw userId. A board is addressed by the
 * same ref (slug/handle) as everywhere else and resolved through getBoardContext.
 *
 * Routes are declared with createRoute so they both validate and appear in the
 * generated OpenAPI spec (schemas-agent.ts).
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { badRequest, tierAtLeast } from '@wolffm/worker-utils'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { listShares, upsertShare, removeShare, resolveOwnBoard } from './board-sharing'
import {
  GrantShareInputSchema,
  GrantShareResponseSchema,
  ListSharesResponseSchema,
  LeaveShareResponseSchema,
  RevokeShareResponseSchema,
  UserSearchResponseSchema,
  ForbiddenErrorSchema,
  BoardNotFoundErrorSchema,
  ShareGranteeNotFoundErrorSchema,
  NoUserIdErrorSchema
} from '../schemas-agent'
import { ErrorResponseSchema } from '../schemas'
import type { AppContext, Env } from '../types'

type Level = 'readonly' | 'contributor'

/** A row in the read-only key registry (`key:{rawKey}` → this). */
interface KeyRow {
  userId?: string
  name?: string | null
  tier?: string
  /** Set once a rotation retires this key — retired rows never hold a claim. */
  retiredAt?: number
}

type GranteeError = { error: string; status: 400 | 404 | 409; code?: string }
type GranteeOk = { userId: string; name?: string | null; tier?: string }

const noUserId: GranteeError = {
  error: 'That key has never signed in, so it has no id yet.',
  status: 409,
  code: 'NO_USER_ID'
}

/**
 * Resolve a grantee to a stable userId (§7). Three ways, preferred first:
 *   - by display NAME — the identifier a human actually has; resolved via the
 *     same case-insensitive, retired-row-excluding scan `isNameTaken` uses in
 *     edge-router, so a name is as unambiguous here as it is there. No raw
 *     credential ever changes hands.
 *   - by raw KEY (a bearer credential — kept for now, deprecate later).
 *   - by raw userId (no lookup).
 */
async function resolveGrantee(
  env: Env,
  input: { name?: string; key?: string; userId?: string }
): Promise<GranteeOk | GranteeError> {
  if (input.userId) return { userId: input.userId }

  if (input.name) {
    if (!env.SESSIONS_KV) {
      return { error: 'Name resolution unavailable; pass `userId` instead.', status: 400 }
    }
    if (!input.name.trim()) return { error: '`name` is empty.', status: 400 }
    const row = await resolveRegistryName(env, input.name)
    if (!row) {
      return {
        error: `No registered key named "${input.name}".`,
        status: 404,
        code: 'NAME_NOT_FOUND'
      }
    }
    if (!row.userId) return noUserId
    return { userId: row.userId, name: row.name, tier: row.tier }
  }

  const key = input.key
  if (!key) return { error: 'Provide `name`, `key`, or `userId`.', status: 400 }
  if (!env.SESSIONS_KV)
    return { error: 'Key resolution unavailable; pass `userId` instead.', status: 400 }
  const raw = await env.SESSIONS_KV.get(`key:${key}`)
  if (!raw) return { error: 'That key is not registered.', status: 400 }
  let rec: KeyRow
  try {
    rec = JSON.parse(raw) as KeyRow
  } catch {
    return { error: 'Registry record is unreadable.', status: 400 }
  }
  // userId is lazily minted on first sign-in; a key that never signed in has none.
  if (!rec.userId) return noUserId
  return { userId: rec.userId, name: rec.name, tier: rec.tier }
}

/**
 * Resolve a registry DISPLAY NAME to its live row.
 *
 * Same shape as `isNameTaken` in edge-router: list the `key:` prefix, get each
 * row, skip retired rows, match the name case-insensitively. Returns null when no
 * live row carries the name; `userId: null` when a row matched but has never
 * signed in (userId is minted lazily, and a key without one cannot hold a share).
 *
 * The caller checks the SESSIONS_KV binding itself when it needs to tell "no
 * registry" apart from "no such name" — both look like null from here.
 */
export async function resolveRegistryName(
  env: Env,
  name: string
): Promise<{ name: string; userId: string | null; tier?: string } | null> {
  if (!env.SESSIONS_KV) return null
  const target = name.trim().toLowerCase()
  if (!target) return null
  const list = await env.SESSIONS_KV.list({ prefix: 'key:' })
  for (const entry of list.keys) {
    const raw = await env.SESSIONS_KV.get(entry.name)
    if (!raw) continue
    let rec: KeyRow
    try {
      rec = JSON.parse(raw) as KeyRow
    } catch {
      continue
    }
    if (rec.retiredAt) continue
    if (rec.name && rec.name.trim().toLowerCase() === target) {
      return { name: rec.name, userId: rec.userId ?? null, tier: rec.tier }
    }
  }
  return null
}

/**
 * Read all LIVE registry rows (non-retired, with a userId), fetching values in
 * PARALLEL. KV.list returns only keys, so each row is a separate get — doing them
 * sequentially made the scan seconds-slow (it timed out on the autocomplete hot
 * path). Promise.all collapses that to one round-trip's latency.
 */
async function readLiveRows(
  env: Env
): Promise<Array<{ userId: string; name: string | null; tier?: string }>> {
  // Guard `list` too, not just the binding: a stub/misconfigured registry that
  // lacks it must degrade to "no rows", never throw into the caller.
  if (!env.SESSIONS_KV || typeof env.SESSIONS_KV.list !== 'function') return []
  const list = await env.SESSIONS_KV.list({ prefix: 'key:' })
  const kv = env.SESSIONS_KV
  const raws = await Promise.all(list.keys.map(entry => kv.get(entry.name)))
  const rows: Array<{ userId: string; name: string | null; tier?: string }> = []
  for (const raw of raws) {
    if (!raw) continue
    try {
      const rec = JSON.parse(raw) as KeyRow
      if (rec.retiredAt || !rec.userId) continue
      rows.push({ userId: rec.userId, name: rec.name ?? null, tier: rec.tier })
    } catch {
      /* skip malformed */
    }
  }
  return rows
}

/**
 * Search live registry rows by display-name substring (case-insensitive), for the
 * share UI's autocomplete. Display names carry no auth bearing, so exposing them
 * is safe; results are deduped by name, prefix-matches-first, and capped.
 */
async function searchRegistryNames(
  env: Env,
  query: string,
  limit: number
): Promise<Array<{ name: string; tier?: string }>> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const seen = new Set<string>()
  const out: Array<{ name: string; tier?: string }> = []
  for (const row of await readLiveRows(env)) {
    if (!row.name) continue
    const lower = row.name.trim().toLowerCase()
    if (!lower.includes(q) || seen.has(lower)) continue
    seen.add(lower)
    out.push({ name: row.name, tier: row.tier })
  }
  out.sort((a, b) => {
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1
    return ap - bp || a.name.localeCompare(b.name)
  })
  return out.slice(0, limit)
}

/**
 * One registry scan → userId → { name, tier } for annotating a share list.
 *
 * Goes through readLiveRows so the per-key gets run in PARALLEL (it used to walk
 * them sequentially) and so a registry binding without `list` degrades to "no
 * names" instead of throwing — an annotation failure must never cost the caller
 * its share list.
 */
async function registryNameMap(
  env: Env
): Promise<Map<string, { name: string | null; tier?: string }>> {
  const map = new Map<string, { name: string | null; tier?: string }>()
  for (const row of await readLiveRows(env)) {
    // A userId can appear on multiple rows (rotation); the live one wins.
    map.set(row.userId, { name: row.name, tier: row.tier })
  }
  return map
}

/** One grantee on a board, annotated with display name + tier for the UI. */
export interface AnnotatedShare {
  granteeUserId: string
  level: string
  createdAt: string
  name: string | null
  tier: string | null
}

/**
 * Every share this owner has granted, grouped by board id and annotated with the
 * grantee's display name + tier — ONE query plus ONE registry scan for the whole
 * board set.
 *
 * Used to hydrate `GET /boards` so the Edit Boards UI has each owned board's
 * grantees up front. It used to fetch them per board when a share panel opened,
 * which meant the grantee list appeared late (or not at all — the client's
 * listShares swallows every failure as an empty list, so a hiccup was
 * indistinguishable from "not shared with anyone").
 */
export async function annotatedSharesByBoard(
  env: Env,
  ownerId: string
): Promise<Map<string, AnnotatedShare[]>> {
  const byBoard = new Map<string, AnnotatedShare[]>()
  const db = env.DB as unknown as {
    prepare(sql: string): {
      bind(...a: unknown[]): { all<T>(): Promise<{ results: T[] }> }
    }
  }
  const { results } = await db
    .prepare(
      `SELECT board_id AS boardId, grantee_user_id AS granteeUserId, level, created_at AS createdAt
         FROM board_shares WHERE owner_user_id = ? ORDER BY created_at`
    )
    .bind(ownerId)
    .all<{ boardId: string; granteeUserId: string; level: string; createdAt: string }>()
  if (!results.length) return byBoard
  const names = await registryNameMap(env)
  for (const s of results) {
    const who = names.get(s.granteeUserId)
    const arr = byBoard.get(s.boardId) ?? []
    arr.push({
      granteeUserId: s.granteeUserId,
      level: s.level,
      createdAt: s.createdAt,
      name: who?.name ?? null,
      tier: who?.tier ?? null
    })
    byBoard.set(s.boardId, arr)
  }
  return byBoard
}

const nowIso = () => new Date().toISOString()

/**
 * The automation runner's registry identity: the key TenHands' worker actually
 * presents (hadoku_site keeps its value in the `TENHANDS_SERVICE_KEY` vault item
 * and the PM2 wrapper fetches it). Deliberately NOT `tenhands-devvault`, which is
 * only the operator-side dev-vault caller and never touches a board.
 *
 * Overridable via binding because this name has churned before — the app's key was
 * retired and re-minted under a second identity (hadoku_site 881cddd2), and a
 * rename must not need a deploy of this worker to keep auto-sharing working.
 */
const DEFAULT_RUNNER_NAME = 'tenhands-service-key'

/** Why an auto-grant didn't happen. Reported, never silently swallowed. */
export type AutoShareOutcome =
  | { granted: true; name: string; granteeUserId: string }
  | {
      granted: false
      name: string
      reason: 'already_shared' | 'no_registry_row' | 'no_user_id' | 'registry_unavailable' | 'self'
    }

/**
 * Grant a registry identity `contributor` on a board, resolved by DISPLAY NAME.
 *
 * INSERT ... DO NOTHING, not the upsert `upsertShare` uses: if an owner has
 * deliberately pinned this grantee to `readonly` on this board, an auto-grant must
 * not silently escalate it back to contributor. An existing row of any level is
 * reported as `already_shared` and left alone.
 *
 * Never throws — every caller has already committed its write by the time this
 * runs, and a registry hiccup must not turn a succeeded write into a 500. The
 * outcome goes back in the response so a failed grant is visible, not mysterious.
 */
async function grantShareByName(
  env: Env,
  ownerId: string,
  boardId: string,
  name: string,
  what: string
): Promise<AutoShareOutcome> {
  if (!env.SESSIONS_KV) return { granted: false, name, reason: 'registry_unavailable' }
  try {
    const row = await resolveRegistryName(env, name)
    if (!row) return { granted: false, name, reason: 'no_registry_row' }
    if (!row.userId) return { granted: false, name, reason: 'no_user_id' }
    // The grantee owning the board is not an error, but a self-share is meaningless.
    if (row.userId === ownerId) return { granted: false, name, reason: 'self' }
    const db = env.DB as unknown as {
      prepare(sql: string): {
        bind(...a: unknown[]): { run(): Promise<{ meta: { changes: number } }> }
      }
    }
    const res = await db
      .prepare(
        `INSERT INTO board_shares (owner_user_id, board_id, grantee_user_id, level, created_at)
           VALUES (?, ?, ?, 'contributor', ?)
         ON CONFLICT(owner_user_id, board_id, grantee_user_id) DO NOTHING`
      )
      .bind(ownerId, boardId, row.userId, nowIso())
      .run()
    if (res.meta.changes === 0) return { granted: false, name, reason: 'already_shared' }
    return { granted: true, name, granteeUserId: row.userId }
  } catch (err) {
    // Not swallowed: the caller's write stands, but say loudly why the grant didn't.
    logRequest('POST', `auto-share/${what}`, {
      board: boardId,
      grantee: name,
      error: err instanceof Error ? err.message : String(err)
    })
    return { granted: false, name, reason: 'registry_unavailable' }
  }
}

/**
 * Give the automation runner `contributor` on a board that just became an
 * automation board — the grant it needs to read lanes and move tasks (§7, §5.4).
 * Without this every automation board needed a hand-typed share before the runner
 * could touch it, which is the step everyone forgot.
 */
export async function grantAutomationRunnerShare(
  env: Env,
  ownerId: string,
  boardId: string
): Promise<AutoShareOutcome> {
  const name = env.AUTOMATION_RUNNER_KEY_NAME?.trim() || DEFAULT_RUNNER_NAME
  return grantShareByName(env, ownerId, boardId, name, 'automation-runner')
}

/**
 * The registry display name of a repo's service key, by convention:
 * **`<repo name, with a leading `hadoku-` trimmed>-service-key`**.
 *
 *   WolffM/hadoku-aggregator → aggregator-service-key
 *   WolffM/tenhands          → tenhands-service-key
 *   WolffM/hadoku_site       → site-service-key
 *
 * The separator after `hadoku` may be `-` or `_`, because one real repo spells it
 * with an underscore: `WolffM/hadoku_site`'s key is `site-service-key`, so a
 * hyphen-only trim would leave `hadoku_site-service-key` and match nothing. No
 * live key name begins with `hadoku`, so accepting both can't collide.
 *
 * The owner segment is dropped — a key is named for the repo, not who hosts it.
 * Returns null when there's nothing to derive from, so the caller can skip the
 * lookup rather than resolve a garbage name.
 *
 * This convention is the whole reason repo→key is answerable at all: the registry
 * row carries no `repo` field (hadoku_site `RegistryRecord` is
 * {userId, name, tier, createdAt, lastSeenAt, retiredAt}), so the NAME is the only
 * link between a board's checkout mapping and an identity. If the convention ever
 * stops holding, this derivation is the single place that has to change.
 */
export function repoServiceKeyName(repo: string | null | undefined): string | null {
  const trimmed = (repo ?? '').trim()
  if (!trimmed) return null
  // Boards store "owner/name"; take the repo name, tolerating a trailing slash.
  const segments = trimmed.split('/').filter(Boolean)
  const repoName = segments.length ? segments[segments.length - 1].trim() : ''
  if (!repoName) return null
  const stem = /^hadoku[-_]/i.test(repoName) ? repoName.slice('hadoku-'.length) : repoName
  // A repo named exactly "hadoku-" would trim to nothing; don't invent a name.
  if (!stem) return null
  return `${stem}-service-key`
}

/**
 * Give a board's repo its own service key `contributor` on that board, so
 * connecting a repo is all it takes for that repo's agent to reach the work
 * (§5.5, §7). The grantee is derived from the repo name — see
 * `repoServiceKeyName` for the convention and why a name is the only link.
 *
 * Returns null when no name is derivable (no repo, or the repo was cleared), which
 * the caller reports as "not attempted" rather than as a failed grant.
 */
export async function grantRepoServiceKeyShare(
  env: Env,
  ownerId: string,
  boardId: string,
  repo: string | null | undefined
): Promise<AutoShareOutcome | null> {
  const name = repoServiceKeyName(repo)
  if (!name) return null
  return grantShareByName(env, ownerId, boardId, name, 'repo-service-key')
}

// Narrowed to the codes each (route, status) can actually emit — see agent.ts.
const forbidden = { 'application/json': { schema: ForbiddenErrorSchema } }
const boardNotFound = { 'application/json': { schema: BoardNotFoundErrorSchema } }
const granteeNotFound = { 'application/json': { schema: ShareGranteeNotFoundErrorSchema } }
const noUserIdErr = { 'application/json': { schema: NoUserIdErrorSchema } }
const simpleErr = { 'application/json': { schema: ErrorResponseSchema } }
const refParam = z.object({
  ref: z.string().openapi({ param: { name: 'ref', in: 'path' }, example: 'main' })
})

export function createShareRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Autocomplete: search live display names for the share UI. Auth-gated to a
  // signed-in (non-public) caller — a board owner picking a grantee. Display
  // names carry no auth bearing, so returning them is safe.
  const searchRoute = createRoute({
    method: 'get',
    path: '/users/search',
    tags: ['Sharing'],
    summary: 'Search display names (share autocomplete)',
    request: {
      query: z.object({
        q: z.string().openapi({ example: 'ten', description: 'Name prefix/substring.' }),
        limit: z.string().optional()
      })
    },
    responses: {
      200: {
        description: 'Matching users',
        content: { 'application/json': { schema: UserSearchResponseSchema } }
      }
    }
  })
  app.openapi(searchRoute, (async (c: any) => {
    const auth = c.get('authContext')
    // Only signed-in users may enumerate names (avoids anonymous scraping).
    if (!tierAtLeast(auth, 'friend')) {
      return c.json({ users: [] })
    }
    const { q, limit } = c.req.valid('query')
    const n = Math.min(Math.max(1, parseInt(limit ?? '8', 10) || 8), 20)
    const users = await searchRegistryNames(c.env, q, n)
    return c.json({ users })
  }) as never)

  // Grant (or update) a share — owner only.
  const grantRoute = createRoute({
    method: 'post',
    path: '/boards/{ref}/shares',
    tags: ['Sharing'],
    summary: 'Grant a board share (owner only)',
    request: {
      params: refParam,
      body: { content: { 'application/json': { schema: GrantShareInputSchema } } }
    },
    responses: {
      200: {
        description: 'Share granted',
        content: { 'application/json': { schema: GrantShareResponseSchema } }
      },
      400: { description: 'Invalid grantee', content: simpleErr },
      403: { description: 'Not the owner (FORBIDDEN)', content: forbidden },
      404: {
        description: 'Board not found, or no key with that name (BOARD_NOT_FOUND | NAME_NOT_FOUND)',
        content: granteeNotFound
      },
      409: { description: 'Named key never signed in (NO_USER_ID)', content: noUserIdErr }
    }
  })
  app.openapi(grantRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can manage shares', code: 'FORBIDDEN' }, 403)
    }
    const body = c.req.valid('json') as {
      name?: string
      key?: string
      userId?: string
      level: Level
    }

    const grantee = await resolveGrantee(c.env, {
      name: body.name,
      key: body.key,
      userId: body.userId
    })
    if ('error' in grantee) {
      const b: Record<string, unknown> = { error: grantee.error }
      if (grantee.code) b.code = grantee.code
      return c.json(b, grantee.status)
    }
    if (grantee.userId === ctx.ownerId) {
      return badRequest(c, 'The owner already has full access.')
    }

    // Never log the key — only the (masked) resolved id + display name.
    logRequest('POST', `/task/api/boards/${ref}/shares`, {
      board: ctx.boardId,
      grantee: `${grantee.userId.slice(0, 8)}…`,
      level: body.level
    })

    await upsertShare(c.env.DB, ctx.ownerId, ctx.boardId, grantee.userId, body.level, nowIso())
    // Echo what was granted so the owner can confirm it's the right identity/tier.
    return c.json({
      ok: true,
      granteeUserId: grantee.userId,
      granteeName: grantee.name ?? null,
      level: body.level,
      granted: { name: grantee.name ?? null, tier: grantee.tier ?? null, level: body.level }
    })
  }) as never)

  // List shares on a board — owner only.
  const listRoute = createRoute({
    method: 'get',
    path: '/boards/{ref}/shares',
    tags: ['Sharing'],
    summary: "List a board's shares (owner only)",
    request: { params: refParam },
    responses: {
      200: {
        description: 'The shares',
        content: { 'application/json': { schema: ListSharesResponseSchema } }
      },
      403: { description: 'Not the owner (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(listRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can view shares', code: 'FORBIDDEN' }, 403)
    }
    const shares = await listShares(c.env.DB, ctx.ownerId, ctx.boardId)
    // Annotate each grantee with their display name + tier (one registry scan)
    // so the share UI shows people, not raw userIds.
    const names = shares.length ? await registryNameMap(c.env) : new Map()
    const annotated = shares.map(s => {
      const who = names.get(s.granteeUserId)
      return { ...s, name: who?.name ?? null, tier: who?.tier ?? null }
    })
    return c.json({ shares: annotated })
  }) as never)

  // Leave a shared board — grantee removes their OWN access, no owner involved.
  const leaveRoute = createRoute({
    method: 'delete',
    path: '/boards/{ref}/shares/me',
    tags: ['Sharing'],
    summary: 'Leave a shared board (grantee)',
    request: { params: refParam },
    responses: {
      200: {
        description: 'Left the board',
        content: { 'application/json': { schema: LeaveShareResponseSchema } }
      },
      400: { description: 'You own this board', content: simpleErr },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(leaveRoute, (async (c: any) => {
    const { ref } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access === 'owner') {
      return badRequest(c, "You own this board; you can't leave it. Delete it instead.")
    }
    logRequest('DELETE', `/task/api/boards/${ref}/shares/me`, { board: ctx.boardId })
    await removeShare(c.env.DB, ctx.ownerId, ctx.boardId, ctx.callerId)
    return c.json({ ok: true, left: true })
  }) as never)

  // Revoke a grantee's access — owner only.
  const revokeRoute = createRoute({
    method: 'delete',
    path: '/boards/{ref}/shares/{granteeUserId}',
    tags: ['Sharing'],
    summary: "Revoke a grantee's access (owner only)",
    request: {
      params: refParam.extend({
        granteeUserId: z.string().openapi({ param: { name: 'granteeUserId', in: 'path' } })
      })
    },
    responses: {
      200: {
        description: 'Revoked',
        content: { 'application/json': { schema: RevokeShareResponseSchema } }
      },
      403: { description: 'Not the owner (FORBIDDEN)', content: forbidden },
      404: { description: 'Board not found (BOARD_NOT_FOUND)', content: boardNotFound }
    }
  })
  app.openapi(revokeRoute, (async (c: any) => {
    const { ref, granteeUserId } = c.req.valid('param')
    const ctx = await getBoardContext(c, ref)
    if (!ctx) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    if (ctx.access !== 'owner') {
      return c.json({ error: 'Only the board owner can revoke shares', code: 'FORBIDDEN' }, 403)
    }
    // Guard: the owner's board must actually resolve to their own row.
    const own = await resolveOwnBoard(c.env.DB, ctx.ownerId, ref)
    if (!own) return c.json({ error: 'Board not found', code: 'BOARD_NOT_FOUND' }, 404)
    logRequest('DELETE', `/task/api/boards/${ref}/shares/${granteeUserId.slice(0, 8)}…`, {
      board: ctx.boardId
    })
    const removed = await removeShare(c.env.DB, ctx.ownerId, ctx.boardId, granteeUserId)
    return c.json({ ok: true, removed })
  }) as never)

  return app
}
