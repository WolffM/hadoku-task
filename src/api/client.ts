import type { TasksFile, BoardsFile, Task } from '../domain/types'
import { createLocalStorageApi } from './localStorageApi'
import { logger } from '@wolffm/task-ui-components'

// Type for task updates (partial Task without id and createdAt)
type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt'>>

// Helper for performance timing
function now(): number {
  if (
    typeof window !== 'undefined' &&
    window.performance &&
    typeof window.performance.now === 'function'
  ) {
    return window.performance.now()
  }
  return Date.now()
}

/**
 * Sync API boards data to localStorage
 * Updates localStorage to match server state for offline access and cross-tab consistency
 */
async function syncBoardsToLocalStorage(
  localApi: ReturnType<typeof createLocalStorageApi>,
  apiData: BoardsFile,
  userType: string,
  sessionId: string
) {
  // For each board in API response, update localStorage
  for (const board of apiData.boards || []) {
    const boardId = board.id

    // Update tasks for this board
    if (board.tasks && board.tasks.length > 0) {
      const tasksKey = `${userType}-${sessionId}-${boardId}-tasks`
      const tasksFile: TasksFile = {
        version: 1,
        updatedAt: apiData.updatedAt || new Date().toISOString(),
        tasks: board.tasks
      }
      window.localStorage.setItem(tasksKey, JSON.stringify(tasksFile))
    }

    // Update stats for this board if present
    if (board.stats) {
      const statsKey = `${userType}-${sessionId}-${boardId}-stats`
      window.localStorage.setItem(statsKey, JSON.stringify(board.stats))
    }
  }

  // Update boards index
  const boardsKey = `${userType}-${sessionId}-boards`
  const boardsIndex = {
    version: 1,
    updatedAt: apiData.updatedAt || new Date().toISOString(),
    boards: (apiData.boards || []).map(b => ({
      id: b.id,
      name: b.name,
      tags: b.tags || []
    }))
  }
  window.localStorage.setItem(boardsKey, JSON.stringify(boardsIndex))

  logger.info('[api] Synced API data to localStorage', {
    boards: apiData.boards?.length || 0,
    totalTasks: apiData.boards?.reduce((sum, b) => sum + (b.tasks?.length || 0), 0) || 0
  })
}

function adminHeaders(userType: string, sessionId?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-User-Type': userType
  }
  if (sessionId) headers['X-Session-Id'] = sessionId
  return headers
}

/**
 * Create optimistic API client
 * - All user types use localStorage for immediate updates
 * - "public" is localStorage-only, no server sync
 * - All other user types (friend, admin, custom names) sync to server in background
 */
export function createApi(
  userType: 'public' | 'friend' | 'admin' = 'public',
  sessionId: string = 'public'
) {
  const localStorage = createLocalStorageApi(userType, sessionId)

  // Public mode: localStorage only, no server sync
  if (userType === 'public') {
    return localStorage
  }

  // All other modes: Optimistic localStorage with explicit API sync on initial load only
  return {
    // Get boards - returns localStorage immediately (optimistic)
    async getBoards(): Promise<BoardsFile> {
      return await localStorage.getBoards()
    },

    // Sync from API - called once on initial page load to get server state
    async syncFromApi(): Promise<void> {
      const startTime = now()
      try {
        logger.info('[api] syncFromApi: Starting API sync...', { userType, sessionId })
        const response = await fetch(
          `/task/api/boards?userType=${userType}&sessionId=${encodeURIComponent(sessionId)}`,
          {
            headers: adminHeaders(userType, sessionId)
          }
        )

        if (!response.ok) {
          logger.error('[api] syncFromApi: API returned error', {
            status: response.status,
            statusText: response.statusText
          })
          throw new Error(`API returned ${response.status}`)
        }

        const apiData: BoardsFile = await response.json()

        // Validate response structure
        if (!apiData || !apiData.boards || !Array.isArray(apiData.boards)) {
          logger.error('[api] syncFromApi: Invalid response structure', { apiData })
          return
        }

        const duration = now() - startTime
        logger.info('[api] syncFromApi: Successfully synced from API', {
          boards: apiData.boards.length,
          totalTasks: apiData.boards.reduce((sum, b) => sum + (b.tasks?.length || 0), 0),
          durationMs: Math.round(duration)
        })

        // Update localStorage with server state
        await syncBoardsToLocalStorage(localStorage, apiData, userType, sessionId)
      } catch (error) {
        const duration = now() - startTime
        logger.error('[api] syncFromApi: Sync from API failed', {
          error: error instanceof Error ? error.message : String(error),
          durationMs: Math.round(duration)
        })
      }
    },

    async createTask(
      data: { title: string; tag?: string; id?: string; createdAt?: string },
      boardId: string = 'main',
      suppressBroadcast: boolean = false
    ) {
      logger.info('[api] createTask: Starting', {
        title: data.title,
        boardId,
        hasTag: !!data.tag,
        suppressBroadcast
      })

      // Create task optimistically with client-generated ID (or use provided ID for moves)
      const localTask = await localStorage.createTask(data, boardId, suppressBroadcast)

      logger.info('[api] createTask: Created locally', { taskId: localTask.id, boardId })

      // Send task to server WITH the client-generated ID so server uses same ID
      fetch('/task/api', {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({
          id: data.id || localTask.id, // Use provided ID (for moves) or client-generated ID
          ...data,
          boardId
        })
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] createTask: Server sync returned error', {
              status: r.status,
              taskId: localTask.id
            })
          }
          return r.json()
        })
        .then((serverResponse: { ok: boolean; id: string }) => {
          if (serverResponse.ok) {
            if (serverResponse.id === localTask.id) {
              logger.info('[api] createTask: Server sync completed', { taskId: localTask.id })
            } else {
              logger.warn('[api] createTask: Server returned different ID (unexpected)', {
                clientId: localTask.id,
                serverId: serverResponse.id
              })
            }
          }
        })
        .catch(err => {
          logger.error('[api] createTask: Server sync failed', {
            taskId: localTask.id,
            error: err instanceof Error ? err.message : String(err)
          })
        })

      return localTask
    },
    async createTag(tag: string, boardId: string = 'main') {
      logger.info('[api] createTag: Starting', { tag, boardId })
      const result = await localStorage.createTag(tag, boardId)
      logger.info('[api] createTag: Created locally', { tag, boardId })

      // Background server sync
      fetch(`/task/api/tags`, {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId, tag })
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] createTag: Server sync returned error', {
              status: r.status,
              tag
            })
          }
          return r
        })
        .then(() => logger.info('[api] createTag: Server sync completed', { tag, boardId }))
        .catch(err =>
          logger.error('[api] createTag: Server sync failed', {
            tag,
            boardId,
            error: err instanceof Error ? err.message : String(err)
          })
        )
      return result
    },
    async deleteTag(tag: string, boardId: string = 'main') {
      logger.info('[api] deleteTag: Starting', { tag, boardId })
      const result = await localStorage.deleteTag(tag, boardId)
      logger.info('[api] deleteTag: Deleted locally', { tag, boardId })

      // Background server sync
      fetch(`/task/api/tags/delete`, {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId, tag })
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] deleteTag: Server sync returned error', {
              status: r.status,
              tag
            })
          }
          return r
        })
        .then(() => logger.info('[api] deleteTag: Server sync completed', { tag, boardId }))
        .catch(err =>
          logger.error('[api] deleteTag: Server sync failed', {
            tag,
            boardId,
            error: err instanceof Error ? err.message : String(err)
          })
        )
      return result
    },

    async patchTask(
      id: string,
      patch: TaskPatch,
      boardId: string = 'main',
      suppressBroadcast: boolean = false
    ) {
      logger.info('[api] patchTask: Starting', {
        taskId: id,
        boardId,
        patch: Object.keys(patch),
        suppressBroadcast
      })

      const result = await localStorage.patchTask(id, patch, boardId, suppressBroadcast)
      logger.info('[api] patchTask: Patched locally', { taskId: id, boardId })

      // Background server sync
      fetch(`/task/api/${id}`, {
        method: 'PATCH',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ ...patch, boardId })
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] patchTask: Server sync returned error', {
              status: r.status,
              taskId: id
            })
          }
          return r
        })
        .then(() => logger.info('[api] patchTask: Server sync completed', { taskId: id, boardId }))
        .catch(err =>
          logger.error('[api] patchTask: Server sync failed', {
            taskId: id,
            boardId,
            error: err instanceof Error ? err.message : String(err)
          })
        )
      return result
    },

    async completeTask(id: string, boardId: string = 'main') {
      logger.info('[api] completeTask: Starting', { taskId: id, boardId })
      const result = await localStorage.completeTask(id, boardId)
      logger.info('[api] completeTask: Completed locally', { taskId: id, boardId })

      // Background server sync
      fetch(`/task/api/${id}/complete`, {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId })
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] completeTask: Server sync returned error', {
              status: r.status,
              taskId: id
            })
            throw new Error(`HTTP ${r.status}`)
          }
          logger.info('[api] completeTask: Server sync completed', { taskId: id, boardId })
        })
        .catch(err =>
          logger.error('[api] completeTask: Server sync failed', {
            taskId: id,
            boardId,
            error: err instanceof Error ? err.message : String(err)
          })
        )
      return result
    },

    async deleteTask(id: string, boardId: string = 'main', suppressBroadcast: boolean = false) {
      logger.info('[api] deleteTask: Starting', { taskId: id, boardId, suppressBroadcast })
      await localStorage.deleteTask(id, boardId, suppressBroadcast)
      logger.info('[api] deleteTask: Deleted locally', { taskId: id, boardId })

      // Background server sync
      fetch(`/task/api/${id}`, {
        method: 'DELETE',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId })
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] deleteTask: Server sync returned error', {
              status: r.status,
              taskId: id
            })
            throw new Error(`HTTP ${r.status}`)
          }
          logger.info('[api] deleteTask: Server sync completed', { taskId: id, boardId })
        })
        .catch(err =>
          logger.error('[api] deleteTask: Server sync failed', {
            taskId: id,
            boardId,
            error: err instanceof Error ? err.message : String(err)
          })
        )
    },

    // Board operations
    async createBoard(boardId: string) {
      logger.info('[api] createBoard: Starting', { boardId })
      const result = await localStorage.createBoard(boardId)
      logger.info('[api] createBoard: Created locally', { boardId })

      // Background server sync
      fetch('/task/api/boards', {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ id: boardId, name: boardId })
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] createBoard: Server sync returned error', {
              status: r.status,
              boardId
            })
          }
          return r
        })
        .then(() => logger.info('[api] createBoard: Server sync completed', { boardId }))
        .catch(err =>
          logger.error('[api] createBoard: Server sync failed', {
            boardId,
            error: err instanceof Error ? err.message : String(err)
          })
        )
      return result
    },

    async deleteBoard(boardId: string) {
      logger.info('[api] deleteBoard: Starting', { boardId })
      const result = await localStorage.deleteBoard(boardId)
      logger.info('[api] deleteBoard: Deleted locally', { boardId })

      // Background server sync
      fetch(`/task/api/boards/${encodeURIComponent(boardId)}`, {
        method: 'DELETE',
        headers: adminHeaders(userType, sessionId)
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] deleteBoard: Server sync returned error', {
              status: r.status,
              boardId
            })
          }
          return r
        })
        .then(() => logger.info('[api] deleteBoard: Server sync completed', { boardId }))
        .catch(err =>
          logger.error('[api] deleteBoard: Server sync failed', {
            boardId,
            error: err instanceof Error ? err.message : String(err)
          })
        )
      return result
    },

    // User preferences
    async getPreferences() {
      logger.info('[api] getPreferences: Starting', { userType })

      // For non-public users, always fetch from server to ensure sync across devices/tabs
      if (userType !== 'public') {
        try {
          const response = await fetch('/task/api/preferences', {
            headers: adminHeaders(userType, sessionId)
          })
          if (response.ok) {
            const serverPrefs = await response.json()
            logger.info('[api] getPreferences: Fetched from server', {
              hasPrefs: !!serverPrefs,
              keys: serverPrefs ? Object.keys(serverPrefs) : []
            })
            // Also save to localStorage for offline access and instant local updates
            await localStorage.savePreferences(serverPrefs)
            return serverPrefs
          } else {
            logger.warn('[api] getPreferences: Server returned error', { status: response.status })
          }
        } catch (err) {
          logger.warn('[api] getPreferences: Server fetch failed, using localStorage', {
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }

      // Fallback to localStorage (for public users or if server fails)
      const localPrefs = await localStorage.getPreferences()
      logger.info('[api] getPreferences: Using localStorage', {
        hasPrefs: !!localPrefs,
        isPublic: userType === 'public'
      })
      return localPrefs
    },

    async savePreferences(prefs: Partial<import('../domain/types').UserPreferences>) {
      logger.info('[api] savePreferences: Starting', {
        userType,
        keys: Object.keys(prefs)
      })

      // ALWAYS save to localStorage first for instant UI update
      // This ensures responsive UI even if server sync is slow/fails
      await localStorage.savePreferences(prefs)
      logger.info('[api] savePreferences: Saved to localStorage')

      // For non-public users, sync to server in background
      // This enables cross-device/tab sync via getPreferences()
      if (userType !== 'public') {
        fetch('/task/api/preferences', {
          method: 'PUT',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify(prefs)
        })
          .then(r => {
            if (!r.ok) {
              logger.warn('[api] savePreferences: Server sync returned error', {
                status: r.status
              })
            }
            return r
          })
          .then(() => logger.info('[api] savePreferences: Server sync completed'))
          .catch(err =>
            logger.error('[api] savePreferences: Server sync failed', {
              error: err instanceof Error ? err.message : String(err)
            })
          )
      }
    },

    // Batch operations
    async batchUpdateTags(boardId: string, updates: Array<{ taskId: string; tag: string | null }>) {
      logger.info('[api] batchUpdateTags: Starting', {
        boardId,
        count: updates.length
      })

      // 1. OPTIMISTIC: Update tags in localStorage
      await localStorage.batchUpdateTags(boardId, updates)
      logger.info('[api] batchUpdateTags: Updated locally', { boardId, count: updates.length })

      // 2. BACKGROUND: Sync to server (fire-and-forget)
      fetch('/task/api/batch-tag', {
        method: 'PATCH',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId, updates })
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] batchUpdateTags: Server sync returned error', {
              status: r.status,
              boardId,
              count: updates.length
            })
          }
          return r
        })
        .then(() =>
          logger.info('[api] batchUpdateTags: Server sync completed', {
            boardId,
            count: updates.length
          })
        )
        .catch(err =>
          logger.error('[api] batchUpdateTags: Server sync failed', {
            boardId,
            count: updates.length,
            error: err instanceof Error ? err.message : String(err)
          })
        )
    },

    async batchMoveTasks(sourceBoardId: string, targetBoardId: string, taskIds: string[]) {
      logger.info('[api] batchMoveTasks: Starting', {
        sourceBoardId,
        targetBoardId,
        count: taskIds.length
      })

      // 1. OPTIMISTIC: Move tasks in localStorage
      const result = await localStorage.batchMoveTasks(sourceBoardId, targetBoardId, taskIds)
      logger.info('[api] batchMoveTasks: Moved locally', {
        sourceBoardId,
        targetBoardId,
        count: taskIds.length
      })

      // 2. BACKGROUND: Sync to server (fire-and-forget)
      fetch('/task/api/batch-move', {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ sourceBoardId, targetBoardId, taskIds })
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] batchMoveTasks: Server sync returned error', {
              status: r.status,
              sourceBoardId,
              targetBoardId,
              count: taskIds.length
            })
          }
          return r
        })
        .then(() =>
          logger.info('[api] batchMoveTasks: Server sync completed', {
            sourceBoardId,
            targetBoardId,
            count: taskIds.length
          })
        )
        .catch(err =>
          logger.error('[api] batchMoveTasks: Server sync failed', {
            sourceBoardId,
            targetBoardId,
            count: taskIds.length,
            error: err instanceof Error ? err.message : String(err)
          })
        )

      return result
    },

    async batchClearTag(boardId: string, tag: string, taskIds: string[]) {
      logger.info('[api] batchClearTag: Starting', {
        boardId,
        tag,
        count: taskIds.length
      })

      // 1. OPTIMISTIC: Clear tag in localStorage
      await localStorage.batchClearTag(boardId, tag, taskIds)
      logger.info('[api] batchClearTag: Cleared locally', { boardId, tag, count: taskIds.length })

      // 2. BACKGROUND: Sync to server (fire-and-forget)
      fetch('/task/api/batch-clear-tag', {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId, tag, taskIds })
      })
        .then(r => {
          if (!r.ok) {
            logger.warn('[api] batchClearTag: Server sync returned error', {
              status: r.status,
              boardId,
              tag,
              count: taskIds.length
            })
          }
          return r
        })
        .then(() =>
          logger.info('[api] batchClearTag: Server sync completed', {
            boardId,
            tag,
            count: taskIds.length
          })
        )
        .catch(err =>
          logger.error('[api] batchClearTag: Server sync failed', {
            boardId,
            tag,
            count: taskIds.length,
            error: err instanceof Error ? err.message : String(err)
          })
        )
    },

    // User Management
    async validateKey(key: string): Promise<boolean> {
      logger.info('[api] validateKey: Starting')
      try {
        const response = await fetch('/task/api/validate-key', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ key })
        })
        const isValid = response.ok
        logger.info('[api] validateKey: Completed', { isValid })
        return isValid
      } catch (err) {
        logger.error('[api] validateKey: Failed', {
          error: err instanceof Error ? err.message : String(err)
        })
        return false
      }
    },

    async updateUserName(userName: string): Promise<{ success: boolean; error?: string }> {
      logger.info('[api] updateUserName: Starting', { userName })
      try {
        const response = await fetch('/task/api/user/name', {
          method: 'PUT',
          headers: {
            ...adminHeaders(userType, sessionId),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ userName })
        })

        if (response.ok) {
          logger.info('[api] updateUserName: Success')
          return { success: true }
        } else {
          const errorText = await response.text()
          logger.warn('[api] updateUserName: Server returned error', {
            status: response.status,
            error: errorText
          })
          return {
            success: false,
            error: errorText || `Server error: ${response.status}`
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.error('[api] updateUserName: Failed', { error: errorMsg })
        return {
          success: false,
          error: `Failed to update name: ${errorMsg}`
        }
      }
    }
  }
}
