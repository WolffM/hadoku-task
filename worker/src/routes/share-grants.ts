/**
 * The §7 auto-grants: giving the automation runner, and a repo's own service
 * key, contributor access on a board without a human granting it.
 *
 * Every outcome is reported rather than swallowed — a grant that could not
 * happen comes back as `skipped` with a reason, because silently not sharing a
 * board is how an agent ends up unable to see its own work.
 */
import { logRequest } from '../logger'
import { DEFAULT_RUNNER_NAME, repoServiceKeyName } from './share-naming'
import { nowIso, readLiveRows, resolveRegistryName } from './share-registry'
import type { Env } from '../types'

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
export async function grantShareByName(
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
 * Every live registry row keyed by LOWERCASED display name, for callers that
 * resolve many names at once. `resolveRegistryName` costs a full `key:` scan per
 * name; a reconcile over N boards would pay that 2N times. This pays it once.
 *
 * A name can appear on more than one live row only through operator error (the
 * registry treats names as unique, `isNameTaken`-style); last row wins, which
 * matches how `registryNameMap` resolves a duplicate userId.
 */
export async function liveRowsByName(
  env: Env
): Promise<Map<string, { userId: string; name: string | null; tier?: string }>> {
  const map = new Map<string, { userId: string; name: string | null; tier?: string }>()
  for (const row of await readLiveRows(env)) {
    if (row.name) map.set(row.name.trim().toLowerCase(), row)
  }
  return map
}

/**
 * Grant `contributor`, reporting what the write actually did to any existing row.
 *
 * `force` is what separates a reconcile from the incidental auto-grants: the
 * automatic paths use INSERT ... DO NOTHING so they can never escalate a level an
 * owner set by hand, but a reconcile is an owner deliberately asking for these
 * connections to exist. So `force` upserts to contributor — and reports
 * `escalated` with the level it replaced, so the change is never silent.
 */
export async function grantContributor(
  env: Env,
  ownerId: string,
  boardId: string,
  granteeUserId: string,
  force: boolean,
  /**
   * Resolve the outcome without writing. A preview MUST run the same reads and
   * the same branching as the commit, or its plan is a guess — reporting every
   * target as `granted` when six of them already had a share overstated the work
   * by nearly 2x, which is exactly the thing a dry run exists to prevent.
   */
  previewOnly = false
): Promise<{ outcome: 'granted' | 'already_shared' | 'escalated'; previousLevel?: string }> {
  const db = env.DB as unknown as {
    prepare(sql: string): {
      bind(...a: unknown[]): {
        first<T>(): Promise<T | null>
        run(): Promise<{ meta: { changes: number } }>
      }
    }
  }
  const existing = await db
    .prepare(
      'SELECT level FROM board_shares WHERE owner_user_id = ? AND board_id = ? AND grantee_user_id = ?'
    )
    .bind(ownerId, boardId, granteeUserId)
    .first<{ level: string }>()

  if (existing) {
    if (existing.level === 'contributor')
      return { outcome: 'already_shared', previousLevel: 'contributor' }
    if (!force) return { outcome: 'already_shared', previousLevel: existing.level }
    if (previewOnly) return { outcome: 'escalated', previousLevel: existing.level }
    await db
      .prepare(
        'UPDATE board_shares SET level = ? WHERE owner_user_id = ? AND board_id = ? AND grantee_user_id = ?'
      )
      .bind('contributor', ownerId, boardId, granteeUserId)
      .run()
    return { outcome: 'escalated', previousLevel: existing.level }
  }

  if (previewOnly) return { outcome: 'granted' }

  await db
    .prepare(
      `INSERT INTO board_shares (owner_user_id, board_id, grantee_user_id, level, created_at)
         VALUES (?, ?, ?, 'contributor', ?)
       ON CONFLICT(owner_user_id, board_id, grantee_user_id) DO NOTHING`
    )
    .bind(ownerId, boardId, granteeUserId, nowIso())
    .run()
  return { outcome: 'granted' }
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
