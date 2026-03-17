/**
 * localStorage implementation of Storage interface
 * Used by handlers.ts to persist data client-side
 */

import type { TasksFile, StatsFile, BoardsFile } from '../../domain/types'
import {
  createDefaultTasks,
  createDefaultStats,
  createDefaultBoards
} from '../../domain/utils/defaults'

export class LocalStorageStorage {
  constructor(
    private userType: string = 'public',
    private sessionId: string = 'public'
  ) {}

  // --- Storage Keys ---
  // Note: Always use the userType from constructor, not the one passed to methods
  // This ensures data stays in the same localStorage location regardless of authContext

  private getKey(
    type: 'tasks' | 'stats' | 'boards',
    sessionId: string | undefined,
    boardId?: string | undefined
  ): string {
    if (type === 'boards') {
      return `${this.userType}-${sessionId || this.sessionId}-boards`
    }
    return `${this.userType}-${sessionId || this.sessionId}-${boardId || 'main'}-${type}`
  }

  private getTasksKey(
    _userType: string,
    sessionId: string | undefined,
    boardId: string | undefined
  ): string {
    return this.getKey('tasks', sessionId, boardId)
  }

  private getStatsKey(
    _userType: string,
    sessionId: string | undefined,
    boardId: string | undefined
  ): string {
    return this.getKey('stats', sessionId, boardId)
  }

  private getBoardsKey(_userType: string, sessionId: string | undefined): string {
    return this.getKey('boards', sessionId)
  }

  // --- Tasks Operations ---

  async getTasks(
    userType: string,
    sessionId: string | undefined,
    boardId: string | undefined
  ): Promise<TasksFile> {
    const key = this.getTasksKey(userType, sessionId, boardId)
    const stored = localStorage.getItem(key)

    if (stored) {
      return JSON.parse(stored)
    }

    // Return empty tasks file if not found
    return createDefaultTasks()
  }

  async saveTasks(
    userType: string,
    sessionId: string | undefined,
    boardId: string | undefined,
    tasks: TasksFile
  ): Promise<void> {
    const key = this.getTasksKey(userType, sessionId, boardId)
    tasks.updatedAt = new Date().toISOString()
    localStorage.setItem(key, JSON.stringify(tasks))
  }

  // --- Stats Operations ---

  async getStats(
    userType: string,
    sessionId: string | undefined,
    boardId: string | undefined
  ): Promise<StatsFile> {
    const key = this.getStatsKey(userType, sessionId, boardId)
    const stored = localStorage.getItem(key)

    if (stored) {
      return JSON.parse(stored)
    }

    // Return empty stats file if not found
    return createDefaultStats()
  }

  async saveStats(
    userType: string,
    sessionId: string | undefined,
    boardId: string | undefined,
    stats: StatsFile
  ): Promise<void> {
    const key = this.getStatsKey(userType, sessionId, boardId)
    stats.updatedAt = new Date().toISOString()
    localStorage.setItem(key, JSON.stringify(stats))
  }

  // --- Boards Operations ---

  async getBoards(userType: string, sessionId: string | undefined): Promise<BoardsFile> {
    const key = this.getBoardsKey(userType, sessionId)
    const stored = localStorage.getItem(key)

    if (stored) {
      return JSON.parse(stored)
    }

    // Return default main board if not found
    const defaultBoards = createDefaultBoards()

    // Save the default board so it persists
    await this.saveBoards(userType, defaultBoards, sessionId)

    return defaultBoards
  }

  async saveBoards(
    userType: string,
    boards: BoardsFile,
    sessionId: string | undefined
  ): Promise<void> {
    const key = this.getBoardsKey(userType, sessionId)
    boards.updatedAt = new Date().toISOString()
    localStorage.setItem(key, JSON.stringify(boards))
  }

  // --- Cleanup Operations ---

  async deleteBoardData(
    userType: string,
    sessionId: string | undefined,
    boardId: string
  ): Promise<void> {
    const tasksKey = this.getTasksKey(userType, sessionId, boardId)
    const statsKey = this.getStatsKey(userType, sessionId, boardId)
    localStorage.removeItem(tasksKey)
    localStorage.removeItem(statsKey)
  }
}
