/**
 * Read handlers: the board list, a board's visible tasks, its stats, and the
 * calendar view over them.
 *
 * None of these write. `boardCalendar` does not even read storage — a board's
 * calendar IS its dated tasks — which is why the worker re-runs it after
 * re-hydrating a shared board's tasks from the owner's scope.
 */
import type { Storage } from '../../server/storage.js'
import type { AuthContext, Task, StatsFile, Board, BoardCalendar, BoardsFile } from '../types.js'
import { calendarTasks, type CalendarQuery } from '../utils/calendar.js'
import { isVisible } from '../utils/lifecycle.js'
import { backfillTaskDate } from './handlers-utils.js'

/**
 * Describe a board's calendar (§9) from its already-loaded visible tasks.
 *
 * The calendar is not a separate collection — it IS the board's dated tasks — so
 * this never reads storage. Callers that re-hydrate `tasks` after the fact (the
 * worker does, for boards shared with the viewer, because task rows live in the
 * OWNER's scope) must re-run this so `scheduled` describes the tasks actually
 * returned.
 */
export function boardCalendar(board: Board): BoardCalendar {
  return {
    // `board.id` is already the reference this caller must address the board by:
    // its own slug, or — for a board shared with them — the globally-unique
    // handle. That is exactly what a calendar write has to be pointed at.
    ref: board.id,
    name: board.name,
    canWrite: (board.access ?? 'owner') !== 'readonly',
    scheduled: calendarTasks(board.tasks ?? []).length
  }
}

/**
 * One board's calendar: its dated tasks, narrowed to a day window and/or a
 * provider `source`, ordered by day then start time.
 *
 * The board-scoped read an integrator needs to reconcile what it mirrored —
 * "what is already on this calendar between these days, from me?" — without
 * pulling the whole board and filtering client-side. Access is resolved by the
 * caller (the route), so a grantee reads the owner's calendar here exactly as
 * the owner does.
 */
export async function getBoardCalendar(
  storage: Storage,
  auth: AuthContext,
  boardId: string,
  query: CalendarQuery = {}
): Promise<{
  board: string
  from: string | null
  to: string | null
  /** Everything on the calendar, ignoring the query — the window's denominator. */
  scheduled: number
  tasks: Task[]
}> {
  const tasks = await getBoardTasks(storage, auth, boardId)
  return {
    board: boardId,
    from: query.from ?? null,
    to: query.to ?? null,
    scheduled: calendarTasks(tasks).length,
    tasks: calendarTasks(tasks, query)
  }
}

/**
 * Get all boards for a user
 * Supports multi-board structure with tasks organized by board
 * Public users get in-memory boards (for testing/development)
 */
export async function getBoards(storage: Storage, auth: AuthContext): Promise<BoardsFile> {
  // Get board metadata (id, name, tags only in board-scoped architecture)
  const boardsFile = await storage.getBoards(auth.userType, auth.sessionId)

  // Populate each board with its tasks and stats from separate storage
  const populatedBoards = await Promise.all(
    boardsFile.boards.map(async board => {
      // Fetch tasks for this board
      const tasksFile = await storage.getTasks(auth.userType, auth.sessionId, board.id)
      // Fetch stats for this board
      const statsFile = await storage.getStats(auth.userType, auth.sessionId, board.id)

      const populated = {
        ...board,
        // isVisible drops Deleted rows and Completed ones past their window. The
        // D1 adapter has already filtered in SQL so this is a no-op there; the
        // localStorage adapter is a dumb blob read, and this is where its window
        // gets applied. It must NOT move into that adapter's getTasks: its
        // saveTasks overwrites the whole blob, so a filtered read would make the
        // next read-modify-write erase everything it filtered out.
        tasks: tasksFile.tasks.filter(t => isVisible(t)).map(backfillTaskDate),
        stats: statsFile
      }
      // The board's calendar travels WITH the board (§9), so a client never has
      // to infer which calendar it is looking at.
      return { ...populated, calendar: boardCalendar(populated) }
    })
  )

  // Order pinned boards first, by their position, then leave the rest in storage
  // order. The D1 backend already sorts this way in SQL; the KV/localStorage
  // backend returns raw insertion order, so normalise here to keep both paths —
  // and the top bar / Edit Boards modal — consistent. Array.sort is stable, so
  // unpinned boards keep their existing relative order.
  const orderedBoards = [...populatedBoards].sort((a, b) => {
    const ap = a.pinned ? 0 : 1
    const bp = b.pinned ? 0 : 1
    if (ap !== bp) return ap - bp
    if (a.pinned && b.pinned) return (a.position ?? 0) - (b.position ?? 0)
    return 0
  })

  return {
    ...boardsFile,
    boards: orderedBoards
  }
}

/**
 * Get tasks for a specific board (board-scoped storage)
 */
export async function getBoardTasks(
  storage: Storage,
  auth: AuthContext,
  boardId: string
): Promise<Task[]> {
  const tasks = await storage.getTasks(auth.userType, auth.sessionId, boardId)
  return tasks.tasks.filter(t => isVisible(t)).map(backfillTaskDate)
}

/**
 * Get stats for a specific board (board-scoped storage)
 */
export async function getBoardStats(
  storage: Storage,
  auth: AuthContext,
  boardId: string
): Promise<StatsFile> {
  const stats = await storage.getStats(auth.userType, auth.sessionId, boardId)
  return stats
}
