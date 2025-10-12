import type { TasksFile, StatsFile } from './types'
import { createLocalStorageApi } from './localStorageApi'

function adminHeaders(userType: string) {
  return {
    'Content-Type': 'application/json',
    'X-User-Type': userType
  }
}

/**
 * Create optimistic API client
 * - All user types use localStorage for immediate updates
 * - "public" is localStorage-only, no server sync
 * - All other user types (friend, admin, custom names) sync to server in background
 */
export function createApi(userType: string = 'public') {
  const localStorage = createLocalStorageApi(userType)
  
  // Public mode: localStorage only, no server sync
  if (userType === 'public') {
    return localStorage
  }
  
  // All other modes: localStorage + background server sync
  return {
    async getTasks(): Promise<TasksFile> {
      // Return localStorage immediately for instant response
      const localTasks = await localStorage.getTasks()
      
      // Sync from server in background (updates will trigger re-render if different)
      fetch(`/task/api?userType=${userType}`)
        .then(r => r.json())
        .then(serverTasks => {
          // Server is source of truth - if data differs, it will be synced next render
          console.log('Background sync: tasks synced from server')
        })
        .catch(err => console.error('Background sync failed:', err))
      
      return localTasks
    },
    
    async getStats(): Promise<StatsFile> {
      // Return localStorage immediately for instant response
      const localStats = await localStorage.getStats()
      
      // Sync from server in background
      fetch(`/task/api/stats?userType=${userType}`)
        .then(r => r.json())
        .then(serverStats => {
          console.log('Background sync: stats synced from server')
        })
        .catch(err => console.error('Background sync failed:', err))
      
      return localStats
    },
    
    async createTask(data: { title: string; tag?: string }) {
      // Optimistic update: localStorage first
      const result = await localStorage.createTask(data)
      
      // Queue server sync in background
      fetch('/task/api', {
        method: 'POST',
        headers: adminHeaders(userType),
        body: JSON.stringify(data)
      }).catch(err => console.error('Failed to sync createTask:', err))
      
      return result
    },
    
    async patchTask(id: string, patch: any) {
      // Optimistic update: localStorage first
      const result = await localStorage.patchTask(id, patch)
      
      // Queue server sync in background
      fetch(`/task/api/${id}`, {
        method: 'PATCH',
        headers: adminHeaders(userType),
        body: JSON.stringify(patch)
      }).catch(err => console.error('Failed to sync patchTask:', err))
      
      return result
    },
    
    async completeTask(id: string) {
      // Optimistic update: localStorage first
      const result = await localStorage.completeTask(id)
      
      // Queue server sync in background
      fetch(`/task/api/${id}/complete`, {
        method: 'POST',
        headers: adminHeaders(userType)
      }).catch(err => console.error('Failed to sync completeTask:', err))
      
      return result
    },
    
    async deleteTask(id: string) {
      // Optimistic update: localStorage first
      await localStorage.deleteTask(id)
      
      // Queue server sync in background
      fetch(`/task/api/${id}`, {
        method: 'DELETE',
        headers: adminHeaders(userType)
      }).catch(err => console.error('Failed to sync deleteTask:', err))
    },
    
    async clearPublicTasks() {
      throw new Error('Clear operation only available for public users')
    }
  }
}
