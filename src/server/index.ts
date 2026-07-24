/**
 * Task API - Framework-agnostic business logic
 *
 * This package exports pure functions that handle all task operations.
 * These functions can be used with any web framework (Express, Hono, Cloudflare Workers, etc.)
 * by providing a Storage implementation.
 *
 * Usage example:
 * ```typescript
 * import { TaskHandlers, TaskStorage } from '@hadoku/task/api'
 *
 * // Implement storage for your environment
 * const storage: TaskStorage = {
 *   getTasks: async (userType) => { ... },
 *   saveTasks: async (userType, tasks) => { ... },
 *   getStats: async (userType) => { ... },
 *   saveStats: async (userType, stats) => { ... }
 * }
 *
 * // Use the handlers
 * const auth = { userType: 'friend' }
 * const result = await TaskHandlers.createTask(storage, auth, { title: 'New task' })
 * ```
 */

export * as TaskHandlers from '../domain/handlers/handlers.js'
export * as TaskUtils from '../domain/utils/shared.js'
export type { Storage as TaskStorage } from './storage.js'

// Core Entity Types
export type {
  Task,
  TasksFile,
  Board,
  BoardsFile,
  StatsFile,
  UserType,
  ULID,
  Lane
} from '../domain/types.js'

// API Input/Output Types
export type {
  AuthContext,
  CreateTaskInput,
  UpdateTaskInput,
  UserPreferences
} from '../domain/types.js'

// Error Types (for HTTP status code handling)
export {
  DomainError,
  TaskNotFoundError,
  BoardNotFoundError,
  VersionConflictError,
  NotesTooLargeError,
  MAX_NOTES_BYTES,
  LaneNotEditableError,
  LaneInvalidError,
  BoardSchemaLockedError,
  ActivationDigestMismatchError,
  LaneSetInvalidError
} from '../domain/types.js'
