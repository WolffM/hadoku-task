import type { TasksFile, StatsFile } from './types'

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Key': localStorage.getItem('TASK_ADMIN_KEY') || ''
  }
}

export const api = {
  async getTasks(): Promise<TasksFile> {
    const r = await fetch('/api/task')
    return r.json()
  },
  async getStats(): Promise<StatsFile> {
    const r = await fetch('/api/stats')
    return r.json()
  },
  async createTask(data: { title:string; tag?:string; project?:string }) {
    const r = await fetch('/api/task', { method:'POST', headers: adminHeaders(), body: JSON.stringify(data) })
    return r.json()
  },
  async patchTask(id: string, patch: any) {
    const r = await fetch(`/api/task/${id}`, { method:'PATCH', headers: adminHeaders(), body: JSON.stringify(patch) })
    return r.json()
  },
  async deleteTask(id: string) {
    const r = await fetch(`/api/task/${id}`, { method:'DELETE', headers: adminHeaders() })
    return r.json()
  },
  // Called by your Settings UI after you paste keys
  async configureSW(cfg: {
    adminKey: string
    pat: string
    repoOwner: string
    repoName: string
    branch?: string
    tasksPath?: string
    statsPath?: string
  }) {
    const branch = cfg.branch || 'main'
    const tasks = cfg.tasksPath || 'task/data/tasks.json'
    const stats = cfg.statsPath  || 'task/data/stats.json'
    localStorage.setItem('TASK_ADMIN_KEY', cfg.adminKey)
    localStorage.setItem('TASK_GH_PAT', cfg.pat)
    const reg = await navigator.serviceWorker.ready
    reg.active?.postMessage({
      type: 'CONFIG',
      repoOwner: cfg.repoOwner,
      repoName: cfg.repoName,
      branch,
      dataPaths: { tasks, stats },
      adminKey: cfg.adminKey,
      githubPAT: cfg.pat
    })
  }
}
