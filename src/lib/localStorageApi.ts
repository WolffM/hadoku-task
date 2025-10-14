/**
 * localStorage-based API client for all user types
 * Provides the same interface as the server API but stores data locally
 */

import { ulid } from './ulid'
import type { TasksFile, StatsFile, Task, BoardsFile, Board } from './types'

// Import SESSION_ID from useTasks to include in broadcasts
import { SESSION_ID } from '../hooks/useTasks'

// Helper to broadcast with delay to ensure localStorage propagation across tabs
function deferredBroadcast(type: 'tasks-updated' | 'boards-updated', data: any, delayMs: number = 50) {
  setTimeout(() => {
    try {
      const bc = new BroadcastChannel('tasks')
      bc.postMessage({ type, ...data })
      bc.close()
    } catch (err) {
      console.error('[localStorageApi] Broadcast failed:', err)
    }
  }, delayMs)
}

// Generate storage keys based on user type and board
const getTasksKey = (userType: string, userId: string, boardId: string) => `${userType}-${userId}-${boardId}-tasks`
const getStatsKey = (userType: string, userId: string, boardId: string) => `${userType}-${userId}-${boardId}-stats`
const getBoardsIndexKey = (userType: string, userId: string) => `${userType}-${userId}-boards`

// Helper to get tasks from localStorage
function getTasks(userType: string = 'public', userId: string = 'public', boardId: string = 'main'): TasksFile {
  const stored = localStorage.getItem(getTasksKey(userType, userId, boardId))
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
function saveTasks(tasksFile: TasksFile, userType: string = 'public', userId: string = 'public', boardId: string = 'main'): void {
  tasksFile.updatedAt = new Date().toISOString()
  localStorage.setItem(getTasksKey(userType, userId, boardId), JSON.stringify(tasksFile))
}

// Helper to get stats from localStorage
function getStats(userType: string = 'public', userId: string = 'public', boardId: string = 'main'): StatsFile {
  const stored = localStorage.getItem(getStatsKey(userType, userId, boardId))
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
function saveStats(statsFile: StatsFile, userType: string = 'public', userId: string = 'public', boardId: string = 'main'): void {
  statsFile.updatedAt = new Date().toISOString()
  localStorage.setItem(getStatsKey(userType, userId, boardId), JSON.stringify(statsFile))
}

// Helper to update stats for an event
function recordEvent(
  event: 'created' | 'completed' | 'edited' | 'deleted',
  task: Task,
  userType: string = 'public',
  userId: string = 'public',
  boardId: string = 'main'
): void {
  const stats = getStats(userType, userId, boardId)
  
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
  
  saveStats(stats, userType, userId, boardId)
}

// Boards index helpers
function getBoardsIndex(userType: string = 'public', userId: string = 'public'): BoardsFile {
  const stored = localStorage.getItem(getBoardsIndexKey(userType, userId))
  if (stored) return JSON.parse(stored)
  return { version: 1, updatedAt: new Date().toISOString(), boards: [] }
}

function saveBoardsIndex(index: BoardsFile, userType: string = 'public', userId: string = 'public') {
  index.updatedAt = new Date().toISOString()
  localStorage.setItem(getBoardsIndexKey(userType, userId), JSON.stringify(index))
}

/**
 * Create a localStorage-based API client that mirrors the server API interface
 */
export function createLocalStorageApi(userType: string = 'public', userId: string = 'public') {
  return {
    async getBoards(): Promise<BoardsFile> {
      // Read the boards index, auto-create main if missing, and populate tasks/stats for each board
      const index = getBoardsIndex(userType, userId)
      if (!index.boards || index.boards.length === 0) {
        // create default main board
        const mainBoard = { id: 'main', name: 'main', tasks: [], stats: undefined, tags: [] }
        index.boards = [mainBoard]
        saveBoardsIndex(index, userType, userId)
        // initialize storage
        saveTasks({ version: 1, updatedAt: new Date().toISOString(), tasks: [] }, userType, userId, 'main')
        saveStats({ version: 2, updatedAt: new Date().toISOString(), counters: { created: 0, completed: 0, edited: 0, deleted: 0 }, timeline: [], tasks: {} }, userType, userId, 'main')
      }

      // Populate each board with its tasks and stats
      const populated: BoardsFile = { version: index.version, updatedAt: index.updatedAt, boards: [] }
      for (const b of index.boards) {
        const tasksFile = getTasks(userType, userId, b.id)
        const statsFile = getStats(userType, userId, b.id)
        // propagate persisted tags from the index entry if present
        const boardEntry = { id: b.id, name: b.name, tasks: tasksFile.tasks, stats: statsFile, tags: (b as any).tags || [] }
        populated.boards.push(boardEntry)
      }
      return populated
    },

    async createBoard(boardId: string): Promise<Board> {
      const index = getBoardsIndex(userType, userId)
      console.debug('[localStorageApi] createBoard', { userType, userId, boardId, existing: index.boards.map(b=>b.id) })
      if (index.boards.find(b => b.id === boardId)) {
        throw new Error('Board already exists')
      }
  const board: Board = { id: boardId, name: boardId, tasks: [], stats: undefined, tags: [] }
      index.boards.push(board)
      saveBoardsIndex(index, userType, userId)
      // Initialize empty tasks/stats for the new board
      saveTasks({ version: 1, updatedAt: new Date().toISOString(), tasks: [] }, userType, userId, boardId)
      saveStats({ version: 2, updatedAt: new Date().toISOString(), counters: { created: 0, completed: 0, edited: 0, deleted: 0 }, timeline: [], tasks: {} }, userType, userId, boardId)
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, userId })
      return board
    },

    async deleteBoard(boardId: string): Promise<void> {
      const index = getBoardsIndex(userType, userId)
      const i = index.boards.findIndex(b => b.id === boardId)
      if (i === -1) throw new Error('Board not found')
      index.boards.splice(i, 1)
      saveBoardsIndex(index, userType, userId)
      // Remove data
      localStorage.removeItem(getTasksKey(userType, userId, boardId))
      localStorage.removeItem(getStatsKey(userType, userId, boardId))
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, userId })
    },

    async getTasks(boardId: string = 'main'): Promise<TasksFile> {
      return getTasks(userType, userId, boardId)
    },

    async getStats(boardId: string = 'main'): Promise<StatsFile> {
      return getStats(userType, userId, boardId)
    },

    async createTask(data: { title: string; tag?: string }, boardId: string = 'main', suppressBroadcast: boolean = false): Promise<Task> {
      const tasksFile = getTasks(userType, userId, boardId)
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
  saveTasks(tasksFile, userType, userId, boardId)
      // If tag provided, ensure it's in the persisted boards index for this board
      if (data.tag) {
        const index = getBoardsIndex(userType, userId)
        const b = index.boards.find(bb => bb.id === boardId)
        if (b) {
          const existing = (b as any).tags || []
          const toAdd = data.tag.split(' ').filter(Boolean).filter(t => !existing.includes(t))
          if (toAdd.length) {
            (b as any).tags = [...existing, ...toAdd]
            saveBoardsIndex(index, userType, userId)
          }
        }
      }
   recordEvent('created', newTask, userType, userId, boardId)
   if (!suppressBroadcast) {
     console.log('[localStorageApi] createTask: broadcasting update', { sessionId: SESSION_ID, boardId, taskId: newTask.id })
     deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, userId, boardId })
   } else {
     console.log('[localStorageApi] createTask: broadcast suppressed')
   }
      
      return newTask
    },    async patchTask(id: string, updates: Partial<Pick<Task, 'title' | 'tag'>>, boardId: string = 'main', suppressBroadcast: boolean = false): Promise<Task> {
      const tasksFile = getTasks(userType, userId, boardId)
      const task = tasksFile.tasks.find(t => t.id === id)
      
      if (!task) {
        throw new Error('Task not found')
      }
      
      // Update task
      if (updates.title !== undefined) task.title = updates.title
      if (updates.tag !== undefined) task.tag = updates.tag
      // If updating tag, persist any new tags into the boards index so tags survive even if tasks are removed
      if (updates.tag !== undefined) {
        const index = getBoardsIndex(userType, userId)
        const b = index.boards.find(bb => bb.id === boardId)
        if (b) {
          const existing = (b as any).tags || []
          const toAdd = (updates.tag || '').split(' ').filter(Boolean).filter(t => !existing.includes(t))
          if (toAdd.length) {
            (b as any).tags = [...existing, ...toAdd]
            saveBoardsIndex(index, userType, userId)
          }
        }
      }
      task.updatedAt = new Date().toISOString()
      
  saveTasks(tasksFile, userType, userId, boardId)
  recordEvent('edited', task, userType, userId, boardId)
  
  // Broadcast update to other tabs unless suppressed
  if (!suppressBroadcast) {
    deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, userId, boardId })
  }
      
      return task
    },

    async completeTask(id: string, boardId: string = 'main'): Promise<Task> {
      const tasksFile = getTasks(userType, userId, boardId)
      const task = tasksFile.tasks.find(t => t.id === id)
      
      if (!task) {
        throw new Error('Task not found')
      }
      
      const now = new Date().toISOString()
      task.state = 'Completed'
      task.updatedAt = now
      task.closedAt = now
      
  saveTasks(tasksFile, userType, userId, boardId)
  recordEvent('completed', task, userType, userId, boardId)
  deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, userId, boardId })
      
      return task
    },

    async deleteTask(id: string, boardId: string = 'main', suppressBroadcast: boolean = false): Promise<Task> {
      console.log('[localStorageApi] deleteTask START', { id, boardId, suppressBroadcast, sessionId: SESSION_ID })
      const tasksFile = getTasks(userType, userId, boardId)
      const task = tasksFile.tasks.find(t => t.id === id)
      
      if (!task) {
        throw new Error('Task not found')
      }
      
      const now = new Date().toISOString()
      task.state = 'Deleted'
      task.updatedAt = now
      task.closedAt = now
      
  saveTasks(tasksFile, userType, userId, boardId)
  recordEvent('deleted', task, userType, userId, boardId)
  if (!suppressBroadcast) {
    console.log('[localStorageApi] deleteTask: broadcasting', { sessionId: SESSION_ID })
    deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, userId, boardId })
  } else {
    console.log('[localStorageApi] deleteTask: broadcast suppressed')
  }
      console.log('[localStorageApi] deleteTask END')
      return task
    },

    async createTag(tag: string, boardId: string = 'main'): Promise<void> {
      const index = getBoardsIndex(userType, userId)
      const b = index.boards.find(bb => bb.id === boardId)
      if (!b) throw new Error('Board not found')
      const existing = (b as any).tags || []
      if (!existing.includes(tag)) {
        (b as any).tags = [...existing, tag]
        saveBoardsIndex(index, userType, userId)
        deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, userId, boardId })
      }
    },

    async deleteTag(tag: string, boardId: string = 'main'): Promise<void> {
      const index = getBoardsIndex(userType, userId)
      const b = index.boards.find(bb => bb.id === boardId)
      if (!b) throw new Error('Board not found')
      const existing = ((b as any).tags || []) as string[]
      // Filter out the tag to delete
      (b as any).tags = existing.filter(t => t !== tag)
      saveBoardsIndex(index, userType, userId)
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, userId, boardId })
    }
  }
}
