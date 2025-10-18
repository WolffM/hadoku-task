/**
 * Client-only type definitions
 * Re-exports shared types from domain and adds client-specific types
 */

// Re-export all domain types (including UserPreferences which syncs to server)
export type {
  Task,
  TasksFile,
  Board,
  BoardsFile,
  StatsFile,
  StatsTaskRecord,
  ULID,
  UserType,
  AuthContext,
  CreateTaskInput,
  UpdateTaskInput,
  UserPreferences,
} from '../domain/types'

// Client-only types
export type ThemeName = 
  | 'light' 
  | 'dark'
  | 'strawberry-light' 
  | 'strawberry-dark'
  | 'ocean-light' 
  | 'ocean-dark'
  | 'cyberpunk-light' 
  | 'cyberpunk-dark'
  | 'coffee-light' 
  | 'coffee-dark'
  | 'lavender-light' 
  | 'lavender-dark'
  | 'pink-light'
  | 'pink-dark'
