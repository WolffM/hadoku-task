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
