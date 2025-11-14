/**
 * Client-only type definitions
 * Re-exports shared types from domain and adds client-specific types
 * Updated: 2025-10-27
 */

// Re-export all domain types (including UserPreferences which syncs to server)
export type {
  Task,
  TasksFile,
  Board,
  BoardsFile,
  StatsFile,
  ULID,
  UserType,
  AuthContext,
  CreateTaskInput,
  UpdateTaskInput,
  UserPreferences
} from '../domain/types'

// Client-only types
export type ThemeName =
  | 'light'
  | 'dark'
  | 'coffee-light'
  | 'coffee-dark'
  | 'nature-light'
  | 'nature-dark'
  | 'lavender-light'
  | 'lavender-dark'
  | 'strawberry-light'
  | 'strawberry-dark'
  | 'ocean-light'
  | 'ocean-dark'
  | 'cyberpunk-light'
  | 'cyberpunk-dark'
  | 'pink-light'
  | 'pink-dark'
  | 'izakaya-light'
  | 'izakaya-dark'
