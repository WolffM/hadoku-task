/**
 * localStorage-based API client for all user types
 * Provides the same interface as the server API but stores data locally
 */

import { ulid } from './ulid'
import type { TasksFile, StatsFile, Task } from './types'

// Generate storage keys based on user type
const getTasksKey = (userType: string) => `hadoku-${userType}-tasks`
const getStatsKey = (userType: string) => `hadoku-${userType}-stats`

// Helper to get tasks from localStorage
function getTasks(userType: string = 'public'): TasksFile {
  const stored = localStorage.getItem(getTasksKey(userType))
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
function saveTasks(tasksFile: TasksFile, userType: string = 'public'): void {
  tasksFile.updatedAt = new Date().toISOString()
  localStorage.setItem(getTasksKey(userType), JSON.stringify(tasksFile))
}

// Helper to get stats from localStorage
function getStats(userType: string = 'public'): StatsFile {
  const stored = localStorage.getItem(getStatsKey(userType))
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
function saveStats(statsFile: StatsFile, userType: string = 'public'): void {
  statsFile.updatedAt = new Date().toISOString()
  localStorage.setItem(getStatsKey(userType), JSON.stringify(statsFile))
}

// Helper to update stats for an event
function recordEvent(
  event: 'created' | 'completed' | 'edited' | 'deleted',
  task: Task,
  userType: string = 'public'
): void {
  const stats = getStats(userType)
  
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
  
  saveStats(stats, userType)
}

/**
 * Create a localStorage-based API client that mirrors the server API interface
 */
export function createLocalStorageApi(userType: string = 'public') {
  return {
    async getTasks(): Promise<TasksFile> {
      return getTasks(userType)
    },

    async getStats(): Promise<StatsFile> {
      return getStats(userType)
    },

    async createTask(data: { title: string; tag?: string }): Promise<Task> {
      const tasksFile = getTasks(userType)
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
      saveTasks(tasksFile, userType)
      recordEvent('created', newTask, userType)
      
      return newTask
    },

    async patchTask(id: string, updates: Partial<Pick<Task, 'title' | 'tag'>>): Promise<Task> {
      const tasksFile = getTasks(userType)
      const task = tasksFile.tasks.find(t => t.id === id)
      
      if (!task) {
        throw new Error('Task not found')
      }
      
      // Update task
      if (updates.title !== undefined) task.title = updates.title
      if (updates.tag !== undefined) task.tag = updates.tag
      task.updatedAt = new Date().toISOString()
      
      saveTasks(tasksFile, userType)
      recordEvent('edited', task, userType)
      
      return task
    },

    async completeTask(id: string): Promise<Task> {
      const tasksFile = getTasks(userType)
      const task = tasksFile.tasks.find(t => t.id === id)
      
      if (!task) {
        throw new Error('Task not found')
      }
      
      const now = new Date().toISOString()
      task.state = 'Completed'
      task.updatedAt = now
      task.closedAt = now
      
      saveTasks(tasksFile, userType)
      recordEvent('completed', task, userType)
      
      return task
    },

    async deleteTask(id: string): Promise<Task> {
      const tasksFile = getTasks(userType)
      const task = tasksFile.tasks.find(t => t.id === id)
      
      if (!task) {
        throw new Error('Task not found')
      }
      
      const now = new Date().toISOString()
      task.state = 'Deleted'
      task.updatedAt = now
      task.closedAt = now
      
      saveTasks(tasksFile, userType)
      recordEvent('deleted', task, userType)
      
      return task
    },

    async clearPublicTasks(): Promise<{ message: string }> {
      localStorage.removeItem(getTasksKey(userType))
      localStorage.removeItem(getStatsKey(userType))
      return { message: 'All tasks cleared' }
    }
  }
}
