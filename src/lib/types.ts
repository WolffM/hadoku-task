/**
 * Client-side types
 * Re-exports shared domain types from server/types.ts (single source of truth)
 * Adds client-specific types (UI preferences, etc.)
 */

// Re-export all shared domain types from server
export type {
  ULID,
  UserType,
  Task,
  TasksFile,
  Board,
  BoardsFile,
  StatsFile,
  StatsTaskRecord,
  AuthContext,
  CreateTaskInput,
  UpdateTaskInput
} from '../server/types.js';

// Client-specific types (UI preferences)
export type ThemeName = 'light' | 'dark' | 'strawberry' | 'ocean' | 'cyberpunk' | 'coffee' | 'lavender';

export interface UserPreferences {
  version: 1;
  updatedAt: string;
  theme: ThemeName;
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
