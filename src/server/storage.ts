/**
 * Storage layer for Task Router
 * Handles both in-memory (public) and file-based (friend/admin) storage
 * Also provides Storage interface implementation
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import process from 'process'
import type { TasksFile, StatsFile, BoardsFile, Board, DataType, UserType, RouterConfig } from './types.js'
import { now } from './utils.js'
import type { SyncQueue } from './sync-queue.js'

/**
 * Storage interface - defines the contract for data persistence
 */
export interface Storage {
  getTasks(userType: UserType): Promise<TasksFile>;
  saveTasks(userType: UserType, tasks: TasksFile): Promise<void>;
  getStats(userType: UserType): Promise<StatsFile>;
  saveStats(userType: UserType, stats: StatsFile): Promise<void>;
  // Board operations
  getBoards(userType: UserType, userId?: string): Promise<BoardsFile>;
  saveBoards(userType: UserType, boards: BoardsFile, userId?: string): Promise<void>;
}

/**
 * Create empty tasks file structure
 */
function createEmptyTasksFile(): TasksFile {
  return {
    version: 1,
    tasks: [],
    updatedAt: now()
  }
}

/**
 * Create empty stats file structure
 */
function createEmptyStatsFile(): StatsFile {
  return {
    version: 2,
    counters: {
      created: 0,
      completed: 0,
      edited: 0,
      deleted: 0
    },
    timeline: [],
    tasks: {},
    updatedAt: now()
  }
}

/**
 * Create empty boards file structure
 */
function createEmptyBoardsFile(): BoardsFile {
  return {
    version: 1,
    updatedAt: now(),
    boards: [{
      id: 'main',
      name: 'Main',
      tasks: [],
      tags: []
    }]
  }
}

// In-memory storage for public users (singleton)
const publicData: {
  tasks: TasksFile
  stats: StatsFile
  boards: BoardsFile
} = {
  tasks: createEmptyTasksFile(),
  stats: createEmptyStatsFile(),
  boards: createEmptyBoardsFile()
}

/**
 * Get in-memory data for public users
 */
export function getPublicData(dataType: DataType): TasksFile | StatsFile {
  return publicData[dataType]
}

/**
 * Set in-memory data for public users
 */
export function setPublicData(dataType: DataType, data: TasksFile | StatsFile): void {
  publicData[dataType] = data as any
}

/**
 * Ensure user data directory exists
 */
function ensureUserDirectory(userType: UserType, basePath: string): void {
  const userDir = join(basePath, userType)
  if (!existsSync(userDir)) {
    mkdirSync(userDir, { recursive: true })
  }
}

/**
 * Ensure user data files exist with default content
 */
export function ensureUserDataExists(userType: UserType, basePath: string): void {
  ensureUserDirectory(userType, basePath)
  
  const tasksPath = join(basePath, userType, 'tasks.json')
  const statsPath = join(basePath, userType, 'stats.json')
  
  if (!existsSync(tasksPath)) {
    writeFileSync(tasksPath, JSON.stringify(createEmptyTasksFile(), null, 2))
  }
  
  if (!existsSync(statsPath)) {
    writeFileSync(statsPath, JSON.stringify(createEmptyStatsFile(), null, 2))
  }
}

/**
 * Read JSON file for friend/admin users
 */
export function readUserData(
  userType: UserType,
  dataType: DataType,
  basePath: string
): TasksFile | StatsFile {
  const filePath = join(basePath, userType, `${dataType}.json`)
  
  try {
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error)
    
    // If file doesn't exist, create it
    ensureUserDataExists(userType, basePath)
    
    // Return default data
    return dataType === 'tasks' ? createEmptyTasksFile() : createEmptyStatsFile()
  }
}

/**
 * Write JSON file for friend/admin users
 */
export function writeUserData(
  userType: UserType,
  dataType: DataType,
  data: TasksFile | StatsFile,
  basePath: string
): void {
  ensureUserDirectory(userType, basePath)
  
  const filePath = join(basePath, userType, `${dataType}.json`)
  
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2))
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error)
    throw error
  }
}

export function createStorage(config: RouterConfig, syncQueue: SyncQueue): Storage {
  const basePath = config.dataPath

  return {
    async getTasks(userType: UserType): Promise<TasksFile> {
      if (userType === 'public') {
        return publicData.tasks
      }
      
      ensureUserDataExists(userType, basePath)
      return readUserData(userType, 'tasks', basePath) as TasksFile
    },

    async saveTasks(userType: UserType, data: TasksFile): Promise<void> {
      if (userType === 'public') {
        publicData.tasks = data
        return
      }

      writeUserData(userType, 'tasks', data, basePath)
      
      if (config.githubConfig && syncQueue) {
        syncQueue.add(userType, 'tasks')
      }
    },

    async getStats(userType: UserType): Promise<StatsFile> {
      if (userType === 'public') {
        return publicData.stats
      }
      
      ensureUserDataExists(userType, basePath)
      return readUserData(userType, 'stats', basePath) as StatsFile
    },

    async saveStats(userType: UserType, data: StatsFile): Promise<void> {
      if (userType === 'public') {
        publicData.stats = data
        return
      }

      writeUserData(userType, 'stats', data, basePath)
      
      if (config.githubConfig && syncQueue) {
        syncQueue.add(userType, 'stats')
      }
    },

    async getBoards(userType: UserType, userId?: string): Promise<BoardsFile> {
      if (userType === 'public') {
        return publicData.boards
      }
      
      // For admin/friend with userId, use subdirectory structure
      const boardsPath = userId 
        ? join(basePath, userType, userId, 'boards.json')
        : join(basePath, userType, 'boards.json')
      
      // If boards.json exists, return it
      if (existsSync(boardsPath)) {
        try {
          const content = readFileSync(boardsPath, 'utf-8')
          return JSON.parse(content) as BoardsFile
        } catch (error) {
          console.error(`Error reading ${boardsPath}:`, error)
        }
      }
      
      // Migration: If boards.json doesn't exist, try to migrate from old tasks.json format
      const oldTasksPath = userId
        ? join(basePath, userType, userId, 'tasks.json')
        : join(basePath, userType, 'tasks.json')
      
      if (existsSync(oldTasksPath)) {
        try {
          const content = readFileSync(oldTasksPath, 'utf-8')
          const tasksFile = JSON.parse(content) as TasksFile
          
          // Create new boards format with main board containing old tasks
          const boardsFile: BoardsFile = {
            version: 1,
            updatedAt: now(),
            boards: [{
              id: 'main',
              name: 'Main',
              tasks: tasksFile.tasks || [],
              tags: []
            }]
          }
          
          // Save migrated data
          await this.saveBoards(userType, boardsFile, userId)
          return boardsFile
        } catch (error) {
          console.error(`Error migrating from ${oldTasksPath}:`, error)
        }
      }
      
      // No data found, return empty boards structure
      return createEmptyBoardsFile()
    },

    async saveBoards(userType: UserType, boards: BoardsFile, userId?: string): Promise<void> {
      if (userType === 'public') {
        publicData.boards = boards
        return
      }

      // For admin/friend with userId, use subdirectory structure
      const targetDir = userId 
        ? join(basePath, userType, userId)
        : join(basePath, userType)
      
      // Ensure directory exists
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true })
      }

      const boardsPath = join(targetDir, 'boards.json')
      
      try {
        writeFileSync(boardsPath, JSON.stringify(boards, null, 2))
      } catch (error) {
        console.error(`Error writing ${boardsPath}:`, error)
        throw error
      }
      
      // TODO: Add to sync queue when boards support is added
      // if (config.githubConfig && syncQueue) {
      //   syncQueue.add(userType, 'boards')
      // }
    }
  }
}
