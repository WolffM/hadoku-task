import type { TasksFile, StatsFile, BoardsFile, UserType } from '../domain/types.js'

export interface Storage {
  getTasks(userType: UserType, sessionId?: string, boardId?: string): Promise<TasksFile>
  saveTasks(
    userType: UserType,
    sessionId: string | undefined,
    boardId: string | undefined,
    tasks: TasksFile
  ): Promise<void>
  getStats(userType: UserType, sessionId?: string, boardId?: string): Promise<StatsFile>
  saveStats(
    userType: UserType,
    sessionId: string | undefined,
    boardId: string | undefined,
    stats: StatsFile
  ): Promise<void>
  /**
   * Persist several boards' task files as ONE atomic unit. On D1 this is a single
   * db.batch() (all-or-nothing), which closes the cross-board-move lost-update
   * gap: a move that empties the source and fills the target can no longer half-
   * apply. On the legacy KV blob store there is no cross-key transaction, so it
   * degrades to concurrent per-board writes — same behaviour as before.
   */
  batchSaveTasks(
    userType: UserType,
    sessionId: string | undefined,
    writes: Array<{ boardId: string; tasks: TasksFile }>
  ): Promise<void>
  getBoards(userType: UserType, sessionId?: string): Promise<BoardsFile>
  /**
   * Persist the board collection. `expectedVersion`, when provided (the caller
   * opted in via If-Match), makes the write a real compare-and-swap: a backend
   * that supports it (D1) bumps the collection version only if it still matches,
   * otherwise throws VersionConflictError. Omitted ⇒ last-write-wins (the legacy
   * KV blob store ignores it entirely).
   */
  saveBoards(
    userType: UserType,
    boards: BoardsFile,
    sessionId?: string,
    expectedVersion?: number
  ): Promise<void>
  deleteBoardData(userType: UserType, sessionId: string, boardId: string): Promise<void>
}
