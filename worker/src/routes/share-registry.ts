/**
 * Resolving WHO a share is for, against the read-only key registry.
 *
 * A grantee is named by display name (preferred — no credential changes hands),
 * by raw key, or by userId. Everything here reads SESSIONS_KV and never stores
 * or logs a key. Kept out of the route file because the automation auto-grants
 * need the same resolution without going near HTTP.
 */
import type { Env } from '../types'

/** Shared because grants and routes both stamp rows with it. */
export const nowIso = () => new Date().toISOString()

export type Level = 'readonly' | 'contributor'

/** A row in the read-only key registry (`key:{rawKey}` → this). */
export interface KeyRow {
  userId?: string
  name?: string | null
  tier?: string
  /** Set once a rotation retires this key — retired rows never hold a claim. */
  retiredAt?: number
}

export type GranteeError = { error: string; status: 400 | 404 | 409; code?: string }
export type GranteeOk = { userId: string; name?: string | null; tier?: string }

export const noUserId: GranteeError = {
  error: 'That key has never signed in, so it has no id yet.',
  status: 409,
  code: 'NO_USER_ID' as const
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
export async function resolveGrantee(
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
        code: 'NAME_NOT_FOUND' as const
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
export async function readLiveRows(
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
export async function searchRegistryNames(
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
export async function registryNameMap(
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
