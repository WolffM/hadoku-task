/** Task writes: create, update, the complete/reopen toggle, and soft delete. */
import type { Storage } from '../../server/storage.js'
import type { AuthContext, Task, CreateTaskInput, UpdateTaskInput, ULID } from '../types.js'
import { assertNotesWithinLimit, DuplicateSourceError } from '../types.js'
import { generateULID } from '../utils/shared.js'
import { normalizeTag } from '../utils/tags.js'
import { utcDayFromISO } from '../utils/calendar.js'
import { findTaskOrThrow, closeTask, reopenTask, withTaskOperation } from './handlers-utils.js'

/**
 * Build the stored form of a new task from its create input — the ONE place a
 * create's defaults and derivations live, shared by createTask and createTasks
 * so a batch item becomes exactly the task a single POST would have made.
 */
function newTaskFrom(input: CreateTaskInput, timestamp: string, createdAt: string): Task {
  return {
    // Use client-provided ID if available, otherwise generate server-side
    id: input.id || generateULID(),
    title: input.title,
    notes: input.notes ?? null,
    // One tag per task is an invariant, not a UI convention: MCP, the REST
    // API and the app all land here, so the collapse happens here too.
    tag: normalizeTag(input.tag),
    state: 'Active',
    // Client-provided createdAt is kept (it preserves age across moves).
    createdAt: input.createdAt || createdAt,
    // Creation IS the first mutation: stamp updatedAt so the change feed (§4.4),
    // which keys on updated_at, surfaces new tasks — not just later edits.
    updatedAt: timestamp,
    // `date` is the canonical calendar-day key, persisted as the UTC day so it
    // is consistent everywhere. Trust an explicit value (all-day picks send the
    // chosen day), else derive the UTC day from startTime. Display recomputes
    // the local day from startTime, so this stored value is never shown directly.
    date: input.date ?? utcDayFromISO(input.startTime),
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    source: input.source ?? null,
    sourceId: input.sourceId ?? null,
    metadata: input.metadata ?? null
  }
}

/**
 * Refuse new tasks that would put a second LIVE task on one `source`/`sourceId`
 * pair — against each other, or against an Active task already on this board.
 * The `tasks_source` index spans the user's whole namespace, so a clash on
 * another board is caught by the storage layer instead; this covers the cases
 * that are free to check here, before anything is written.
 */
function assertSourcesFree(newTasks: Task[], existing: Task[]): void {
  // Keyed only when BOTH halves are set: the index treats a NULL sourceId as
  // distinct from every other, so (source, null) never clashes.
  const keyOf = (t: Task) =>
    t.source != null && t.sourceId != null ? `${t.source}\u0000${t.sourceId}` : null
  const held = new Map<string, { id: string; stored: boolean }>()
  for (const t of existing) {
    const key = t.state === 'Active' ? keyOf(t) : null
    if (key) held.set(key, { id: t.id, stored: true })
  }
  for (const t of newTasks) {
    const key = keyOf(t)
    if (!key) continue
    const holder = held.get(key)
    // Re-sending a task under its own id is an upsert of the same row, not a
    // second live task — a retried create must keep succeeding.
    if (holder && !(holder.stored && holder.id === t.id)) {
      throw new DuplicateSourceError(
        t.source as string,
        t.sourceId as string,
        holder.stored ? holder.id : undefined
      )
    }
    held.set(key, { id: t.id, stored: false })
  }
}

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
      const newTask = newTaskFrom(input, timestamp, timestamp)
      assertSourcesFree([newTask], tasks.tasks)

      return {
        updatedTasks: {
          ...tasks,
          tasks: [newTask, ...tasks.tasks],
          updatedAt: timestamp
        },
        statsEvents: [{ task: newTask, eventType: 'created' }],
        result: { ok: true, id: newTask.id }
      }
    },
    expectedVersion
  )
}

/**
 * Create several tasks on one board in ONE read-modify-write — one lock, one
 * board read, one save — instead of a full board rewrite per task.
 *
 * All-or-nothing: every item is checked (notes size, source clashes) before the
 * single save, which is itself atomic, so a bad item writes nothing.
 *
 * The result lands as if the items had been created one after another in
 * request order: an item without its own `createdAt` is stamped 1 ms after the
 * one before it, so age sorting keeps the order the caller sent, and the board
 * file holds them newest-first like successive creates would. `ids` is in
 * request order.
 */
export async function createTasks(
  storage: Storage,
  auth: AuthContext,
  inputs: CreateTaskInput[],
  boardId: string = 'main',
  expectedVersion?: number
): Promise<{ ok: true; ids: ULID[] }> {
  for (const input of inputs) assertNotesWithinLimit(input.notes)
  return withTaskOperation(
    storage,
    auth,
    boardId,
    (tasks, _stats, timestamp) => {
      const base = Date.parse(timestamp)
      const newTasks = inputs.map((input, i) =>
        newTaskFrom(input, timestamp, new Date(base + i).toISOString())
      )
      assertSourcesFree(newTasks, tasks.tasks)

      return {
        updatedTasks: {
          ...tasks,
          tasks: [...newTasks].reverse().concat(tasks.tasks),
          updatedAt: timestamp
        },
        statsEvents: newTasks.map(task => ({ task, eventType: 'created' as const })),
        result: { ok: true, ids: newTasks.map(t => t.id) }
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
