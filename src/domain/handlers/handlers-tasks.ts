/** Task writes: create, update, the complete/reopen toggle, and soft delete. */
import type { Storage } from '../../server/storage.js'
import type { AuthContext, Task, CreateTaskInput, UpdateTaskInput, ULID } from '../types.js'
import { assertNotesWithinLimit } from '../types.js'
import { generateULID } from '../utils/shared.js'
import { normalizeTag } from '../utils/tags.js'
import { utcDayFromISO } from '../utils/calendar.js'
import { findTaskOrThrow, closeTask, reopenTask, withTaskOperation } from './handlers-utils.js'

/**
 * Create a new task (board-scoped storage)
 * Public users cannot create tasks
 */
export async function createTask(
  storage: Storage,
  auth: AuthContext,
  input: CreateTaskInput,
  boardId: string = 'main',
  expectedVersion?: number
): Promise<{ ok: true; id: ULID }> {
  assertNotesWithinLimit(input.notes)
  return withTaskOperation(
    storage,
    auth,
    boardId,
    (tasks, _stats, timestamp) => {
      // Use client-provided ID if available, otherwise generate server-side
      const id = input.id || generateULID()
      // Use client-provided createdAt if available (for preserving during moves), otherwise use current timestamp
      const createdAt = input.createdAt || timestamp

      // `date` is the canonical calendar-day key, persisted as the UTC day so it
      // is consistent everywhere. Trust an explicit value (all-day picks send the
      // chosen day), else derive the UTC day from startTime. Display recomputes
      // the local day from startTime, so this stored value is never shown directly.
      const date = input.date ?? utcDayFromISO(input.startTime)

      const newTask: Task = {
        id,
        title: input.title,
        notes: input.notes ?? null,
        // One tag per task is an invariant, not a UI convention: MCP, the REST
        // API and the app all land here, so the collapse happens here too.
        tag: normalizeTag(input.tag),
        state: 'Active',
        createdAt,
        // Creation IS the first mutation: stamp updatedAt so the change feed (§4.4),
        // which keys on updated_at, surfaces new tasks — not just later edits.
        updatedAt: timestamp,
        date,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        source: input.source ?? null,
        sourceId: input.sourceId ?? null,
        metadata: input.metadata ?? null
      }

      return {
        updatedTasks: {
          ...tasks,
          tasks: [newTask, ...tasks.tasks],
          updatedAt: timestamp
        },
        statsEvents: [{ task: newTask, eventType: 'created' }],
        result: { ok: true, id }
      }
    },
    expectedVersion
  )
}

/**
 * Update an existing task (board-scoped storage)
 * Public users cannot update tasks
 */
export async function updateTask(
  storage: Storage,
  auth: AuthContext,
  taskId: ULID,
  input: UpdateTaskInput,
  boardId: string = 'main',
  expectedVersion?: number
): Promise<{ ok: true; message: string }> {
  assertNotesWithinLimit(input.notes)
  return withTaskOperation(
    storage,
    auth,
    boardId,
    (tasks, stats, timestamp) => {
      const { task, index: taskIndex } = findTaskOrThrow(tasks, taskId, boardId)

      const updatedTask: Task = {
        ...task,
        ...input,
        updatedAt: timestamp
      }

      // A write that touches the tag collapses it to one (see createTask). An
      // untouched tag is left exactly as stored.
      if (input.tag !== undefined) updatedTask.tag = normalizeTag(input.tag)

      // Keep `date` consistent with a (re)scheduled startTime unless the caller set
      // it explicitly — covers drag-to-reschedule and timed/all-day conversions.
      // Stored as the UTC day (display recomputes the local day from startTime).
      if (input.date === undefined && input.startTime !== undefined) {
        updatedTask.date = utcDayFromISO(input.startTime)
      }

      const newTasks = [...tasks.tasks]
      newTasks[taskIndex] = updatedTask

      return {
        updatedTasks: {
          ...tasks,
          tasks: newTasks,
          updatedAt: timestamp
        },
        statsEvents: [{ task: updatedTask, eventType: 'edited' }],
        result: { ok: true, message: `Task ${taskId} updated` }
      }
    },
    expectedVersion
  )
}

/**
 * Complete a task - board-scoped storage.
 *
 * The task is NOT removed: it stays on the board struck through until its grace
 * window elapses (lifecycle.ts), then falls out of view on its own. Completing
 * an already-completed task reopens it — the ✓ is a toggle.
 * Public users cannot complete tasks.
 */
export async function completeTask(
  storage: Storage,
  auth: AuthContext,
  taskId: ULID,
  boardId: string = 'main',
  expectedVersion?: number
): Promise<{ ok: true; message: string; state: 'Active' | 'Completed' }> {
  // Pinned, not inferred: the two branches return different literal states, and
  // inference would fix T to whichever it saw first and reject the other.
  return withTaskOperation<{ ok: true; message: string; state: 'Active' | 'Completed' }>(
    storage,
    auth,
    boardId,
    (tasks, stats, timestamp) => {
      const { task: current } = findTaskOrThrow(tasks, taskId, boardId)

      if (current.state === 'Completed') {
        const { updatedTasks, reopenedTask } = reopenTask(tasks, taskId, timestamp)
        return {
          updatedTasks,
          statsEvents: [{ task: reopenedTask, eventType: 'uncompleted' as const }],
          result: {
            ok: true,
            message: `Task ${taskId} reopened`,
            state: 'Active' as const
          }
        }
      }

      const { updatedTasks, closedTask } = closeTask(tasks, taskId, 'Completed', timestamp, boardId)
      return {
        updatedTasks,
        statsEvents: [{ task: closedTask, eventType: 'completed' as const }],
        result: {
          ok: true,
          message: `Task ${taskId} completed`,
          state: 'Completed' as const
        }
      }
    },
    expectedVersion
  )
}

/**
 * Delete a task - board-scoped storage.
 *
 * A SOFT delete: the task leaves view immediately (unlike completing, there is
 * no grace window) but the record is retained as state='Deleted' so history and
 * the §4.4 change feed stay intact. The × on a completed task lands here too,
 * which is how you dismiss one before its window elapses.
 */
export async function deleteTask(
  storage: Storage,
  auth: AuthContext,
  taskId: ULID,
  boardId: string = 'main',
  expectedVersion?: number
): Promise<{ ok: true; message: string }> {
  return withTaskOperation(
    storage,
    auth,
    boardId,
    (tasks, stats, timestamp) => {
      const { updatedTasks, closedTask } = closeTask(tasks, taskId, 'Deleted', timestamp, boardId)

      return {
        updatedTasks,
        statsEvents: [{ task: closedTask, eventType: 'deleted' }],
        result: { ok: true, message: `Task ${taskId} deleted` }
      }
    },
    expectedVersion
  )
}
