/**
 * localStorage-based API client for all user types
 * Provides the same interface as the server API but stores data locally
 */

import type {
  TasksFile,
  StatsFile,
  Task,
  BoardsFile,
  Board,
  AuthContext,
  CreateTaskInput
} from '../domain/types'
import { TaskNotFoundError } from '../domain/types'
import { SESSION_ID } from './session'
import { LocalStorageStorage } from './storage/LocalStorageStorage'
import * as TaskHandlers from '../domain/handlers/handlers'
import { deferredBroadcast } from '../utils/broadcast'
import { createDefaultTasks, createDefaultStats } from '../domain/utils/defaults'
import { logger } from '@wolffm/logger/client'

/**
 * Create a localStorage-based API client that mirrors the server API interface
 */
export function createLocalStorageApi(userType: string = 'public', sessionId: string = 'public') {
  const storage = new LocalStorageStorage(userType, sessionId)

  // For localStorage operations, treat all users as 'registered' to bypass server auth checks
  // Public users CAN create tasks locally, the auth checks are only for server-side API calls
  const authContext: AuthContext = { userType: 'registered', sessionId }

  return {
    async getBoards(): Promise<BoardsFile> {
      // Use handler to get boards
      const boardsFile = await TaskHandlers.getBoards(storage, authContext)

      // Populate each board with tasks and stats
      const populated: BoardsFile = {
        version: boardsFile.version,
        updatedAt: boardsFile.updatedAt,
        boards: []
      }

      for (const b of boardsFile.boards) {
        const tasksFile = await storage.getTasks(userType, sessionId, b.id)
        const statsFile = await storage.getStats(userType, sessionId, b.id)
        populated.boards.push({
          id: b.id,
          name: b.name,
          tasks: tasksFile.tasks,
          stats: statsFile,
          tags: b.tags || [],
          // Preserve per-viewer pin/position (they live on the board in the KV
          // blob for the local path). Dropping them here is what made the top
          // bar and Edit Boards modal ignore pins in offline/public mode.
          pinned: b.pinned,
          position: b.position,
          // Board type (§5.3) — carried on the board in the KV blob for the
          // local path; drop it and the two-track layout can't apply offline.
          mode: b.mode
        })
      }

      return populated
    },

    async createBoard(boardId: string): Promise<Board> {
      logger.info('[localStorageApi] createBoard (using handler)', { userType, sessionId, boardId })

      // Use handler
      const result = await TaskHandlers.createBoard(storage, authContext, {
        id: boardId,
        name: boardId
      })

      // Initialize empty tasks/stats for new board
      await storage.saveTasks(userType, sessionId, boardId, createDefaultTasks())
      await storage.saveStats(userType, sessionId, boardId, createDefaultStats())

      // Broadcast update
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType })

      return result.board
    },

    async deleteBoard(boardId: string): Promise<void> {
      // Use handler
      await TaskHandlers.deleteBoard(storage, authContext, boardId)

      // Cleanup board data
      await storage.deleteBoardData(userType, sessionId, boardId)

      // Broadcast update
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType })
    },

    async renameBoard(boardId: string, name: string): Promise<void> {
      await TaskHandlers.updateBoard(storage, authContext, boardId, { name })
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType })
    },

    async setPinnedBoards(order: string[]): Promise<void> {
      await TaskHandlers.setPinnedBoards(storage, authContext, order)
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType })
    },

    // Board sharing (§7) is a server-only, signed-in feature. Public/localStorage
    // mode can't share, so these are inert — they keep the api shape uniform
    // across the public vs signed-in branches of createApi.
    async searchUsers(_q: string): Promise<Array<{ name: string; tier?: string }>> {
      return []
    },
    async listShares(
      _boardRef: string
    ): Promise<Array<{ granteeUserId: string; name?: string | null; tier?: string | null; level: string; createdAt: string }>> {
      return []
    },
    async grantShare(
      _boardRef: string,
      _input: { name?: string; userId?: string; level: 'readonly' | 'contributor' }
    ): Promise<{ ok: boolean; error?: string; granted?: { name: string | null; tier: string | null; level: string } }> {
      return { ok: false, error: 'Sign in to share boards.' }
    },
    async revokeShare(_boardRef: string, _granteeUserId: string): Promise<boolean> {
      return false
    },
    async activateAutomation(
      _boardRef: string,
      _payload: {
        lanes: unknown
        schemaId?: string | null
        schemaVersion?: number | null
        repo?: string | null
        dryRun?: boolean
        digest?: string
      }
    ): Promise<{ ok: boolean; error?: string; code?: string; result?: unknown }> {
      return { ok: false, error: 'Sign in to configure automation boards.' }
    },
    async deactivateAutomation(_boardRef: string): Promise<{ ok: boolean; error?: string }> {
      return { ok: false, error: 'Sign in to configure automation boards.' }
    },

    async getTasks(boardId: string = 'main'): Promise<TasksFile> {
      return storage.getTasks(userType, sessionId, boardId)
    },

    async getStats(boardId: string = 'main'): Promise<StatsFile> {
      return storage.getStats(userType, sessionId, boardId)
    },

    async createTask(
      data: CreateTaskInput,
      boardId: string = 'main',
      suppressBroadcast: boolean = false
    ): Promise<Task> {
      logger.info('[localStorageApi] createTask (using handler)', {
        data,
        boardId,
        suppressBroadcast
      })

      // Use handler - it handles stats, validation, everything
      // Pass through id and createdAt if provided (for preserving IDs during moves)
      const result = await TaskHandlers.createTask(storage, authContext, data, boardId)

      // Get the created task from storage
      const tasksFile = await storage.getTasks(userType, sessionId, boardId)
      const createdTask = tasksFile.tasks.find(t => t.id === result.id)

      if (!createdTask) {
        throw new Error('Task creation failed - task not found after creation')
      }

      // Broadcast update unless suppressed
      if (!suppressBroadcast) {
        logger.info('[localStorageApi] createTask: broadcasting', {
          sessionId: SESSION_ID,
          boardId,
          taskId: result.id
        })
        deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, boardId })
      } else {
        logger.info('[localStorageApi] createTask: broadcast suppressed')
      }

      return createdTask
    },
    async patchTask(
      id: string,
      updates: Partial<
        Pick<Task, 'title' | 'notes' | 'tag' | 'date' | 'startTime' | 'endTime' | 'metadata'>
      >,
      boardId: string = 'main',
      suppressBroadcast: boolean = false
    ): Promise<Task> {
      // Filter out undefined values - handler expects explicit values or null
      const cleanUpdates: {
        title?: string
        notes?: string | null
        tag?: string
        date?: string | null
        startTime?: string | null
        endTime?: string | null
        metadata?: Record<string, unknown> | null
      } = {}
      if (updates.title !== undefined) cleanUpdates.title = updates.title
      if (updates.notes !== undefined) cleanUpdates.notes = updates.notes
      if (updates.tag !== undefined && updates.tag !== null) cleanUpdates.tag = updates.tag
      if (updates.date !== undefined) cleanUpdates.date = updates.date
      if (updates.startTime !== undefined) cleanUpdates.startTime = updates.startTime
      if (updates.endTime !== undefined) cleanUpdates.endTime = updates.endTime
      if (updates.metadata !== undefined) cleanUpdates.metadata = updates.metadata

      // Use handler
      await TaskHandlers.updateTask(storage, authContext, id, cleanUpdates, boardId)

      // Broadcast update unless suppressed
      if (!suppressBroadcast) {
        deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, boardId })
      }

      // Get updated task from storage
      const tasksFile = await storage.getTasks(userType, sessionId, boardId)
      const updatedTask = tasksFile.tasks.find(t => t.id === id)

      if (!updatedTask) {
        throw new Error('Task not found after update')
      }

      return updatedTask
    },

    async completeTask(id: string, boardId: string = 'main'): Promise<Task> {
      // Get the task BEFORE completing it (since handler removes it from active list)
      const tasksFile = await storage.getTasks(userType, sessionId, boardId)
      const taskToComplete = tasksFile.tasks.find(t => t.id === id)

      if (!taskToComplete) {
        throw new TaskNotFoundError(id)
      }

      // Use handler to complete the task (removes from active, updates stats)
      await TaskHandlers.completeTask(storage, authContext, id, boardId)

      // Broadcast update
      deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, boardId })

      // Return the completed task with updated state
      return {
        ...taskToComplete,
        state: 'Completed',
        closedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    },

    async deleteTask(
      id: string,
      boardId: string = 'main',
      suppressBroadcast: boolean = false
    ): Promise<Task> {
      logger.info('[localStorageApi] deleteTask (using handler)', {
        id,
        boardId,
        suppressBroadcast
      })

      // Get the task BEFORE deletion so we can return it
      const tasksFileBefore = await storage.getTasks(userType, sessionId, boardId)
      const taskToDelete = tasksFileBefore.tasks.find(t => t.id === id)

      if (!taskToDelete) {
        throw new TaskNotFoundError(id)
      }

      // Use handler to delete the task
      await TaskHandlers.deleteTask(storage, authContext, id, boardId)

      // Broadcast update unless suppressed
      if (!suppressBroadcast) {
        logger.info('[localStorageApi] deleteTask: broadcasting', { sessionId: SESSION_ID })
        deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, boardId })
      } else {
        logger.info('[localStorageApi] deleteTask: broadcast suppressed')
      }

      // Return the task as it was before deletion (with state updated to 'Deleted')
      return {
        ...taskToDelete,
        state: 'Deleted',
        closedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    },

    async createTag(tag: string, boardId: string = 'main'): Promise<void> {
      // Use handler - expects { boardId, tag } input
      await TaskHandlers.createTag(storage, authContext, { boardId, tag })

      // Broadcast update
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, boardId })
    },

    async deleteTag(tag: string, boardId: string = 'main'): Promise<void> {
      // Use handler - expects { boardId, tag } input
      await TaskHandlers.deleteTag(storage, authContext, { boardId, tag })

      // Broadcast update
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, boardId })
    },

    // User preferences moved to @wolffm/prefs-client (see src/prefs/taskPrefs.ts).
    // The legacy localStorage `{userType}-{sessionId}-preferences` blob is read
    // once by the SDK migration, then removed. (Tranche A, 2026-05-22.)

    // Batch operations
    async batchMoveTasks(
      sourceBoardId: string,
      targetBoardId: string,
      taskIds: string[]
    ): Promise<{ ok: boolean; moved: number }> {
      const boards = await this.getBoards()

      const sourceBoard = boards.boards.find(b => b.id === sourceBoardId)
      const targetBoard = boards.boards.find(b => b.id === targetBoardId)

      if (!sourceBoard) {
        throw new Error(`Source board ${sourceBoardId} not found`)
      }
      if (!targetBoard) {
        throw new Error(`Target board ${targetBoardId} not found`)
      }

      // Find tasks to move
      const tasksToMove = sourceBoard.tasks.filter(t => taskIds.includes(t.id))

      // Remove from source
      sourceBoard.tasks = sourceBoard.tasks.filter(t => !taskIds.includes(t.id))

      // Add to target
      targetBoard.tasks = [...targetBoard.tasks, ...tasksToMove]

      // Update timestamp
      boards.updatedAt = new Date().toISOString()

      // Save back to localStorage
      const boardsKey = `${userType}-${sessionId}-boards`
      localStorage.setItem(boardsKey, JSON.stringify(boards))

      // Update individual board storage
      const sourceBoardKey = `${userType}-${sessionId}-${sourceBoardId}-tasks`
      const targetBoardKey = `${userType}-${sessionId}-${targetBoardId}-tasks`

      localStorage.setItem(
        sourceBoardKey,
        JSON.stringify({
          version: 1,
          updatedAt: boards.updatedAt,
          tasks: sourceBoard.tasks
        })
      )

      localStorage.setItem(
        targetBoardKey,
        JSON.stringify({
          version: 1,
          updatedAt: boards.updatedAt,
          tasks: targetBoard.tasks
        })
      )

      // Broadcast change
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType })

      return { ok: true, moved: tasksToMove.length }
    },

    async batchUpdateTags(
      boardId: string,
      updates: Array<{ taskId: string; tag: string | null }>
    ): Promise<void> {
      logger.info('[localStorageApi] batchUpdateTags', { boardId, updates })

      // Use handler
      await TaskHandlers.batchUpdateTags(storage, authContext, { boardId, updates })

      // Broadcast update
      deferredBroadcast('tasks-updated', { sessionId: SESSION_ID, userType, boardId })
    },

    async batchClearTag(boardId: string, tag: string, taskIds: string[]): Promise<void> {
      logger.info('[localStorageApi] batchClearTag START', {
        boardId,
        tag,
        taskIds,
        taskCount: taskIds.length
      })

      // Use handler
      const result = await TaskHandlers.batchClearTag(storage, authContext, {
        boardId,
        tag,
        taskIds
      })

      logger.info('[localStorageApi] batchClearTag result', { result })

      // Broadcast update
      deferredBroadcast('boards-updated', { sessionId: SESSION_ID, userType, boardId })

      logger.info('[localStorageApi] batchClearTag END')
    },

    // User Management (localStorage only - no-op for validation)
    async validateKey(key: string): Promise<boolean> {
      // For localStorage/public mode, keys are not validated
      // In development, reject obviously invalid keys for better UX
      if (!key || key.length < 10) {
        logger.warn('[localStorageApi] validateKey: Key too short (must be at least 10 characters)')
        return false
      }
      // Accept any key that's long enough (no real validation in public mode)
      return true
    },

    async setUserId(_newUserId: string): Promise<{ ok: boolean; message?: string }> {
      // For localStorage/public mode changes are handled by URL params
      return { ok: true }
    }
  }
}
