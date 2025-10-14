/**
 * localStorage implementation of Storage interface
 * Used by handlers.ts to persist data client-side
 */

import type { TasksFile, StatsFile, BoardsFile } from '../types'

export class LocalStorageStorage {
  constructor(
    private userType: string = 'public',
    private userId: string = 'public'
  ) {}

  // --- Storage Keys ---
  // Note: Always use the userType from constructor, not the one passed to methods
  // This ensures data stays in the same localStorage location regardless of authContext
  
  private getTasksKey(userType: string, userId: string | undefined, boardId: string | undefined): string {
    return `${this.userType}-${userId || this.userId}-${boardId || 'main'}-tasks`
  }

  private getStatsKey(userType: string, userId: string | undefined, boardId: string | undefined): string {
    return `${this.userType}-${userId || this.userId}-${boardId || 'main'}-stats`
  }

  private getBoardsKey(userType: string, userId: string | undefined): string {
    return `${this.userType}-${userId || this.userId}-boards`
  }

  // --- Tasks Operations ---

  async getTasks(
    userType: string,
    userId: string | undefined,
    boardId: string | undefined
  ): Promise<TasksFile> {
    const key = this.getTasksKey(userType, userId, boardId)
    const stored = localStorage.getItem(key)
    
    if (stored) {
      return JSON.parse(stored)
    }
    
    // Return empty tasks file if not found
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      tasks: []
    }
  }

  async saveTasks(
    userType: string,
    userId: string | undefined,
    boardId: string | undefined,
    tasks: TasksFile
  ): Promise<void> {
    const key = this.getTasksKey(userType, userId, boardId)
    tasks.updatedAt = new Date().toISOString()
    localStorage.setItem(key, JSON.stringify(tasks))
  }

  // --- Stats Operations ---

  async getStats(
    userType: string,
    userId: string | undefined,
    boardId: string | undefined
  ): Promise<StatsFile> {
    const key = this.getStatsKey(userType, userId, boardId)
    const stored = localStorage.getItem(key)
    
    if (stored) {
      return JSON.parse(stored)
    }
    
    // Return empty stats file if not found
    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      counters: {
        created: 0,
        completed: 0,
        edited: 0,
        deleted: 0
      },
      timeline: [],
      tasks: {}
    }
  }

  async saveStats(
    userType: string,
    userId: string | undefined,
    boardId: string | undefined,
    stats: StatsFile
  ): Promise<void> {
    const key = this.getStatsKey(userType, userId, boardId)
    stats.updatedAt = new Date().toISOString()
    localStorage.setItem(key, JSON.stringify(stats))
  }

  // --- Boards Operations ---

  async getBoards(
    userType: string,
    userId: string | undefined
  ): Promise<BoardsFile> {
    const key = this.getBoardsKey(userType, userId)
    const stored = localStorage.getItem(key)
    
    if (stored) {
      return JSON.parse(stored)
    }
    
    // Return default main board if not found
    const defaultBoards: BoardsFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      boards: [
        {
          id: 'main',
          name: 'Main',
          tasks: [],
          tags: []
        }
      ]
    }
    
    // Save the default board so it persists
    await this.saveBoards(userType, defaultBoards, userId)
    
    return defaultBoards
  }

  async saveBoards(
    userType: string,
    boards: BoardsFile,
    userId: string | undefined
  ): Promise<void> {
    const key = this.getBoardsKey(userType, userId)
    boards.updatedAt = new Date().toISOString()
    localStorage.setItem(key, JSON.stringify(boards))
  }

  // --- Cleanup Operations ---

  async deleteBoardData(
    userType: string,
    userId: string | undefined,
    boardId: string
  ): Promise<void> {
    const tasksKey = this.getTasksKey(userType, userId, boardId)
    const statsKey = this.getStatsKey(userType, userId, boardId)
    localStorage.removeItem(tasksKey)
    localStorage.removeItem(statsKey)
  }
}
