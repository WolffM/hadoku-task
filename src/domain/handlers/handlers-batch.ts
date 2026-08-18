/**
 * Batch writes — one read-modify-write cycle per request rather than one per
 * task, which is what keeps a multi-card gesture from racing itself.
 *
 * batchMoveTasks spans two boards and therefore goes through
 * `storage.batchSaveTasks`, which is atomic on D1: a move that empties the
 * source and fills the target can no longer half-apply.
 */
import type { Storage } from '../../server/storage.js'
import type { AuthContext, TasksFile } from '../types.js'
import { now } from '../utils/shared.js'
import { splitTags, normalizeTag } from '../utils/tags.js'
import {
  extractTasksFromBoard,
  prepareTasksForBoard,
  updateBatchMoveStats,
  withTaskOperation,
  withBoardOperation,
  modifyBoardTags
} from './handlers-utils.js'

/**
 * Batch update tags on multiple tasks (board-scoped storage)
 * Performs a single read-modify-write cycle to avoid race conditions
 */
export async function batchUpdateTags(
  storage: Storage,
  auth: AuthContext,
  input: {
    boardId: string
    updates: Array<{ taskId: string; tag: string | null }>
  }
): Promise<{ ok: true; message: string; updated: number }> {
  return withTaskOperation(storage, auth, input.boardId, (tasks, stats, timestamp) => {
    // Apply all updates in one pass
    let updatedCount = 0
    const updatedTasksList = tasks.tasks.map(task => {
      const update = input.updates.find(u => u.taskId === task.id)
      if (update) {
        updatedCount++
        return {
          ...task,
          tag: normalizeTag(update.tag) ?? undefined,
          updatedAt: timestamp
        }
      }
      return task
    })

    const updatedTasksFile: TasksFile = {
      ...tasks,
      tasks: updatedTasksList,
      updatedAt: timestamp
    }

    // Collect all edited tasks for stats
    const statsEvents = updatedTasksList
      .filter(task => input.updates.find(u => u.taskId === task.id))
      .map(task => ({ task, eventType: 'edited' as const }))

    return {
      updatedTasks: updatedTasksFile,
      statsEvents,
      result: {
        ok: true,
        message: `Updated ${updatedCount} task(s) on board ${input.boardId}`,
        updated: updatedCount
      }
    }
  })
}

/**
 * Batch move tasks from one board to another (board-scoped storage)
 * Performs read-modify-write on both boards to avoid race conditions
 * Note: Preserves task IDs and createdAt timestamps across board moves
 * Moving tasks = completing them on source board + creating them on target board (with same IDs)
 */
export async function batchMoveTasks(
  storage: Storage,
  auth: AuthContext,
  input: {
    sourceBoardId: string
    targetBoardId: string
    taskIds: string[]
  }
): Promise<{ ok: true; message: string; moved: number }> {
  const timestamp = now()

  // Load source and target board data
  const [sourceTasks, sourceStats, targetTasks, targetStats] = await Promise.all([
    storage.getTasks(auth.userType, auth.sessionId, input.sourceBoardId),
    storage.getStats(auth.userType, auth.sessionId, input.sourceBoardId),
    storage.getTasks(auth.userType, auth.sessionId, input.targetBoardId),
    storage.getStats(auth.userType, auth.sessionId, input.targetBoardId)
  ])

  // Extract tasks to move from source board
  const { tasksToExtract: tasksToMove, remainingTasks } = extractTasksFromBoard(
    sourceTasks.tasks,
    input.taskIds
  )

  if (tasksToMove.length === 0) {
    return { ok: true, message: 'No tasks to move', moved: 0 }
  }

  // Prepare tasks for target board (preserves IDs, timestamps, etc.)
  const preparedTasks = prepareTasksForBoard(tasksToMove, timestamp)

  // Update task files
  const updatedSourceTasksFile: TasksFile = {
    ...sourceTasks,
    tasks: remainingTasks,
    updatedAt: timestamp
  }

  const updatedTargetTasksFile: TasksFile = {
    ...targetTasks,
    tasks: [...preparedTasks, ...targetTasks.tasks],
    updatedAt: timestamp
  }

  // Update stats for both boards
  const { updatedSourceStats, updatedTargetStats } = updateBatchMoveStats(
    sourceStats,
    targetStats,
    tasksToMove,
    preparedTasks,
    timestamp
  )

  // Move the task rows for BOTH boards in one atomic write. On D1 this is a
  // single db.batch(): the source can never be emptied without the target being
  // filled in the same transaction (the §2.5 lost-update gap). Stats are
  // append-only event logs, written separately (a dropped analytics event is not
  // data loss, and there is no cross-key transaction for them anyway).
  await storage.batchSaveTasks(auth.userType, auth.sessionId, [
    { boardId: input.sourceBoardId, tasks: updatedSourceTasksFile },
    { boardId: input.targetBoardId, tasks: updatedTargetTasksFile }
  ])
  await Promise.all([
    storage.saveStats(auth.userType, auth.sessionId, input.sourceBoardId, updatedSourceStats),
    storage.saveStats(auth.userType, auth.sessionId, input.targetBoardId, updatedTargetStats)
  ])

  return {
    ok: true,
    message: `Moved ${tasksToMove.length} task(s) from ${input.sourceBoardId} to ${input.targetBoardId}`,
    moved: tasksToMove.length
  }
}

/**
 * Batch clear a tag from multiple tasks and remove the tag from the board (board-scoped storage)
 * Performs a single read-modify-write cycle to avoid race conditions
 */
export async function batchClearTag(
  storage: Storage,
  auth: AuthContext,
  input: {
    boardId: string
    tag: string
    taskIds: string[]
  }
): Promise<{ ok: true; message: string; cleared: number }> {
  // First, clear tag from tasks using task operation pattern
  const taskResult = await withTaskOperation(
    storage,
    auth,
    input.boardId,
    (tasks, stats, timestamp) => {
      // Clear tag from tasks
      let clearedCount = 0
      const updatedTasksList = tasks.tasks.map(task => {
        if (input.taskIds.includes(task.id) && task.tag) {
          const existingTags = splitTags(task.tag)
          const updatedTags = existingTags.filter(t => t !== input.tag)
          clearedCount++
          return {
            ...task,
            tag: updatedTags.length > 0 ? updatedTags.join(' ') : undefined,
            updatedAt: timestamp
          }
        }
        return task
      })

      const updatedTasksFile: TasksFile = {
        ...tasks,
        tasks: updatedTasksList,
        updatedAt: timestamp
      }

      // Collect edited tasks for stats
      const statsEvents = updatedTasksList
        .filter(task => input.taskIds.includes(task.id))
        .map(task => ({ task, eventType: 'edited' as const }))

      return {
        updatedTasks: updatedTasksFile,
        statsEvents,
        result: { clearedCount }
      }
    }
  )

  // Then, remove tag from board metadata using board operation pattern
  await withBoardOperation(storage, auth, (boards, timestamp) => {
    const { updatedBoards } = modifyBoardTags(
      boards,
      input.boardId,
      (tags, tag) => tags.filter(t => t !== tag),
      input.tag,
      timestamp
    )

    return {
      updatedBoards,
      result: { ok: true }
    }
  })

  return {
    ok: true,
    message: `Cleared tag ${input.tag} from ${taskResult.clearedCount} task(s) on board ${input.boardId}`,
    cleared: taskResult.clearedCount
  }
}
