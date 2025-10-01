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
      const r = await fetch('/api/task')
      return r.json()
    },
    async getStats(): Promise<StatsFile> {
      const r = await fetch('/api/stats')
      return r.json()
    },
    async createTask(data: { title:string; tag?:string; project?:string }) {
      if (userType !== 'admin') {
        throw new Error('Only admin users can create tasks')
      }
      const r = await fetch('/api/task', { method:'POST', headers: adminHeaders(userType), body: JSON.stringify(data) })
      return r.json()
    },
    async patchTask(id: string, patch: any) {
      if (userType !== 'admin') {
        throw new Error('Only admin users can modify tasks')
      }
      const r = await fetch(`/api/task/${id}`, { method:'PATCH', headers: adminHeaders(userType), body: JSON.stringify(patch) })
      return r.json()
    },
    async deleteTask(id: string) {
      if (userType !== 'admin') {
        throw new Error('Only admin users can delete tasks')
      }
      const r = await fetch(`/api/task/${id}`, { method:'DELETE', headers: adminHeaders(userType) })
      return r.json()
    }
  }
}

// Legacy API for backward compatibility - defaults to public access
export const api = createApi('public')
