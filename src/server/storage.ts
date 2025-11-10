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
  saveBoards(userType: UserType, boards: BoardsFile, sessionId?: string): Promise<void>
  deleteBoardData(userType: UserType, sessionId: string, boardId: string): Promise<void>
}
