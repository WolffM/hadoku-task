import type { TasksFile, StatsFile } from './types'
import { createLocalStorageApi } from './localStorageApi'

function adminHeaders(userType: string) {
  return {
    'Content-Type': 'application/json',
    'X-User-Type': userType
  }
}

/**
 * Create API client - returns localStorage client for public mode, server API for admin/friend
 */
export function createApi(userType: 'admin' | 'friend' | 'public' = 'public') {
  // Public mode: browser-only, zero server interaction
  if (userType === 'public') {
    return createLocalStorageApi()
  }
  
  // Admin/Friend mode: use server API
  return {
    async getTasks(): Promise<TasksFile> {
      const r = await fetch(`/task/api?userType=${userType}`)
      return r.json()
    },
    async getStats(): Promise<StatsFile> {
      const r = await fetch(`/task/api/stats?userType=${userType}`)
      return r.json()
    },
    async createTask(data: { title:string; tag?:string }) {
      const r = await fetch('/task/api', { method:'POST', headers: adminHeaders(userType), body: JSON.stringify(data) })
      return r.json()
    },
    async patchTask(id: string, patch: any) {
      const r = await fetch(`/task/api/${id}`, { method:'PATCH', headers: adminHeaders(userType), body: JSON.stringify(patch) })
      return r.json()
    },
    async completeTask(id: string) {
      const r = await fetch(`/task/api/${id}/complete`, { method:'POST', headers: adminHeaders(userType) })
      return r.json()
    },
    async deleteTask(id: string) {
      const r = await fetch(`/task/api/${id}`, { method:'DELETE', headers: adminHeaders(userType) })
      return r.json()
    },
    async clearPublicTasks() {
      // This method only exists for backward compatibility
      // Admin/friend users cannot clear tasks via API
      throw new Error('Clear operation only available for public users')
    }
  }
}
