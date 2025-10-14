/**
 * Server-side TypeScript types for Task Router
 * Contains both core domain types and server-infrastructure types
 */

// Core domain types
export type ULID = string;

// UserType is any string identifier
// "public" is special: localStorage-only, no server sync
// All others (friend, admin, custom names) sync to server
export type UserType = string;

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

// Board types
export interface Board {
  id: string; // boardId, e.g. "main", "work"
  name: string; // display name
  tasks: Task[];
  // persistent list of known tags for this board (allows empty tag lists to remain)
  tags?: string[];
  stats?: StatsFile;
}

export interface BoardsFile {
  version: 1;
  updatedAt: string;
  boards: Board[];
}

// User preferences
export type ThemeName = 'light' | 'dark' | 'strawberry' | 'ocean' | 'cyberpunk' | 'coffee' | 'lavender';

export interface UserPreferences {
  version: 1;
  updatedAt: string;
  theme: ThemeName;
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
  userId?: string;
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
