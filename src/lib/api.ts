import type { TasksFile, StatsFile, BoardsFile } from './types'
import { createLocalStorageApi } from './localStorageApi'

function adminHeaders(userType: string, userId?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-User-Type': userType
  }
  if (userId) headers['X-User-Id'] = userId
  return headers
}

/**
 * Create optimistic API client
 * - All user types use localStorage for immediate updates
 * - "public" is localStorage-only, no server sync
 * - All other user types (friend, admin, custom names) sync to server in background
 */
export function createApi(userType: 'public' | 'friend' | 'admin' = 'public', userId: string = 'public') {
  const localStorage = createLocalStorageApi(userType, userId)
  
  // Public mode: localStorage only, no server sync
  if (userType === 'public') {
    return localStorage
  }
  
  // All other modes: localStorage + background server sync
  return {
    // Return all boards and tasks for this user. Local first, then background sync.
    async getBoards(): Promise<BoardsFile> {
      const local = await localStorage.getBoards()
      // Background sync
      fetch(`/task/api/boards?userType=${userType}&userId=${encodeURIComponent(userId)}`)
        .then(r => r.json())
        .then(() => console.log('[api] Background sync: getBoards completed'))
        .catch(err => console.error('[api] Background sync failed (getBoards):', err))
      return local
    },
    
    async getStats(boardId: string = 'main'): Promise<StatsFile> {
      const localStats = await localStorage.getStats(boardId)
      // Background sync
      fetch(`/task/api/stats?userType=${userType}&userId=${encodeURIComponent(userId)}&boardId=${encodeURIComponent(boardId)}`)
        .then(r => r.json())
        .then(() => console.log('[api] Background sync: getStats completed'))
        .catch(err => console.error('[api] Background sync failed (getStats):', err))
      return localStats
    },
    
    async createTask(data: { title: string; tag?: string }, boardId: string = 'main', suppressBroadcast: boolean = false) {
      const result = await localStorage.createTask(data, boardId, suppressBroadcast)
      // Background server sync
      fetch('/task/api', {
        method: 'POST',
        headers: adminHeaders(userType, userId),
        body: JSON.stringify({ ...data, boardId })
      })
        .then(() => console.log('[api] Background sync: createTask completed'))
        .catch(err => console.error('[api] Failed to sync createTask:', err))
      return result
    },
    async createTag(tag: string, boardId: string = 'main') {
      const result = await localStorage.createTag(tag, boardId)
      // Background server sync
      fetch(`/task/api/tags`, {
        method: 'POST',
        headers: adminHeaders(userType, userId),
        body: JSON.stringify({ boardId, tag })
      })
        .then(() => console.log('[api] Background sync: createTag completed'))
        .catch(err => console.error('[api] Failed to sync createTag:', err))
      return result
    },
    async deleteTag(tag: string, boardId: string = 'main') {
      const result = await localStorage.deleteTag(tag, boardId)
      // Background server sync
      fetch(`/task/api/tags`, {
        method: 'DELETE',
        headers: adminHeaders(userType, userId),
        body: JSON.stringify({ boardId, tag })
      })
        .then(() => console.log('[api] Background sync: deleteTag completed'))
        .catch(err => console.error('[api] Failed to sync deleteTag:', err))
      return result
    },
    
    async patchTask(id: string, patch: any, boardId: string = 'main', suppressBroadcast: boolean = false) {
      const result = await localStorage.patchTask(id, patch, boardId, suppressBroadcast)
      // Background server sync
      fetch(`/task/api/${id}`, {
        method: 'PATCH',
        headers: adminHeaders(userType, userId),
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
        headers: adminHeaders(userType, userId),
        body: JSON.stringify({ boardId })
      })
        .then(() => console.log('[api] Background sync: completeTask completed'))
        .catch(err => console.error('[api] Failed to sync completeTask:', err))
      return result
    },
    
    async deleteTask(id: string, boardId: string = 'main', suppressBroadcast: boolean = false) {
      await localStorage.deleteTask(id, boardId, suppressBroadcast)
      // Background server sync
      fetch(`/task/api/${id}`, {
        method: 'DELETE',
        headers: adminHeaders(userType, userId),
        body: JSON.stringify({ boardId })
      })
        .then(() => console.log('[api] Background sync: deleteTask completed'))
        .catch(err => console.error('[api] Failed to sync deleteTask:', err))
    },
    
    async clearPublicTasks() {
      throw new Error('Clear operation only available for public users')
    },

    // Board operations
    async createBoard(boardId: string) {
      const result = await localStorage.createBoard(boardId)
      // Background server sync
      fetch('/task/api/boards', {
        method: 'POST',
        headers: adminHeaders(userType, userId),
        body: JSON.stringify({ boardId })
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
        headers: adminHeaders(userType, userId)
      })
        .then(() => console.log('[api] Background sync: deleteBoard completed'))
        .catch(err => console.error('[api] Failed to sync deleteBoard:', err))
      return result
    },

    async getTasks(boardId: string = 'main') {
      const local = await localStorage.getTasks(boardId)
      // Background sync
      fetch(`/task/api/tasks?userType=${userType}&userId=${encodeURIComponent(userId)}&boardId=${encodeURIComponent(boardId)}`)
        .then(r => r.json())
        .then(() => console.log('[api] Background sync: getTasks completed'))
        .catch(err => console.error('[api] Background sync failed (getTasks):', err))
      return local
    }
  }
}
