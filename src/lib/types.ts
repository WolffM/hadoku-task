/**
 * Server-side TypeScript types for Task Router
 * Contains both core domain types and server-infrastructure types
 */

// Core domain types
export type ULID = string;

export type UserType = 'public' | 'friend' | 'admin';

export interface Task {
  id: ULID;
  title: string;
  tag?: string | null;
  state: 'Active' | 'Deleted' | 'Completed';
  createdAt: string;         // ISO 8601
  updatedAt?: string | null; // ISO 8601
  closedAt?: string | null;  // ISO 8601
}

export interface TasksFile {
  version: 1;
  updatedAt: string;
  tasks: Task[];
}

export interface StatsTaskRecord {
  id: ULID;
  title: string;
  tag?: string | null;
  state: 'Active' | 'Deleted' | 'Completed';
  createdAt: string;
  updatedAt?: string | null;
  closedAt?: string | null;
}

export interface StatsFile {
  version: 2;
  updatedAt: string;
  counters: {
    created: number;
    completed: number;
    edited: number;
    deleted: number;
  };
  timeline: Array<{
    t: string;
    event: 'created' | 'completed' | 'edited' | 'deleted';
    id?: ULID;
  }>;
  // Persistent snapshot of every task ever seen (by id)
  tasks: Record<ULID, StatsTaskRecord>;
}

export interface AuthContext {
  userType: UserType;
}

export interface CreateTaskInput {
  title: string;
  tag?: string;
}

export interface UpdateTaskInput {
  title?: string;
  tag?: string;
}

// Server-infrastructure specific types
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

export interface SyncQueueItem {
  userType: string
  dataType: 'tasks' | 'stats'
  timestamp: number
}

export type DataType = 'tasks' | 'stats'
