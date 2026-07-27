/**
 * Task lifecycle: the single definition of what "still on the board" means.
 *
 * A task has three stored states — Active, Completed, Deleted — and none of them
 * are ever destroyed. "Closed" is NOT a fourth state: it is the name for a
 * Completed task whose grace window has elapsed. Deriving it rather than storing
 * it means no sweeper job, no clock to trust, and no board that keeps showing
 * struck-out tasks because nothing has written to it in a week. The task falls
 * out of view because time passed, which is exactly the intent.
 *
 * The invariant every storage backend must uphold:
 *   getTasks may return a SUBSET of the stored rows;
 *   saveTasks may only delete rows it could have seen.
 * Break the second half and a whole-file write silently destroys history.
 */

import type { Task } from '../types'

/** How long a Completed task stays visible (struck through) before it closes. */
export const COMPLETED_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The ISO instant a task must have been closed AFTER to still be visible.
 * Monotonic, which is what makes the read/write windows safe to compare: a write
 * always computes a cutoff >= the read that preceded it, so the write's window
 * is a subset of the read's and a task can never be missing from the file yet
 * still look deletable.
 */
export function completedCutoff(now: number = Date.now()): string {
  return new Date(now - COMPLETED_WINDOW_MS).toISOString()
}

/** Is this task still on the board? Active always; Completed for its window. */
export function isVisible(task: Task, now: number = Date.now()): boolean {
  if (task.state === 'Active') return true
  if (task.state !== 'Completed') return false
  return !!task.closedAt && task.closedAt > completedCutoff(now)
}

/** Completed and still inside its window — the struck-through-but-present set. */
export function isRecentlyCompleted(task: Task, now: number = Date.now()): boolean {
  return task.state === 'Completed' && isVisible(task, now)
}
