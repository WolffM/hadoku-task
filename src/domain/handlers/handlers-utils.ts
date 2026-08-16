/**
 * Helper utilities for handlers.ts
 * Extracted common patterns to reduce duplication and improve consistency
 *
 * NOTE: No auth checks here - handlers are pure business logic.
 * Auth should be enforced at the API boundary (express routes), not in handlers.
 */

import type {
  Task,
  TasksFile,
  StatsFile,
  StatsEventType,
  Board,
  BoardsFile,
  ULID,
  AuthContext
} from '../types.js'
import { TaskNotFoundError, BoardNotFoundError, VersionConflictError } from '../types.js'
import type { Storage } from '../../server/storage.js'
import { utcDayFromISO } from '../utils/calendar.js'

/**
 * Backfill the canonical `date` (UTC day) for a task that carries a startTime but
 * predates the `date` field. Idempotent — leaves already-dated and unscheduled
 * tasks alone. Applied on read so legacy data normalises without a migration.
 */
export function backfillTaskDate(task: Task): Task {
  if (task.date || !task.startTime) return task
  return { ...task, date: utcDayFromISO(task.startTime) }
}

/**
 * Find task by ID or throw error
 * @throws TaskNotFoundError if task not found (HTTP 404)
 * @returns Task and its index in the tasks array
 */
export function findTaskOrThrow(
  tasks: TasksFile,
  taskId: ULID,
  boardId?: string
): { task: Task; index: number } {
  const index = tasks.tasks.findIndex(t => t.id === taskId)
  if (index < 0) {
    throw new TaskNotFoundError(taskId, boardId)
  }
  return { task: tasks.tasks[index], index }
}

/**
 * Find board by ID or throw error
 * @throws BoardNotFoundError if board not found (HTTP 404)
 * @returns Board and its index in the boards array
 */
export function findBoardOrThrow(
  boards: BoardsFile,
  boardId: string
): { board: Board; index: number } {
  const index = boards.boards.findIndex(b => b.id === boardId)
  if (index < 0) {
    throw new BoardNotFoundError(boardId)
  }
  return { board: boards.boards[index], index }
}

/**
 * Update a board at specific index immutably
 * Creates a new BoardsFile with the updated board at the specified index
 */
function updateBoardAtIndex(
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
function recordStatsEvent(
  stats: StatsFile,
  task: Task,
  eventType: StatsEventType,
  timestamp: string
): StatsFile {
  // `uncompleted` lands on the timeline but decrements `completed` rather than
  // getting a counter of its own, so counters.completed stays the NET number of
  // completions across any number of ✓-toggle flips.
  const counters =
    eventType === 'uncompleted'
      ? { ...stats.counters, completed: Math.max(0, stats.counters.completed - 1) }
      : { ...stats.counters, [eventType]: stats.counters[eventType] + 1 }

  return {
    ...stats,
    updatedAt: timestamp,
    counters,
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
 * Preserves IDs, title, tags, createdAt timestamp, and calendar scheduling
 */
export function prepareTasksForBoard(tasks: Task[], timestamp: string): Task[] {
  return tasks.map(task => ({
    id: task.id,
    title: task.title,
    tag: task.tag,
    state: 'Active' as const,
    createdAt: task.createdAt,
    updatedAt: timestamp,
    date: task.date ?? utcDayFromISO(task.startTime),
    startTime: task.startTime ?? null,
    endTime: task.endTime ?? null,
    source: task.source ?? null,
    sourceId: task.sourceId ?? null,
    metadata: task.metadata ?? null
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
 * Helper for closing tasks (completing or deleting).
 *
 * The task is RETAINED, not spliced out. Completing marks it Completed and it
 * stays on the board — struck through — until its grace window elapses (see
 * `lifecycle.ts`); deleting marks it Deleted and it leaves view immediately.
 * Either way the record survives, which is what makes a retrospective possible
 * and what makes the change feed's `state='Deleted'` rows real instead of
 * theoretical. Visibility is decided on read, never by destroying data here.
 */
export function closeTask(
  tasks: TasksFile,
  taskId: string,
  state: 'Completed' | 'Deleted',
  timestamp: string,
  boardId?: string
): {
  updatedTasks: TasksFile
  closedTask: Task
} {
  const { task, index: taskIndex } = findTaskOrThrow(tasks, taskId, boardId)

  const closedTask: Task = {
    ...task,
    state,
    closedAt: timestamp,
    updatedAt: timestamp
  }

  const newTasks = [...tasks.tasks]
  newTasks[taskIndex] = closedTask

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
 * Reopen a Completed task (the ✓-on-a-completed-task toggle). Clears closedAt so
 * it is unambiguously back in the Active set rather than a Completed task with a
 * stale close time.
 */
export function reopenTask(
  tasks: TasksFile,
  taskId: string,
  timestamp: string
): {
  updatedTasks: TasksFile
  reopenedTask: Task
} {
  const { task, index: taskIndex } = findTaskOrThrow(tasks, taskId)

  const reopenedTask: Task = {
    ...task,
    state: 'Active',
    closedAt: null,
    updatedAt: timestamp
  }

  const newTasks = [...tasks.tasks]
  newTasks[taskIndex] = reopenedTask

  return {
    updatedTasks: {
      ...tasks,
      tasks: newTasks,
      updatedAt: timestamp
    },
    reopenedTask
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
    statsEvents: Array<{ task: Task; eventType: StatsEventType }>
    result: T
  },
  // Optimistic-concurrency guard (L2). When provided, the operation only applies
  // if the stored board version still matches; otherwise it throws
  // VersionConflictError (HTTP 409). Absent ⇒ legacy last-write-wins (unchanged).
  expectedVersion?: number
): Promise<T> {
  const timestamp = new Date().toISOString()

  // Load current state
  const [tasks, stats] = await Promise.all([
    storage.getTasks(auth.userType, auth.sessionId, boardId),
    storage.getStats(auth.userType, auth.sessionId, boardId)
  ])

  // L2 optimistic-concurrency check (only when the client opted in via If-Match)
  const currentVersion = tasks.version ?? 1
  if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
    throw new VersionConflictError(currentVersion)
  }

  // Execute operation
  const { updatedTasks, statsEvents, result } = operation(tasks, stats, timestamp)

  // Bump the monotonic version on every successful write
  const nextVersion = currentVersion + 1
  const versionedTasks: TasksFile = { ...updatedTasks, version: nextVersion }

  // Update stats with all events
  let updatedStats = stats
  for (const { task, eventType } of statsEvents) {
    updatedStats = recordStatsEvent(updatedStats, task, eventType, timestamp)
  }

  // Save both files
  await Promise.all([
    storage.saveTasks(auth.userType, auth.sessionId, boardId, versionedTasks),
    storage.saveStats(auth.userType, auth.sessionId, boardId, updatedStats)
  ])

  // Surface the new version to callers/HTTP layer (additive; legacy clients ignore it)
  if (result !== null && typeof result === 'object') {
    return { ...(result as Record<string, unknown>), version: nextVersion } as T
  }
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
  },
  // Optimistic-concurrency guard on the board COLLECTION, mirroring
  // withTaskOperation. When provided (client sent If-Match), the operation only
  // applies if the stored collection version still matches; otherwise it throws
  // VersionConflictError (HTTP 409). Absent ⇒ last-write-wins (unchanged).
  expectedVersion?: number
): Promise<T> {
  const timestamp = new Date().toISOString()

  // Load current boards
  const boards = await storage.getBoards(auth.userType, auth.sessionId)

  // Optimistic-concurrency check (only when the client opted in via If-Match).
  // This rejects the sequential stale-read case; the storage layer's conditional
  // CAS (D1) additionally rejects the concurrent case using the same version.
  const currentVersion = boards.version ?? 1
  if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
    throw new VersionConflictError(currentVersion)
  }

  // Execute operation
  const { updatedBoards, result } = operation(boards, timestamp)

  // Bump the collection version on every successful write (matches the version
  // the storage layer will persist: expectedVersion + 1 when opted in).
  const nextVersion = currentVersion + 1
  const versionedBoards: BoardsFile = { ...updatedBoards, version: nextVersion }

  // Save updated boards. Pass expectedVersion through so D1 can do the CAS.
  await storage.saveBoards(auth.userType, versionedBoards, auth.sessionId, expectedVersion)

  // Surface the new version to callers/HTTP layer (additive; legacy clients ignore it).
  if (result !== null && typeof result === 'object') {
    return { ...(result as Record<string, unknown>), version: nextVersion } as T
  }
  return result
}

/**
 * Helper to modify board tags
 * Consolidates common logic for tag operations (add/remove)
 *
 * @param boards - Current boards file
 * @param boardId - ID of the board to modify
 * @param tagOperation - Callback function that receives existing tags and a tag, and returns modified tags
 *                       Example: (tags, tag) => [...tags, tag] for adding
 *                       Example: (tags, tag) => tags.filter(t => t !== tag) for removing
 * @param tag - The tag to add or remove
 * @param timestamp - ISO timestamp for the update
 * @param options - Optional configuration
 * @param options.skipIfExists - If true, skip operation and return unchanged boards if tag already exists.
 *                                Only meaningful for add operations; has no effect on remove operations.
 * @returns Object containing updated boards file and whether modification was made
 */
export function modifyBoardTags(
  boards: BoardsFile,
  boardId: string,
  tagOperation: (existingTags: string[], tag: string) => string[],
  tag: string,
  timestamp: string,
  options?: { skipIfExists?: boolean }
): { updatedBoards: BoardsFile; modified: boolean } {
  const { board, index: boardIndex } = findBoardOrThrow(boards, boardId)
  const existingTags = board.tags || []

  // Check if we should skip the operation
  if (options?.skipIfExists && existingTags.includes(tag)) {
    return {
      updatedBoards: boards,
      modified: false
    }
  }

  const updatedTags = tagOperation(existingTags, tag)

  const updatedBoard = {
    ...board,
    tags: updatedTags
  }

  return {
    updatedBoards: updateBoardAtIndex(boards, boardIndex, updatedBoard, timestamp),
    modified: true
  }
}
