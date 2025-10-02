import type { TasksFile, StatsFile } from './types'

function adminHeaders(userType: string) {
  return {
    'Content-Type': 'application/json',
    'X-User-Type': userType
  }
}

export function createApi(userType: 'admin' | 'friend' | 'public' = 'public') {
  return {
    async getTasks(): Promise<TasksFile> {
      const r = await fetch(`/api/task?userType=${userType}`)
      return r.json()
    },
    async getStats(): Promise<StatsFile> {
      const r = await fetch(`/api/stats?userType=${userType}`)
      return r.json()
    },
    async createTask(data: { title:string; tag?:string }) {
      if (userType === 'public') {
        throw new Error('Public users cannot create tasks')
      }
      const r = await fetch('/api/task', { method:'POST', headers: adminHeaders(userType), body: JSON.stringify(data) })
      return r.json()
    },
    async patchTask(id: string, patch: any) {
      if (userType === 'public') {
        throw new Error('Public users cannot modify tasks')
      }
      const r = await fetch(`/api/task/${id}`, { method:'PATCH', headers: adminHeaders(userType), body: JSON.stringify(patch) })
      return r.json()
    },
    async completeTask(id: string) {
      if (userType === 'public') {
        throw new Error('Public users cannot complete tasks')
      }
      const r = await fetch(`/api/task/${id}/complete`, { method:'POST', headers: adminHeaders(userType) })
      return r.json()
    },
    async deleteTask(id: string) {
      if (userType === 'public') {
        throw new Error('Public users cannot delete tasks')
      }
      const r = await fetch(`/api/task/${id}`, { method:'DELETE', headers: adminHeaders(userType) })
      return r.json()
    },
    async clearPublicTasks() {
      if (userType !== 'public') {
        throw new Error('Only public users can clear tasks')
      }
      const r = await fetch('/api/task/clear', { method:'POST', headers: adminHeaders(userType) })
      return r.json()
    }
  }
}

// Legacy API for backward compatibility - defaults to public access
export const api = createApi('public')
