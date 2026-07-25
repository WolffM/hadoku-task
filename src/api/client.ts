import type { TasksFile, BoardsFile, Task, CreateTaskInput } from '../domain/types'
import { createLocalStorageApi } from './localStorageApi'
import { formatError } from '../domain/utils/tags'
import { logger } from '@wolffm/logger/client'

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

    // Update tasks for this board (always write, even if empty - to clear completed tasks)
    const tasksKey = `${userType}-${sessionId}-${boardId}-tasks`
    const tasksFile: TasksFile = {
      version: 1,
      updatedAt: apiData.updatedAt || new Date().toISOString(),
      tasks: board.tasks || []
    }
    window.localStorage.setItem(tasksKey, JSON.stringify(tasksFile))

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

export type SyncErrorReporter = (operation: string, reason: 'http-error' | 'network') => void

/**
 * Fire-and-forget server sync with consistent logging
 * Used for optimistic updates where localStorage is source of truth
 */
function backgroundSync(
  url: string,
  options: globalThis.RequestInit,
  operation: string,
  context: Record<string, unknown>,
  onError?: SyncErrorReporter
): void {
  fetch(url, options)
    .then(r => {
      if (!r.ok) {
        logger.warn(`[api] ${operation}: Server sync returned error`, {
          status: r.status,
          ...context
        })
        onError?.(operation, 'http-error')
      } else {
        logger.info(`[api] ${operation}: Server sync completed`, context)
      }
      return r
    })
    .catch(err => {
      logger.error(`[api] ${operation}: Server sync failed`, {
        ...context,
        error: formatError(err)
      })
      onError?.(operation, 'network')
    })
}

/**
 * Create optimistic API client
 * - All user types use localStorage for immediate updates
 * - "public" is localStorage-only, no server sync
 * - All other user types (friend, admin, custom names) sync to server in background
 */
export interface CreateApiOptions {
  onSyncError?: SyncErrorReporter
}

export function createApi(
  userType: 'public' | 'friend' | 'admin' = 'public',
  sessionId: string = 'public',
  apiOptions: CreateApiOptions = {}
) {
  const localStorage = createLocalStorageApi(userType, sessionId)
  const onSyncError = apiOptions.onSyncError

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
            headers: adminHeaders(userType, sessionId),
            cache: 'no-store'
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
          error: formatError(error),
          durationMs: Math.round(duration)
        })
      }
    },

    async createTask(
      data: CreateTaskInput,
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
        .then(async r => {
          if (!r.ok) {
            logger.warn('[api] createTask: Server sync returned error', {
              status: r.status,
              taskId: localTask.id
            })
            onSyncError?.('createTask', 'http-error')
            return
          }
          const serverResponse = (await r.json()) as { ok: boolean; id: string }
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
            error: formatError(err)
          })
          onSyncError?.('createTask', 'network')
        })

      return localTask
    },
    async createTag(tag: string, boardId: string = 'main') {
      logger.info('[api] createTag: Starting', { tag, boardId })
      const result = await localStorage.createTag(tag, boardId)
      logger.info('[api] createTag: Created locally', { tag, boardId })

      backgroundSync(
        `/task/api/tags`,
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ boardId, tag })
        },
        'createTag',
        { tag, boardId },
        onSyncError
      )
      return result
    },
    async deleteTag(tag: string, boardId: string = 'main') {
      logger.info('[api] deleteTag: Starting', { tag, boardId })
      const result = await localStorage.deleteTag(tag, boardId)
      logger.info('[api] deleteTag: Deleted locally', { tag, boardId })

      backgroundSync(
        `/task/api/tags/delete`,
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ boardId, tag })
        },
        'deleteTag',
        { tag, boardId },
        onSyncError
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

      backgroundSync(
        `/task/api/${id}`,
        {
          method: 'PATCH',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ ...patch, boardId })
        },
        'patchTask',
        { taskId: id, boardId },
        onSyncError
      )
      return result
    },

    async completeTask(id: string, boardId: string = 'main') {
      logger.info('[api] completeTask: Starting', { taskId: id, boardId })
      const result = await localStorage.completeTask(id, boardId)
      logger.info('[api] completeTask: Completed locally', { taskId: id, boardId })

      // boardId must be passed as query parameter per OpenAPI spec
      const completeUrl = `/task/api/${id}/complete?boardId=${encodeURIComponent(boardId)}`
      backgroundSync(
        completeUrl,
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId)
        },
        'completeTask',
        { taskId: id, boardId },
        onSyncError
      )
      return result
    },

    async deleteTask(id: string, boardId: string = 'main', suppressBroadcast: boolean = false) {
      logger.info('[api] deleteTask: Starting', { taskId: id, boardId, suppressBroadcast })
      await localStorage.deleteTask(id, boardId, suppressBroadcast)
      logger.info('[api] deleteTask: Deleted locally', { taskId: id, boardId })

      // boardId must be passed as query parameter per OpenAPI spec
      const deleteUrl = `/task/api/${id}?boardId=${encodeURIComponent(boardId)}`
      backgroundSync(
        deleteUrl,
        {
          method: 'DELETE',
          headers: adminHeaders(userType, sessionId)
        },
        'deleteTask',
        { taskId: id, boardId },
        onSyncError
      )
    },

    // Board operations
    async createBoard(boardId: string) {
      logger.info('[api] createBoard: Starting', { boardId })
      const result = await localStorage.createBoard(boardId)
      logger.info('[api] createBoard: Created locally', { boardId })

      backgroundSync(
        '/task/api/boards',
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ id: boardId, name: boardId })
        },
        'createBoard',
        { boardId },
        onSyncError
      )
      return result
    },

    async deleteBoard(boardId: string) {
      logger.info('[api] deleteBoard: Starting', { boardId })
      const result = await localStorage.deleteBoard(boardId)
      logger.info('[api] deleteBoard: Deleted locally', { boardId })

      backgroundSync(
        `/task/api/boards/${encodeURIComponent(boardId)}`,
        {
          method: 'DELETE',
          headers: adminHeaders(userType, sessionId)
        },
        'deleteBoard',
        { boardId },
        onSyncError
      )
      return result
    },

    async renameBoard(boardId: string, name: string) {
      const result = await localStorage.renameBoard(boardId, name)
      backgroundSync(
        `/task/api/boards/${encodeURIComponent(boardId)}`,
        {
          method: 'PATCH',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ name })
        },
        'renameBoard',
        { boardId },
        onSyncError
      )
      return result
    },

    async setPinnedBoards(order: string[]) {
      const result = await localStorage.setPinnedBoards(order)
      backgroundSync(
        '/task/api/boards/pinned',
        {
          method: 'PUT',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ order })
        },
        'setPinnedBoards',
        { count: order.length },
        onSyncError
      )
      return result
    },

    // --- Board sharing (§7). These are server-only (no localStorage mirror). ---

    /** Autocomplete: live display names matching `q` (safe to expose). */
    async searchUsers(q: string): Promise<Array<{ name: string; tier?: string }>> {
      if (!q.trim()) return []
      try {
        const res = await fetch(`/task/api/users/search?q=${encodeURIComponent(q)}`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return []
        const data = (await res.json()) as { users?: Array<{ name: string; tier?: string }> }
        return data.users ?? []
      } catch {
        return []
      }
    },

    /** List a board's grantees (owner only), annotated with display name + tier. */
    async listShares(
      boardRef: string
    ): Promise<
      Array<{
        granteeUserId: string
        name?: string | null
        tier?: string | null
        level: string
        createdAt: string
      }>
    > {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}/shares`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return []
        const data = (await res.json()) as {
          shares?: Array<{
            granteeUserId: string
            name?: string | null
            tier?: string | null
            level: string
            createdAt: string
          }>
        }
        return data.shares ?? []
      } catch {
        return []
      }
    },

    /** Grant (or update) a share by display name. Returns the echo or an error. */
    async grantShare(
      boardRef: string,
      input: { name?: string; userId?: string; level: 'readonly' | 'contributor' }
    ): Promise<{
      ok: boolean
      error?: string
      granted?: { name: string | null; tier: string | null; level: string }
    }> {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}/shares`, {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify(input)
        })
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          granted?: { name: string | null; tier: string | null; level: string }
        }
        if (!res.ok) return { ok: false, error: data.error ?? `Error ${res.status}` }
        return { ok: true, granted: data.granted }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },

    /** Revoke a grantee's access (owner only). */
    async revokeShare(boardRef: string, granteeUserId: string): Promise<boolean> {
      try {
        const res = await fetch(
          `/task/api/boards/${encodeURIComponent(boardRef)}/shares/${encodeURIComponent(granteeUserId)}`,
          { method: 'DELETE', headers: adminHeaders(userType, sessionId) }
        )
        return res.ok
      } catch {
        return false
      }
    },

    /**
     * Activate (or preview) automation on a board (owner only, §5.4). Pass
     * `dryRun: true` for a preview + digest; echo that digest to commit. Returns
     * the raw result (preview/applied) or an error.
     */
    async activateAutomation(
      boardRef: string,
      payload: {
        lanes: unknown
        schemaId?: string | null
        schemaVersion?: number | null
        repo?: string | null
        dryRun?: boolean
        digest?: string
      }
    ): Promise<{ ok: boolean; error?: string; code?: string; result?: unknown }> {
      try {
        const res = await fetch(
          `/task/api/boards/${encodeURIComponent(boardRef)}/activate-automation`,
          {
            method: 'POST',
            headers: adminHeaders(userType, sessionId),
            body: JSON.stringify(payload)
          }
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
        if (!res.ok)
          return { ok: false, error: data.error ?? `Error ${res.status}`, code: data.code }
        return { ok: true, result: data }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },

    /** Deactivate automation, restoring the standard tag list (owner only). */
    async deactivateAutomation(boardRef: string): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await fetch(
          `/task/api/boards/${encodeURIComponent(boardRef)}/deactivate-automation`,
          {
            method: 'POST',
            headers: adminHeaders(userType, sessionId)
          }
        )
        if (!res.ok) return { ok: false, error: `Error ${res.status}` }
        return { ok: true }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },

    /** Validate a repo (owner/name) by probing GitHub through the worker. */
    async validateRepo(
      repo: string
    ): Promise<{
      repo: string
      valid: boolean
      reason: string
      private?: boolean
      defaultBranch?: string
      message?: string
    }> {
      try {
        const res = await fetch(`/task/api/repos/validate?repo=${encodeURIComponent(repo)}`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return { repo, valid: false, reason: 'error', message: `Error ${res.status}` }
        return (await res.json()) as {
          repo: string
          valid: boolean
          reason: string
          private?: boolean
          defaultBranch?: string
          message?: string
        }
      } catch {
        return { repo, valid: false, reason: 'error', message: 'Network error' }
      }
    },

    // User preferences moved to @wolffm/prefs-client (src/prefs/taskPrefs.ts).
    // The legacy GET/PUT /task/api/preferences path is gone from the client;
    // the worker route is retained for the 30d migration window (Tranche B).

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
      backgroundSync(
        '/task/api/batch-tag',
        {
          method: 'PATCH',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ boardId, updates })
        },
        'batchUpdateTags',
        { boardId, count: updates.length },
        onSyncError
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
      backgroundSync(
        '/task/api/batch-move',
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ sourceBoardId, targetBoardId, taskIds })
        },
        'batchMoveTasks',
        { sourceBoardId, targetBoardId, count: taskIds.length },
        onSyncError
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
      backgroundSync(
        '/task/api/batch-clear-tag',
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ boardId, tag, taskIds })
        },
        'batchClearTag',
        { boardId, tag, count: taskIds.length },
        onSyncError
      )
    },

    // User Management
    async validateKey(key: string): Promise<boolean> {
      logger.info('[api] validateKey: Starting')
      try {
        const response = await fetch('/task/api/validate-key', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Key': key
          }
        })
        const isValid = response.ok
        logger.info('[api] validateKey: Completed', { isValid })
        return isValid
      } catch (err) {
        logger.error('[api] validateKey: Failed', {
          error: formatError(err)
        })
        return false
      }
    }
  }
}
