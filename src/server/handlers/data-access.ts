/**
 * Data Access Layer - Unified interface for public vs file-based storage
 */

import type { RouterConfig, TasksFile, StatsFile, UserType } from '../types.js'
import { getPublicData, setPublicData, readUserData, writeUserData } from '../storage.js'
import { SyncQueue } from '../sync-queue.js'

export class DataAccess {
  constructor(
    private config: RouterConfig,
    private syncQueue: SyncQueue
  ) {}

  /**
   * Get tasks data for any user type
   */
  getTasks(userType: UserType): TasksFile {
    if (userType === 'public') {
      return getPublicData('tasks') as TasksFile
    }
    return readUserData(userType, 'tasks', this.config.dataPath) as TasksFile
  }

  /**
   * Get stats data for any user type
   */
  getStats(userType: UserType): StatsFile {
    if (userType === 'public') {
      return getPublicData('stats') as StatsFile
    }
    return readUserData(userType, 'stats', this.config.dataPath) as StatsFile
  }

  /**
   * Set tasks data for any user type
   */
  setTasks(userType: UserType, tasks: TasksFile): void {
    if (userType === 'public') {
      setPublicData('tasks', tasks)
    } else {
      writeUserData(userType, 'tasks', tasks, this.config.dataPath)
      this.syncQueue.add(userType, 'tasks')
    }
  }

  /**
   * Set stats data for any user type
   */
  setStats(userType: UserType, stats: StatsFile): void {
    if (userType === 'public') {
      setPublicData('stats', stats)
    } else {
      writeUserData(userType, 'stats', stats, this.config.dataPath)
      this.syncQueue.add(userType, 'stats')
    }
  }

  /**
   * Get both tasks and stats in one call
   */
  getData(userType: UserType): { tasks: TasksFile; stats: StatsFile } {
    return {
      tasks: this.getTasks(userType),
      stats: this.getStats(userType)
    }
  }

  /**
   * Set both tasks and stats in one call
   */
  setData(userType: UserType, data: { tasks: TasksFile; stats: StatsFile }): void {
    this.setTasks(userType, data.tasks)
    this.setStats(userType, data.stats)
  }
}
