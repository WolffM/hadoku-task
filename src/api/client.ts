import type { TasksFile, StatsFile, BoardsFile, Task } from '../domain/types'
import { createLocalStorageApi } from './localStorageApi'

// Type for task updates (partial Task without id and createdAt)
type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt'>>

/**
 * Sync API boards data to localStorage
 * Updates localStorage to match server state for offline access and cross-tab consistency
 */
async function syncBoardsToLocalStorage(localApi: ReturnType<typeof createLocalStorageApi>, apiData: BoardsFile, userType: string, sessionId: string) {
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
  
  console.log('[api] Synced API data to localStorage:', { 
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
export function createApi(userType: 'public' | 'friend' | 'admin' = 'public', sessionId: string = 'public') {
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
      try {
        console.log('[api] Syncing from API...')
        const response = await fetch(`/task/api/boards?userType=${userType}&sessionId=${encodeURIComponent(sessionId)}`, {
          headers: adminHeaders(userType, sessionId)
        })
        
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`)
        }
        
        const apiData: BoardsFile = await response.json()
        
        // Validate response structure
        if (!apiData || !apiData.boards || !Array.isArray(apiData.boards)) {
          console.error('[api] Invalid response structure:', apiData)
          return
        }
        
        console.log('[api] Synced from API:', { boards: apiData.boards.length, totalTasks: apiData.boards.reduce((sum, b) => sum + (b.tasks?.length || 0), 0) })
        
        // Update localStorage with server state
        await syncBoardsToLocalStorage(localStorage, apiData, userType, sessionId)
      } catch (error) {
        console.error('[api] Sync from API failed:', error)
      }
    },
    
    async createTask(data: { title: string; tag?: string; id?: string; createdAt?: string }, boardId: string = 'main', suppressBroadcast: boolean = false) {
      // Create task optimistically with client-generated ID (or use provided ID for moves)
      const localTask = await localStorage.createTask(data, boardId, suppressBroadcast)
      
      // Send task to server WITH the client-generated ID so server uses same ID
      fetch('/task/api', {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ 
          id: data.id || localTask.id,  // Use provided ID (for moves) or client-generated ID
          ...data, 
          boardId 
        })
      })
        .then(r => r.json())
        .then((serverResponse: { ok: boolean; id: string }) => {
          if (serverResponse.ok) {
            if (serverResponse.id === localTask.id) {
              console.log('[api] Background sync: createTask completed (ID matched)')
            } else {
              console.warn('[api] Server returned different ID (unexpected):', { client: localTask.id, server: serverResponse.id })
            }
          }
        })
        .catch(err => console.error('[api] Failed to sync createTask:', err))
      
      return localTask
    },
    async createTag(tag: string, boardId: string = 'main') {
      const result = await localStorage.createTag(tag, boardId)
      // Background server sync
      fetch(`/task/api/tags`, {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId, tag })
      })
        .then(() => console.log('[api] Background sync: createTag completed'))
        .catch(err => console.error('[api] Failed to sync createTag:', err))
      return result
    },
    async deleteTag(tag: string, boardId: string = 'main') {
      const result = await localStorage.deleteTag(tag, boardId)
      // Background server sync
      fetch(`/task/api/tags/delete`, {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId, tag })
      })
        .then(() => console.log('[api] Background sync: deleteTag completed'))
        .catch(err => console.error('[api] Failed to sync deleteTag:', err))
      return result
    },
    
    async patchTask(id: string, patch: TaskPatch, boardId: string = 'main', suppressBroadcast: boolean = false) {
      const result = await localStorage.patchTask(id, patch, boardId, suppressBroadcast)
      // Background server sync
      fetch(`/task/api/${id}`, {
        method: 'PATCH',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ ...patch, boardId })
      })
        .then(() => console.log('[api] Background sync: patchTask completed'))
        .catch(err => console.error('[api] Failed to sync patchTask:', err))
      return result
    },
    
    async completeTask(id: string, boardId: string = 'main') {
      const result = await localStorage.completeTask(id, boardId)
      // Background server sync
      fetch(`/task/api/${id}/complete`, {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId })
      })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          console.log('[api] Background sync: completeTask completed')
        })
        .catch(err => console.error('[api] Failed to sync completeTask:', err))
      return result
    },
    
    async deleteTask(id: string, boardId: string = 'main', suppressBroadcast: boolean = false) {
      await localStorage.deleteTask(id, boardId, suppressBroadcast)
      // Background server sync
      fetch(`/task/api/${id}`, {
        method: 'DELETE',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId })
      })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          console.log('[api] Background sync: deleteTask completed')
        })
        .catch(err => console.error('[api] Failed to sync deleteTask:', err))
    },

    // Board operations
    async createBoard(boardId: string) {
      const result = await localStorage.createBoard(boardId)
      // Background server sync
      fetch('/task/api/boards', {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ id: boardId, name: boardId })
      })
        .then(() => console.log('[api] Background sync: createBoard completed'))
        .catch(err => console.error('[api] Failed to sync createBoard:', err))
      return result
    },

    async deleteBoard(boardId: string) {
      const result = await localStorage.deleteBoard(boardId)
      // Background server sync
      fetch(`/task/api/boards/${encodeURIComponent(boardId)}`, {
        method: 'DELETE',
        headers: adminHeaders(userType, sessionId)
      })
        .then(() => console.log('[api] Background sync: deleteBoard completed'))
        .catch(err => console.error('[api] Failed to sync deleteBoard:', err))
      return result
    },

    // User preferences
    async getPreferences() {
      // For non-public users, always fetch from server
      if (userType !== 'public') {
        try {
          const response = await fetch('/task/api/preferences', {
            headers: adminHeaders(userType, sessionId)
          })
          if (response.ok) {
            const serverPrefs = await response.json()
            console.log('[api] Fetched preferences from server:', serverPrefs)
            // Also save to localStorage for offline access
            await localStorage.savePreferences(serverPrefs)
            return serverPrefs
          }
        } catch (err) {
          console.warn('[api] Failed to fetch preferences from server, using localStorage:', err)
        }
      }
      
      // Fallback to localStorage (for public users or if server fails)
      return await localStorage.getPreferences()
    },

    async savePreferences(prefs: Partial<import('../domain/types').UserPreferences>) {
      // Always save to localStorage first (for immediate UI update)
      await localStorage.savePreferences(prefs)
      
      // For non-public users, sync to server
      if (userType !== 'public') {
        fetch('/task/api/preferences', {
          method: 'PUT',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify(prefs)
        })
          .then(() => console.log('[api] Background sync: savePreferences completed'))
          .catch(err => console.error('[api] Failed to sync savePreferences:', err))
      }
    },

    // Batch operations
    async batchUpdateTags(boardId: string, updates: Array<{ taskId: string; tag: string | null }>) {
      // 1. OPTIMISTIC: Update tags in localStorage
      await localStorage.batchUpdateTags(boardId, updates)
      
      // 2. BACKGROUND: Sync to server (fire-and-forget)
      fetch('/task/api/batch-tag', {
        method: 'PATCH',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId, updates })
      })
        .then(() => console.log('[api] Background sync: batchUpdateTags completed'))
        .catch(err => console.error('[api] Failed to sync batchUpdateTags:', err))
    },

    async batchMoveTasks(sourceBoardId: string, targetBoardId: string, taskIds: string[]) {
      // 1. OPTIMISTIC: Move tasks in localStorage
      const result = await localStorage.batchMoveTasks(sourceBoardId, targetBoardId, taskIds)
      
      // 2. BACKGROUND: Sync to server (fire-and-forget)
      fetch('/task/api/batch-move', {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ sourceBoardId, targetBoardId, taskIds })
      })
        .then(() => console.log('[api] Background sync: batchMoveTasks completed'))
        .catch(err => console.error('[api] Failed to sync batchMoveTasks:', err))
      
      return result
    },

    async batchClearTag(boardId: string, tag: string, taskIds: string[]) {
      // 1. OPTIMISTIC: Clear tag in localStorage
      await localStorage.batchClearTag(boardId, tag, taskIds)
      
      // 2. BACKGROUND: Sync to server (fire-and-forget)
      fetch('/task/api/batch-clear-tag', {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({ boardId, tag, taskIds })
      })
        .then(() => console.log('[api] Background sync: batchClearTag completed'))
        .catch(err => console.error('[api] Failed to sync batchClearTag:', err))
    },

    // User Management
    async validateKey(key: string): Promise<boolean> {
      try {
        const response = await fetch('/task/api/validate-key', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ key })
        })
        return response.ok
      } catch (err) {
        console.error('[api] Failed to validate key:', err)
        return false
      }
    }
  }
}
