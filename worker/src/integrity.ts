/**
 * Data integrity (#109): rows no route can reach.
 *
 * A task with no board is invisible to its owner (every read goes through a
 * board) and still holds a `source` uniqueness slot; a row owned by the 'public'
 * sentinel belongs to no account, so no account erase removes it. Both should
 * always be zero — the writes delete a board with its tasks in one batch, and
 * storage-access.ts refuses callers without an identity — so nonzero means a
 * path regressed.
 *
 * Two callers: GET /task/api/admin/orphans (look on demand) and
 * `checkIntegrity`, which the host's daily cron runs and reports into the
 * fleet's job log. A throw there is a FAILED job, which pages — that is the
 * whole point of scheduling it: nobody runs an admin GET unprompted.
 *
 * Builds no schema, so root may import it statically (cold-start-verify).
 */
import { DEFAULT_SESSION_ID } from './constants'

export interface OrphanRow {
  userId: string
  boardId: string
  taskId: string
  createdAt: string
}

export interface OrphanReport {
  orphanTasks: number
  /** Up to 50, oldest first — enough to act on. */
  sample: OrphanRow[]
  sentinelRows: number
}

interface IntegrityD1 {
  prepare(sql: string): {
    bind(...a: unknown[]): {
      all<T>(): Promise<{ results: T[] }>
      first<T>(): Promise<T | null>
    }
  }
}

const ORPHANS = `FROM tasks t LEFT JOIN boards b ON b.user_id = t.user_id AND b.id = t.board_id
                 WHERE b.id IS NULL`

export async function countOrphans(db: IntegrityD1): Promise<OrphanReport> {
  const [count, sample, sentinel] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n ${ORPHANS}`).bind().first<{ n: number }>(),
    db
      .prepare(
        `SELECT t.user_id AS userId, t.board_id AS boardId, t.id AS taskId, t.created_at AS createdAt
           ${ORPHANS} ORDER BY t.created_at LIMIT 50`
      )
      .bind()
      .all<OrphanRow>(),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM boards WHERE user_id = ?1)
              + (SELECT COUNT(*) FROM board_meta WHERE user_id = ?1)
              + (SELECT COUNT(*) FROM board_prefs WHERE user_id = ?1)
              + (SELECT COUNT(*) FROM tasks WHERE user_id = ?1) AS n`
      )
      .bind(DEFAULT_SESSION_ID)
      .first<{ n: number }>()
  ])
  return {
    orphanTasks: count?.n ?? 0,
    sample: sample.results,
    sentinelRows: sentinel?.n ?? 0
  }
}

/**
 * The scheduled check. Resolves with the (clean) report; THROWS when either
 * count is nonzero, naming the counts and the oldest orphans, so the job record
 * carries what to act on. Wire it as
 * `jobs.tracked('task-api:integrity', () => checkIntegrity(env))`.
 */
export async function checkIntegrity(env: { DB?: unknown }): Promise<OrphanReport> {
  if (!env.DB) throw new Error('task-api integrity: no DB binding')
  const report = await countOrphans(env.DB as IntegrityD1)
  if (report.orphanTasks === 0 && report.sentinelRows === 0) return report
  const named = report.sample
    .slice(0, 5)
    .map(r => `${r.userId}/${r.boardId}/${r.taskId}`)
    .join(', ')
  throw new Error(
    `task-api integrity: ${report.orphanTasks} task(s) with no board` +
      (named ? ` (oldest: ${named})` : '') +
      `, ${report.sentinelRows} row(s) owned by '${DEFAULT_SESSION_ID}'. ` +
      'See GET /task/api/admin/orphans.'
  )
}
