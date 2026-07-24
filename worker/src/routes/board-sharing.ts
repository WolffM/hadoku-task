/**
 * Shared-board resolution + share management (§7).
 *
 * These functions query D1 directly (never through the Storage interface) so the
 * sharing concern stays at the route edge and the 16 handler signatures + the
 * whole Storage interface are untouched (§7.1). The route resolves a board
 * reference to { ownerId, boardId, access } and hands the handler an auth whose
 * sessionId is the OWNER's id.
 *
 * SECURITY INVARIANT: a slug (`id`) ALWAYS resolves within the caller's own
 * namespace. Only a globally-unique `handle` can cross to another owner, and only
 * via a matching board_shares row. So passing someone else's slug can never reach
 * their data — it resolves to the caller's own (possibly empty) board of that slug.
 */

export type Access = 'owner' | 'contributor' | 'readonly'

export interface BoardResolution {
  ownerId: string
  boardId: string // the owner's slug for the board
  access: Access
  // Automation config carried through so a route can enforce lane writes (§5.2)
  // without a second board read. `mode` is 'standard' | 'automation'; `lanes` is
  // the raw JSON column (parsed lazily by the enforcement helper).
  mode: string
  lanesJson: string | null
}

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(col?: string): Promise<T | null>
      run(): Promise<{ meta: { changes: number } }>
      all<T = unknown>(): Promise<{ results: T[] }>
    }
  }
}

/**
 * Resolve a board reference for a caller. `ref` may be the caller's own board
 * slug/handle, or another owner's board HANDLE that has been shared with the
 * caller. Returns null when the ref is a real handle the caller has no share for
 * (forbidden). Unknown slugs resolve to the caller's own namespace, preserving
 * today's behaviour for implicit/new boards (e.g. a first-load `main`).
 */
export async function resolveBoardAccess(
  db: D1Like,
  callerId: string,
  ref: string
): Promise<BoardResolution | null> {
  // 1. Own board (by slug or handle) — the common path, one indexed lookup.
  const own = await db
    .prepare('SELECT id, mode, lanes FROM boards WHERE user_id = ? AND (id = ? OR handle = ?) LIMIT 1')
    .bind(callerId, ref, ref)
    .first<{ id: string; mode: string; lanes: string | null }>()
  if (own) {
    return { ownerId: callerId, boardId: own.id, access: 'owner', mode: own.mode, lanesJson: own.lanes }
  }

  // 2. A board shared with the caller — addressable ONLY by its handle.
  const shared = await db
    .prepare(
      `SELECT b.user_id AS owner, b.id AS bid, b.mode AS mode, b.lanes AS lanes, s.level AS access
         FROM boards b
         JOIN board_shares s ON s.owner_user_id = b.user_id AND s.board_id = b.id
        WHERE b.handle = ? AND s.grantee_user_id = ?
        LIMIT 1`
    )
    .bind(ref, callerId)
    .first<{ owner: string; bid: string; mode: string; lanes: string | null; access: Access }>()
  if (shared) {
    return {
      ownerId: shared.owner,
      boardId: shared.bid,
      access: shared.access,
      mode: shared.mode,
      lanesJson: shared.lanes
    }
  }

  // 3. If ref is a real handle owned by someone else with no share for the
  //    caller, it's forbidden — do not fall through to the caller's namespace.
  const isHandle = await db
    .prepare('SELECT 1 AS x FROM boards WHERE handle = ? LIMIT 1')
    .bind(ref)
    .first<{ x: number }>()
  if (isHandle) return null

  // 4. An unknown slug: the caller's own (not-yet-created) board of that slug —
  //    a standard board by default (automation is opt-in via activation).
  return { ownerId: callerId, boardId: ref, access: 'owner', mode: 'standard', lanesJson: null }
}

/** Owner-resolve a board ref to the owner's board, for owner-only share management. */
export async function resolveOwnBoard(
  db: D1Like,
  ownerId: string,
  ref: string
): Promise<{ boardId: string } | null> {
  const row = await db
    .prepare('SELECT id FROM boards WHERE user_id = ? AND (id = ? OR handle = ?) LIMIT 1')
    .bind(ownerId, ref, ref)
    .first<{ id: string }>()
  return row ? { boardId: row.id } : null
}

export interface ShareRow {
  granteeUserId: string
  level: Access
  createdAt: string
}

/** List the shares on a board (owner-only view). */
export async function listShares(
  db: D1Like,
  ownerId: string,
  boardId: string
): Promise<ShareRow[]> {
  const { results } = await db
    .prepare(
      `SELECT grantee_user_id AS granteeUserId, level, created_at AS createdAt
         FROM board_shares WHERE owner_user_id = ? AND board_id = ? ORDER BY created_at`
    )
    .bind(ownerId, boardId)
    .all<ShareRow>()
  return results
}

/** Grant (or update) a share. Upsert so re-granting changes the level. */
export async function upsertShare(
  db: D1Like,
  ownerId: string,
  boardId: string,
  granteeUserId: string,
  level: Access,
  nowIso: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO board_shares (owner_user_id, board_id, grantee_user_id, level, created_at)
         VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_user_id, board_id, grantee_user_id)
         DO UPDATE SET level = excluded.level`
    )
    .bind(ownerId, boardId, granteeUserId, level, nowIso)
    .run()
}

/** Revoke a grantee's access. Also drops the grantee's per-viewer prefs. */
export async function removeShare(
  db: D1Like,
  ownerId: string,
  boardId: string,
  granteeUserId: string
): Promise<boolean> {
  const res = await db
    .prepare(
      'DELETE FROM board_shares WHERE owner_user_id = ? AND board_id = ? AND grantee_user_id = ?'
    )
    .bind(ownerId, boardId, granteeUserId)
    .run()
  await db
    .prepare('DELETE FROM board_prefs WHERE user_id = ? AND owner_id = ? AND board_id = ?')
    .bind(granteeUserId, ownerId, boardId)
    .run()
  return res.meta.changes > 0
}
