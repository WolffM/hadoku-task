import type { TasksFile, StatsFile, BoardsFile, UserType } from '../domain/types.js'

export interface Storage {
  getTasks(userType: UserType, userId?: string, boardId?: string): Promise<TasksFile>
  saveTasks(userType: UserType, userId: string | undefined, boardId: string | undefined, tasks: TasksFile): Promise<void>
  getStats(userType: UserType, userId?: string, boardId?: string): Promise<StatsFile>
  saveStats(userType: UserType, userId: string | undefined, boardId: string | undefined, stats: StatsFile): Promise<void>
  getBoards(userType: UserType, userId?: string): Promise<BoardsFile>
  saveBoards(userType: UserType, boards: BoardsFile, userId?: string): Promise<void>
  deleteBoardData(userType: UserType, userId: string, boardId: string): Promise<void>
}
