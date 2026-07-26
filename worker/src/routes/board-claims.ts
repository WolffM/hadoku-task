/**
 * Agent claim protocol (§4) — atomic claim / heartbeat / set-lane / release,
 * plus the change feed (§4.4).
 *
 * D1-direct, like board-sharing.ts / board-automation.ts. The claim is a single
 * conditional upsert on task_claims (PK user_id+task_id): its meta.changes IS
 * the CAS result — 1 you won, 0 a live lease exists. A live lease is never taken
 * from a working agent; only an EXPIRED one is stealable, without a sweeper.
 *
 * set-lane / release are the AGENT path (§5.2): they may write an `agent` lane a
 * human can't, but the destination must still be a real lane on the board
 * (LANE_UNKNOWN otherwise). Tokens are opaque + server-minted; expiry is always
 * server-assigned, so a runner's clock can't extend a lease.
 */
import {
  TaskUtils,
  type Lane,
  ClaimHeldError,
  LeaseLostError,
  LaneUnknownError,
  LaneChangedError,
  TaskNotFoundError,
  assertNotesWithinLimit
} from '@wolffm/task/api'

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(col?: string): Promise<T | null>
      run(): Promise<{ meta: { changes: number } }>
      all<T = unknown>(): Promise<{ results: T[] }>
    }
  }
  batch(statements: Array<{ run(): Promise<unknown> }>): Promise<unknown>
}

const DEFAULT_LEASE_SECONDS = 1800 // 30 min
const MAX_LEASE_SECONDS = 3600 // 1 h — a runner heartbeats to hold longer
const nowIso = () => new Date().toISOString()
const newToken = () => TaskUtils.generateULID()

function expiryFrom(now: string, leaseSeconds: number): string {
  const secs = Math.min(
    Math.max(1, Math.floor(leaseSeconds || DEFAULT_LEASE_SECONDS)),
    MAX_LEASE_SECONDS
  )
  return new Date(new Date(now).getTime() + secs * 1000).toISOString()
}

/**
 * Validate an AGENT-path destination lane. On an automation board the lane must
 * exist (LANE_UNKNOWN otherwise); empty ⇒ Inbox, always fine. On a standard
 * board a lane is written as a free tag, unchanged.
 */
function assertAgentLane(mode: string, lanes: Lane[], lane: string | null | undefined): void {
  const t = (lane ?? '').trim()
  if (t === '') return
  if (mode !== 'automation') return
  if (!lanes.some(l => l.tag === t)) throw new LaneUnknownError(t)
}

/** Read a task's current tag (owner scope). Null result ⇒ no active task row. */
async function currentTaskTag(
  db: D1Like,
  ownerId: string,
  boardId: string,
  taskId: string
): Promise<{ tag: string | null } | null> {
  return db
    .prepare(
      `SELECT tag FROM tasks WHERE user_id = ? AND board_id = ? AND id = ? AND state = 'Active' LIMIT 1`
    )
    .bind(ownerId, boardId, taskId)
    .first<{ tag: string | null }>()
}

export interface ClaimHolder {
  agentId: string
  token: string
  expiresAt: string
}

/** The live claim on a task, or null. */
async function liveClaim(
  db: D1Like,
  ownerId: string,
  taskId: string,
  now: string
): Promise<{ agent_id: string; token: string; expires_at: string; live: boolean } | null> {
  const row = await db
    .prepare(
      'SELECT agent_id, token, expires_at FROM task_claims WHERE user_id = ? AND task_id = ? LIMIT 1'
    )
    .bind(ownerId, taskId)
    .first<{ agent_id: string; token: string; expires_at: string }>()
  if (!row) return null
  return { ...row, live: row.expires_at > now }
}

export interface ClaimResult {
  token: string
  agentId: string
  expiresAt: string
  lane: string | null
}

/**
 * Atomically claim a task (§4.1). Wins iff there's no unexpired claim. If `lane`
 * is given, the lane write + a claim-log row land right after the win. Throws
 * ClaimHeldError with the current holder when a live lease exists.
 */
export async function claimTask(
  db: D1Like,
  ownerId: string,
  boardId: string,
  taskId: string,
  agentId: string,
  opts: { lane?: string | null; leaseSeconds?: number; mode: string; lanes: Lane[] }
): Promise<ClaimResult> {
  const task = await currentTaskTag(db, ownerId, boardId, taskId)
  if (!task) throw new TaskNotFoundError(taskId)
  assertAgentLane(opts.mode, opts.lanes, opts.lane)

  const now = nowIso()
  const token = newToken()
  const expiresAt = expiryFrom(now, opts.leaseSeconds ?? DEFAULT_LEASE_SECONDS)

  // The CAS. The WHERE on the conflict branch only ever steals an EXPIRED lease.
  const res = await db
    .prepare(
      `INSERT INTO task_claims (user_id, board_id, task_id, agent_id, token, claimed_at, expires_at, heartbeat_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, task_id) DO UPDATE SET
         agent_id = excluded.agent_id, token = excluded.token, board_id = excluded.board_id,
         claimed_at = excluded.claimed_at, expires_at = excluded.expires_at,
         heartbeat_at = excluded.heartbeat_at
       WHERE task_claims.expires_at < ?`
    )
    .bind(ownerId, boardId, taskId, agentId, token, now, expiresAt, now, now)
    .run()

  if (res.meta.changes === 0) {
    const held = await liveClaim(db, ownerId, taskId, now)
    throw new ClaimHeldError(held?.agent_id ?? 'another agent', held?.expires_at ?? now)
  }

  // Won. Log the attempt, and — if a lane was named — move the task in the same
  // batch so "claimed" and "in the lane" can't disagree.
  const stmts: Array<{ run(): Promise<unknown> }> = [
    db
      .prepare(
        `INSERT INTO task_claim_log (user_id, board_id, task_id, agent_id, claimed_at)
           VALUES (?, ?, ?, ?, ?)`
      )
      .bind(ownerId, boardId, taskId, agentId, now)
  ]
  const lane = (opts.lane ?? '').trim()
  if (lane !== '') {
    stmts.push(
      db
        .prepare(
          `UPDATE tasks SET tag = ?, updated_at = ? WHERE user_id = ? AND board_id = ? AND id = ?`
        )
        .bind(lane, now, ownerId, boardId, taskId)
    )
  }
  await db.batch(stmts)

  return { token, agentId, expiresAt, lane: lane === '' ? task.tag : lane }
}

/** Extend a live lease (§4.2). LEASE_LOST if the token no longer holds it. */
export async function heartbeatClaim(
  db: D1Like,
  ownerId: string,
  taskId: string,
  token: string,
  leaseSeconds: number | undefined
): Promise<{ expiresAt: string }> {
  const now = nowIso()
  const expiresAt = expiryFrom(now, leaseSeconds ?? DEFAULT_LEASE_SECONDS)
  const res = await db
    .prepare(
      `UPDATE task_claims SET expires_at = ?, heartbeat_at = ?
         WHERE user_id = ? AND task_id = ? AND token = ? AND expires_at > ?`
    )
    .bind(expiresAt, now, ownerId, taskId, token, now)
    .run()
  if (res.meta.changes === 0) throw new LeaseLostError()
  return { expiresAt }
}

/** Move a task's lane while holding the claim (§4.2). Agent path. */
export async function setLane(
  db: D1Like,
  ownerId: string,
  boardId: string,
  taskId: string,
  token: string,
  lane: string,
  opts: { mode: string; lanes: Lane[] }
): Promise<{ ok: true; lane: string }> {
  const now = nowIso()
  const claim = await liveClaim(db, ownerId, taskId, now)
  if (!claim || claim.token !== token || !claim.live) throw new LeaseLostError()
  assertAgentLane(opts.mode, opts.lanes, lane)
  const t = (lane ?? '').trim()
  await db
    .prepare(
      `UPDATE tasks SET tag = ?, updated_at = ? WHERE user_id = ? AND board_id = ? AND id = ?`
    )
    .bind(t === '' ? null : t, now, ownerId, boardId, taskId)
    .run()
  return { ok: true, lane: t }
}

export interface ReleaseResult {
  ok: true
  released: boolean
  lane: string | null
  completed?: boolean
}

/**
 * Release a claim (§4.2): move the task to `lane`, write `notes`, drop the claim,
 * close the log. Idempotent on token — a replay after the claim is gone is a
 * no-op success. LEASE_LOST if a DIFFERENT agent now holds it; LANE_CHANGED if
 * the optional `ifCurrentLane` guard doesn't match (a human retagged mid-claim).
 */
export async function releaseClaim(
  db: D1Like,
  ownerId: string,
  boardId: string,
  taskId: string,
  token: string,
  opts: {
    lane?: string | null
    notes?: string | null
    outcome?: string | null
    ifCurrentLane?: string
    // Merge into the task's metadata while holding the claim (§6 confirmation 1).
    // The claim is what authorises the write; a non-holder still can't reach here.
    metadata?: Record<string, unknown> | null
    // Archive the task on release (§6 confirmation 3): an agent completing work it
    // was explicitly asked to do. Still claim-gated + audited. Keeps the `landed`
    // notification lane from growing unbounded without a human sweep.
    complete?: boolean
    mode: string
    lanes: Lane[]
  }
): Promise<ReleaseResult> {
  // Reject an oversized plan BEFORE anything is read or written. This is the
  // path that actually receives machine-generated text, so leaving it exempt
  // made the cap decorative — the human path enforced a limit the agent could
  // walk straight past. Checked ahead of the claim lookup because payload
  // validity doesn't depend on claim state, and the agent should get a clean
  // 413 to retry against while it still holds the lease.
  assertNotesWithinLimit(opts.notes)

  const now = nowIso()
  const claim = await liveClaim(db, ownerId, taskId, now)

  // No claim row ⇒ already released/expired-and-cleared. Idempotent no-op.
  if (!claim) return { ok: true, released: false, lane: null }
  // A different token holds it ⇒ our lease was taken. Abort, write nothing.
  if (claim.token !== token) throw new LeaseLostError()

  const task = await currentTaskTag(db, ownerId, boardId, taskId)
  if (!task) {
    // The task was deleted under us; clear the orphan claim and report 404.
    await db
      .prepare('DELETE FROM task_claims WHERE user_id = ? AND task_id = ?')
      .bind(ownerId, taskId)
      .run()
    throw new TaskNotFoundError(taskId)
  }

  if (opts.ifCurrentLane !== undefined) {
    const current = task.tag ?? ''
    if (current !== opts.ifCurrentLane) throw new LaneChangedError(task.tag)
  }

  assertAgentLane(opts.mode, opts.lanes, opts.lane)
  const lane = (opts.lane ?? '').trim()

  const stmts: Array<{ run(): Promise<unknown> }> = []
  // Build the task UPDATE from exactly the fields the runner is writing: tag
  // (the lane), optional notes, optional metadata merge, and completion.
  const sets: string[] = ['tag = ?', 'updated_at = ?']
  const binds: unknown[] = [lane === '' ? null : lane, now]
  if (opts.notes !== undefined) {
    sets.push('notes = ?')
    binds.push(opts.notes)
  }
  if (opts.metadata !== undefined) {
    sets.push('metadata = ?')
    binds.push(opts.metadata === null ? null : JSON.stringify(opts.metadata))
  }
  if (opts.complete) {
    sets.push("state = 'Completed'", 'closed_at = ?')
    binds.push(now)
  }
  stmts.push(
    db
      .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE user_id = ? AND board_id = ? AND id = ?`)
      .bind(...binds, ownerId, boardId, taskId)
  )
  // Close the most recent open log row for this task.
  stmts.push(
    db
      .prepare(
        `UPDATE task_claim_log SET ended_at = ?, ended_by = 'release', outcome = ?
           WHERE id = (SELECT id FROM task_claim_log
                        WHERE user_id = ? AND task_id = ? AND ended_at IS NULL
                        ORDER BY id DESC LIMIT 1)`
      )
      .bind(now, opts.outcome ?? null, ownerId, taskId)
  )
  // Drop the claim.
  stmts.push(
    db.prepare('DELETE FROM task_claims WHERE user_id = ? AND task_id = ?').bind(ownerId, taskId)
  )

  await db.batch(stmts)
  return {
    ok: true,
    released: true,
    lane: lane === '' ? null : lane,
    completed: opts.complete === true
  }
}

/**
 * Force-drop the claim on a task (§ cancel path). The board owner reclaims a
 * stuck/held task by hand: the claim row is deleted and its log row closed with
 * ended_by='cancel'. The holding agent's next heartbeat/set-lane then sees no
 * live claim → LEASE_LOST, and aborts. Returns whether a claim was actually
 * dropped (idempotent: no live claim ⇒ dropped:false).
 */
export async function cancelClaim(
  db: D1Like,
  ownerId: string,
  taskId: string
): Promise<{ ok: true; dropped: boolean }> {
  const now = nowIso()
  const res = await db
    .prepare('DELETE FROM task_claims WHERE user_id = ? AND task_id = ?')
    .bind(ownerId, taskId)
    .run()
  if (res.meta.changes > 0) {
    await db
      .prepare(
        `UPDATE task_claim_log SET ended_at = ?, ended_by = 'cancel'
           WHERE id = (SELECT id FROM task_claim_log
                        WHERE user_id = ? AND task_id = ? AND ended_at IS NULL
                        ORDER BY id DESC LIMIT 1)`
      )
      .bind(now, ownerId, taskId)
      .run()
  }
  return { ok: true, dropped: res.meta.changes > 0 }
}

/** The set of task ids on a board that currently hold a LIVE claim. */
export async function liveClaimedTaskIds(
  db: D1Like,
  ownerId: string,
  boardId: string
): Promise<Set<string>> {
  const now = nowIso()
  const { results } = await db
    .prepare(
      `SELECT task_id FROM task_claims WHERE user_id = ? AND board_id = ? AND expires_at > ?`
    )
    .bind(ownerId, boardId, now)
    .all<{ task_id: string }>()
  return new Set(results.map(r => r.task_id))
}

export interface ClaimLogRow {
  agentId: string
  claimedAt: string
  endedAt: string | null
  endedBy: string | null
  outcome: string | null
}

/** Claim history for a task, newest first (§5.7). */
export async function getClaimHistory(
  db: D1Like,
  ownerId: string,
  taskId: string
): Promise<ClaimLogRow[]> {
  const { results } = await db
    .prepare(
      `SELECT agent_id AS agentId, claimed_at AS claimedAt, ended_at AS endedAt,
              ended_by AS endedBy, outcome
         FROM task_claim_log WHERE user_id = ? AND task_id = ? ORDER BY id DESC`
    )
    .bind(ownerId, taskId)
    .all<ClaimLogRow>()
  return results
}

export interface ChangeRow {
  id: string
  boardId: string
  tag: string | null
  state: string
  updatedAt: string
}

/**
 * The change feed (§4.4): tasks whose (updated_at, id) sort after the cursor.
 * Zero extra writes — it reads the updated_at every mutation already sets.
 * Deletes appear as rows with state='Deleted'. Scoped to the caller's own data.
 */
export async function getChanges(
  db: D1Like,
  ownerId: string,
  cursor: { updatedAt: string; id: string } | null,
  limit: number
): Promise<{ changes: ChangeRow[]; cursor: string | null }> {
  const lim = Math.min(Math.max(1, limit || 100), 500)
  const cu = cursor?.updatedAt ?? ''
  const ci = cursor?.id ?? ''
  const { results } = await db
    .prepare(
      `SELECT id, board_id AS boardId, tag, state, updated_at AS updatedAt
         FROM tasks
        WHERE user_id = ? AND updated_at IS NOT NULL
          AND (updated_at > ? OR (updated_at = ? AND id > ?))
        ORDER BY updated_at, id
        LIMIT ?`
    )
    .bind(ownerId, cu, cu, ci, lim)
    .all<ChangeRow>()
  const last = results[results.length - 1]
  const next = last ? `${last.updatedAt},${last.id}` : cursor ? `${cu},${ci}` : null
  return { changes: results, cursor: next }
}
