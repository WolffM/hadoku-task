/**
 * POST /task/api/_account/erase — the account-erase hook (hadoku_site
 * IDENTITY_MODEL R12, "Erase hooks").
 *
 *   200 → { erased: { boards, tasks, board_meta, board_prefs, board_shares,
 *                     task_claims, task_claim_log, task_events } }
 *
 * Account deletion on the edge calls this beside prefs-api's `_account/erase`,
 * under the edge's seal, for the member it has just authenticated. The person
 * is the edge-stamped X-User-Id, never a body field (R5). The edge 404s every
 * inbound path with an `_account` segment, so no page can reach this through
 * the proxy; a direct workers.dev hit carries no seal and is refused here.
 *
 * WHAT IS THE PERSON'S OWN, and what is SHARED and stays:
 *
 * A board is SHARED when its `board_shares` lists anyone other than its owner.
 * Others read it, and contributors write tasks and claims into it, so it stays
 * whole: the board row, its tasks, claims, claim log, stats events, its share
 * rows and its grantees' pins. It keeps naming its owner by the userId in
 * `boards.user_id`, which no longer resolves to anyone. The code has no owner
 * transfer to use instead: ownership IS the storage namespace (`user_id` is half
 * of every primary key and grantees reach the board through it), and no API
 * moves a board between owners. A share to a service key (the automation
 * runner) counts as sharing: that agent writes tasks and claims into the board.
 *
 * Everything else the person owns is erased:
 *   - boards     their boards that nobody else shares.
 *   - tasks      every task in their namespace not on a kept shared board,
 *                including tasks whose board no longer exists.
 *   - task_claims / task_claim_log   claims on those tasks' boards. Claims they
 *                hold as an agent on SOMEONE ELSE's board are that board's
 *                shared state and stay, naming them by id.
 *   - task_events  their stats history (`user_key` = maskKey(userId)), except
 *                the events of a kept shared board: grantees' actions on it
 *                are logged under the owner's key too, so those are the
 *                board's history, not the person's.
 *   - board_prefs  every pin they set (their own settings), and the pins
 *                anyone set on a board erased here.
 *   - board_shares their access to other people's boards, and the share rows
 *                of boards erased here.
 *   - board_meta  their board-list version row, only once they own no board.
 *                While a shared board stays, a grantee's write runs in the
 *                owner's namespace and `ensureInitialized` would recreate a
 *                missing row AND a default `main` board under the dead id.
 *
 * Task stores no copy of a person's name: share lists look names up in the
 * registry when shown (share-registry.ts). TASKS_KV holds only throttle state,
 * which the edge-sealed member tiers never write.
 *
 * Not reachable from here: events written under the pre-userId raw-credential
 * namespace (`maskKey(legacyId)`), since the erase is given a userId and no
 * credential. The theme editor's commit author name lives in this repo's git
 * history on GitHub, not in task's storage.
 *
 * ONE atomic batch. The kept set is a subquery evaluated inside it, so a share
 * granted concurrently cannot be raced: either it landed first and the board
 * stays, or it lands after and has nothing to attach to. The kept set cannot
 * change during the batch, because nothing in it deletes a kept board or a
 * share to someone else on one. Idempotent: a second call answers zeros.
 */
import type { Context } from 'hono'
import { maskKey, tierAtLeast } from '@wolffm/worker-utils'
import type { AppContext } from './types'

/** The tables the hook erases from, in the order the batch runs them. */
export const ERASED_TABLES = [
  'tasks',
  'tracker_entries',
  'trackers',
  'task_claims',
  'task_claim_log',
  'task_events',
  'board_prefs',
  'board_shares',
  'boards',
  'board_meta'
] as const

export type ErasedCounts = Record<(typeof ERASED_TABLES)[number], number>

/** Slugs of the person's boards that someone else shares. Binds the userId twice. */
const KEPT_BOARDS = `SELECT b.id FROM boards b
  WHERE b.user_id = ?
    AND EXISTS (SELECT 1 FROM board_shares s
                 WHERE s.owner_user_id = b.user_id AND s.board_id = b.id
                   AND s.grantee_user_id <> ?)`

interface EraseDb {
  prepare(sql: string): { bind(...args: unknown[]): unknown }
  batch(statements: unknown[]): Promise<Array<{ meta?: { changes?: number } }>>
}

/** Erase what task holds that is `userId`'s own. See the header for what that is. */
export async function eraseAccountData(db: EraseDb, userId: string): Promise<ErasedCounts> {
  const u = userId
  const statements: Record<keyof ErasedCounts, [string, unknown[]]> = {
    tasks: [`DELETE FROM tasks WHERE user_id = ? AND board_id NOT IN (${KEPT_BOARDS})`, [u, u, u]],
    tracker_entries: [
      `DELETE FROM tracker_entries WHERE user_id = ? AND board_id NOT IN (${KEPT_BOARDS})`,
      [u, u, u]
    ],
    trackers: [
      `DELETE FROM trackers WHERE user_id = ? AND board_id NOT IN (${KEPT_BOARDS})`,
      [u, u, u]
    ],
    task_claims: [
      `DELETE FROM task_claims WHERE user_id = ? AND board_id NOT IN (${KEPT_BOARDS})`,
      [u, u, u]
    ],
    task_claim_log: [
      `DELETE FROM task_claim_log WHERE user_id = ? AND board_id NOT IN (${KEPT_BOARDS})`,
      [u, u, u]
    ],
    task_events: [
      `DELETE FROM task_events WHERE user_key = ? AND board_id NOT IN (${KEPT_BOARDS})`,
      [maskKey(u), u, u]
    ],
    board_prefs: [
      `DELETE FROM board_prefs
        WHERE user_id = ? OR (owner_id = ? AND board_id NOT IN (${KEPT_BOARDS}))`,
      [u, u, u, u]
    ],
    board_shares: [
      `DELETE FROM board_shares
        WHERE grantee_user_id = ? OR (owner_user_id = ? AND board_id NOT IN (${KEPT_BOARDS}))`,
      [u, u, u, u]
    ],
    boards: [`DELETE FROM boards WHERE user_id = ? AND id NOT IN (${KEPT_BOARDS})`, [u, u, u]],
    board_meta: [
      'DELETE FROM board_meta WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM boards WHERE user_id = ?)',
      [u, u]
    ]
  }
  const results = await db.batch(
    ERASED_TABLES.map(t => db.prepare(statements[t][0]).bind(...statements[t][1]))
  )
  const erased = {} as ErasedCounts
  ERASED_TABLES.forEach((t, i) => {
    const changes = results[i]?.meta?.changes
    if (typeof changes !== 'number') throw new Error(`erase: no change count for ${t}`)
    erased[t] = changes
  })
  return erased
}

/**
 * The route. Refuses anything but an edge-sealed signed-in identity: root's
 * createEdgeAuth already degraded an unsealed or wrongly sealed request to
 * `public` and stripped its X-User-Id, so the person comes from authContext.
 */
export async function handleAccountErase(c: Context<AppContext>) {
  const auth = c.get('authContext')
  if (!auth?.userId || !tierAtLeast(auth, 'member')) {
    return c.json({ error: 'An edge-sealed member identity is required' }, 401)
  }
  const erased = await eraseAccountData(c.env.DB as unknown as EraseDb, auth.userId)
  return c.json({ erased }, 200)
}
