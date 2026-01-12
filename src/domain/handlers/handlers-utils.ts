/**
 * Helper utilities for handlers.ts
 * Extracted common patterns to reduce duplication and improve consistency
 *
 * NOTE: No auth checks here - handlers are pure business logic.
 * Auth should be enforced at the API boundary (express routes), not in handlers.
 */

import type { Task, TasksFile, StatsFile, Board, BoardsFile, ULID, AuthContext } from '../types.js'
import type { Storage } from '../../server/storage.js'

/**
 * Find task by ID or throw error
 * @throws Error if task not found
 * @returns Task and its index in the tasks array
 */
export function findTaskOrThrow(tasks: TasksFile, taskId: ULID): { task: Task; index: number } {
  const index = tasks.tasks.findIndex(t => t.id === taskId)
  if (index < 0) {
    throw new Error('Task not found')
  }
  return { task: tasks.tasks[index], index }
}

/**
 * Find board by ID or throw error
 * @throws Error if board not found
 * @returns Board and its index in the boards array
 */
export function findBoardOrThrow(
  boards: BoardsFile,
  boardId: string
): { board: Board; index: number } {
  const index = boards.boards.findIndex(b => b.id === boardId)
  if (index < 0) {
    throw new Error(`Board ${boardId} not found`)
  }
  return { board: boards.boards[index], index }
}

/**
 * Update a board at specific index immutably
 * Creates a new BoardsFile with the updated board at the specified index
 */
export function updateBoardAtIndex(
  boards: BoardsFile,
  boardIndex: number,
  updatedBoard: Board,
  timestamp: string
): BoardsFile {
  return {
    ...boards,
    updatedAt: timestamp,
    boards: [
      ...boards.boards.slice(0, boardIndex),
      updatedBoard,
      ...boards.boards.slice(boardIndex + 1)
    ]
  }
}

/**
 * Record a stats event (creation, completion, update, or deletion)
 * Consolidates the 4 separate recordXXX functions into one
 * @param stats - Current stats file
 * @param task - Task being recorded
 * @param eventType - Type of event ('created' | 'completed' | 'edited' | 'deleted')
 * @param timestamp - ISO timestamp string
 * @returns Updated StatsFile
 */
export function recordStatsEvent(
  stats: StatsFile,
  task: Task,
  eventType: 'created' | 'completed' | 'edited' | 'deleted',
  timestamp: string
): StatsFile {
  return {
    ...stats,
    updatedAt: timestamp,
    counters: {
      ...stats.counters,
      [eventType]: stats.counters[eventType] + 1
    },
    timeline: [...stats.timeline, { t: timestamp, event: eventType, id: task.id }],
    tasks: {
      ...stats.tasks,
      [task.id]: { ...task }
    }
  }
}

// --- Batch Operation Helpers ---

/**
 * Extract tasks from a board by IDs
 * Returns the tasks to extract and the remaining tasks
 */
export function extractTasksFromBoard(
  tasks: Task[],
  taskIds: string[]
): { tasksToExtract: Task[]; remainingTasks: Task[] } {
  const tasksToExtract = tasks.filter(task => taskIds.includes(task.id))
  const remainingTasks = tasks.filter(task => !taskIds.includes(task.id))
  return { tasksToExtract, remainingTasks }
}

/**
 * Prepare tasks for insertion into target board
 * Preserves IDs, title, tags, and createdAt timestamp
 */
export function prepareTasksForBoard(tasks: Task[], timestamp: string): Task[] {
  return tasks.map(task => ({
    id: task.id,
    title: task.title,
    tag: task.tag,
    state: 'Active' as const,
    createdAt: task.createdAt,
    updatedAt: timestamp
  }))
}

/**
 * Update stats for batch move operation
 * Records completions on source and creations on target
 */
export function updateBatchMoveStats(
  sourceStats: StatsFile,
  targetStats: StatsFile,
  movedTasks: Task[],
  preparedTasks: Task[],
  timestamp: string
): { updatedSourceStats: StatsFile; updatedTargetStats: StatsFile } {
  let updatedSourceStats = sourceStats
  let updatedTargetStats = targetStats

  // Record completions on source board
  for (const task of movedTasks) {
    const completedTask: Task = {
      ...task,
      state: 'Completed',
      closedAt: timestamp,
      updatedAt: timestamp
    }
    updatedSourceStats = recordStatsEvent(updatedSourceStats, completedTask, 'completed', timestamp)
  }

  // Record creations on target board
  for (const task of preparedTasks) {
    updatedTargetStats = recordStatsEvent(updatedTargetStats, task, 'created', timestamp)
  }

  return { updatedSourceStats, updatedTargetStats }
}

// --- Task Operation Pattern Helper ---

/**
 * Helper for closing tasks (completing or deleting)
 * Consolidates the duplicate logic between completeTask and deleteTask
 */
export function closeTask(
  tasks: TasksFile,
  taskId: string,
  state: 'Completed' | 'Deleted',
  timestamp: string
): {
  updatedTasks: TasksFile
  closedTask: Task
} {
  const { task, index: taskIndex } = findTaskOrThrow(tasks, taskId)

  const closedTask: Task = {
    ...task,
    state,
    closedAt: timestamp,
    updatedAt: timestamp
  }

  const newTasks = [...tasks.tasks]
  newTasks.splice(taskIndex, 1) // Remove from active tasks

  return {
    updatedTasks: {
      ...tasks,
      tasks: newTasks,
      updatedAt: timestamp
    },
    closedTask
  }
}

/**
 * Generic wrapper for task operations that follow the load→modify→save pattern
 * Handles loading tasks/stats, applying transformation, updating stats, and saving
 *
 * @param storage - Storage instance
 * @param auth - Auth context
 * @param boardId - Board ID
 * @param operation - Function that transforms tasks and returns result + stat event info
 * @returns Result from the operation
 */
export async function withTaskOperation<T>(
  storage: Storage,
  auth: AuthContext,
  boardId: string,
  operation: (
    tasks: TasksFile,
    stats: StatsFile,
    timestamp: string
  ) => {
    updatedTasks: TasksFile
    statsEvents: Array<{ task: Task; eventType: 'created' | 'completed' | 'edited' | 'deleted' }>
    result: T
  }
): Promise<T> {
  const timestamp = new Date().toISOString()

  // Load current state
  const [tasks, stats] = await Promise.all([
    storage.getTasks(auth.userType, auth.sessionId, boardId),
    storage.getStats(auth.userType, auth.sessionId, boardId)
  ])

  // Execute operation
  const { updatedTasks, statsEvents, result } = operation(tasks, stats, timestamp)

  // Update stats with all events
  let updatedStats = stats
  for (const { task, eventType } of statsEvents) {
    updatedStats = recordStatsEvent(updatedStats, task, eventType, timestamp)
  }

  // Save both files
  await Promise.all([
    storage.saveTasks(auth.userType, auth.sessionId, boardId, updatedTasks),
    storage.saveStats(auth.userType, auth.sessionId, boardId, updatedStats)
  ])

  return result
}

// --- Board Operation Pattern Helper ---

/**
 * Generic wrapper for board operations that follow the load→modify→save pattern
 * Handles loading boards, applying transformation, and saving
 *
 * @param storage - Storage instance
 * @param auth - Auth context
 * @param operation - Function that transforms boards and returns result
 * @returns Result from the operation
 */
export async function withBoardOperation<T>(
  storage: Storage,
  auth: AuthContext,
  operation: (
    boards: BoardsFile,
    timestamp: string
  ) => {
    updatedBoards: BoardsFile
    result: T
  }
): Promise<T> {
  const timestamp = new Date().toISOString()

  // Load current boards
  const boards = await storage.getBoards(auth.userType, auth.sessionId)

  // Execute operation
  const { updatedBoards, result } = operation(boards, timestamp)

  // Save updated boards
  await storage.saveBoards(auth.userType, updatedBoards, auth.sessionId)

  return result
}

/**
 * Helper to modify board tags
 * Consolidates common logic for tag operations (add/remove)
 */
export function modifyBoardTags(
  boards: BoardsFile,
  boardId: string,
  tagOperation: (existingTags: string[], tag: string) => string[],
  tag: string,
  timestamp: string
): { updatedBoards: BoardsFile; board: Board } {
  const { board, index: boardIndex } = findBoardOrThrow(boards, boardId)
  const existingTags = board.tags || []
  const updatedTags = tagOperation(existingTags, tag)

  const updatedBoard = {
    ...board,
    tags: updatedTags
  }

  return {
    updatedBoards: updateBoardAtIndex(boards, boardIndex, updatedBoard, timestamp),
    board: updatedBoard
  }
}
