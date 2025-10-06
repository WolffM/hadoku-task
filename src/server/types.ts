/**
 * Server-side TypeScript types for Task Router
 */

export interface RouterConfig {
  dataPath: string
  githubConfig?: GitHubConfig
}

export interface GitHubConfig {
  owner: string
  repo: string
  branch: string
  token: string
}

export interface Task {
  id: string
  title: string
  tag: string | null
  state: 'Active' | 'Completed' | 'Deleted'
  createdAt: string
  updatedAt?: string
  closedAt?: string
}

export interface TasksFile {
  version: number
  tasks: Task[]
  updatedAt: string
}

export interface TimelineEvent {
  t: string
  event: 'create' | 'edit' | 'complete' | 'completed' | 'deleted'
  id: string
}

export interface TaskRecord {
  id: string
  title: string
  tag: string | null
  state: string
  createdAt: string
  updatedAt: string | null
  closedAt: string | null
}

export interface StatsFile {
  version: number
  counters: {
    created: number
    completed: number
    edited: number
    deleted: number
  }
  timeline: TimelineEvent[]
  tasks: Record<string, TaskRecord>
  updatedAt: string
}

export interface SyncQueueItem {
  userType: string
  dataType: 'tasks' | 'stats'
  timestamp: number
}

export type UserType = 'public' | 'friend' | 'admin'
export type DataType = 'tasks' | 'stats'
