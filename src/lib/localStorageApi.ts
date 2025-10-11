/**
 * localStorage-based API client for public mode
 * Provides the same interface as the server API but stores data locally
 */

import { ulid } from './ulid'
import type { TasksFile, StatsFile, Task } from './types'

const STORAGE_KEY = 'hadoku-public-tasks'
const STATS_KEY = 'hadoku-public-stats'

// Helper to get tasks from localStorage
function getTasks(): TasksFile {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    return JSON.parse(stored)
  }
  // Initialize empty tasks file
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tasks: []
  }
}

// Helper to save tasks to localStorage
function saveTasks(tasksFile: TasksFile): void {
  tasksFile.updatedAt = new Date().toISOString()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasksFile))
}

// Helper to get stats from localStorage
function getStats(): StatsFile {
  const stored = localStorage.getItem(STATS_KEY)
  if (stored) {
    return JSON.parse(stored)
  }
  // Initialize empty stats file
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

// Helper to save stats to localStorage
function saveStats(statsFile: StatsFile): void {
  statsFile.updatedAt = new Date().toISOString()
  localStorage.setItem(STATS_KEY, JSON.stringify(statsFile))
}

// Helper to update stats for an event
function recordEvent(
  event: 'created' | 'completed' | 'edited' | 'deleted',
  task: Task
): void {
  const stats = getStats()
  
  // Update counters
  stats.counters[event]++
  
  // Add to timeline
  stats.timeline.push({
    t: new Date().toISOString(),
    event,
    id: task.id
  })
  
  // Update task snapshot
  stats.tasks[task.id] = {
    id: task.id,
    title: task.title,
    tag: task.tag,
    state: task.state,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    closedAt: task.closedAt
  }
  
  saveStats(stats)
}

/**
 * Create a localStorage-based API client that mirrors the server API interface
 */
export function createLocalStorageApi() {
  return {
    async getTasks(): Promise<TasksFile> {
      return getTasks()
    },

    async getStats(): Promise<StatsFile> {
      return getStats()
    },

    async createTask(data: { title: string; tag?: string }): Promise<Task> {
      const tasksFile = getTasks()
      const now = new Date().toISOString()
      
      const newTask: Task = {
        id: ulid(),
        title: data.title,
        tag: data.tag || null,
        state: 'Active',
        createdAt: now,
        updatedAt: now,
        closedAt: null
      }
      
      tasksFile.tasks.push(newTask)
      saveTasks(tasksFile)
      recordEvent('created', newTask)
      
      return newTask
    },

    async patchTask(id: string, updates: Partial<Pick<Task, 'title' | 'tag'>>): Promise<Task> {
      const tasksFile = getTasks()
      const task = tasksFile.tasks.find(t => t.id === id)
      
      if (!task) {
        throw new Error('Task not found')
      }
      
      // Update task
      if (updates.title !== undefined) task.title = updates.title
      if (updates.tag !== undefined) task.tag = updates.tag
      task.updatedAt = new Date().toISOString()
      
      saveTasks(tasksFile)
      recordEvent('edited', task)
      
      return task
    },

    async completeTask(id: string): Promise<Task> {
      const tasksFile = getTasks()
      const task = tasksFile.tasks.find(t => t.id === id)
      
      if (!task) {
        throw new Error('Task not found')
      }
      
      const now = new Date().toISOString()
      task.state = 'Completed'
      task.updatedAt = now
      task.closedAt = now
      
      saveTasks(tasksFile)
      recordEvent('completed', task)
      
      return task
    },

    async deleteTask(id: string): Promise<Task> {
      const tasksFile = getTasks()
      const task = tasksFile.tasks.find(t => t.id === id)
      
      if (!task) {
        throw new Error('Task not found')
      }
      
      const now = new Date().toISOString()
      task.state = 'Deleted'
      task.updatedAt = now
      task.closedAt = now
      
      saveTasks(tasksFile)
      recordEvent('deleted', task)
      
      return task
    },

    async clearPublicTasks(): Promise<{ message: string }> {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(STATS_KEY)
      return { message: 'All tasks cleared' }
    }
  }
}
