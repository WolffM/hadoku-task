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

// One tag per task. The handlers apply this to everything that writes through
// them; it is exported because the agent-claim routes write `tag` with direct
// SQL and must apply the identical rule rather than a lookalike.
export { normalizeTag } from '../domain/utils/tags.js'

// The plan-notes predicates. Exported because the WORKER needs them: the runner
// wake (autoland v3 §5.1) fires on a notes write that closes an open question,
// and it must use the same `questionsAnswered` the card badge does — a lookalike
// in the route layer is how the two would drift.
export {
  parsePlanNotes,
  questionsSection,
  openQuestionCount,
  questionsAnswered,
  appendAnswerToNotes,
  checklistItems,
  toggleChecklistItem,
  pendingApproval
} from '../domain/planNotes.js'
export type { PlanSection, ChecklistItem } from '../domain/planNotes.js'

// The `ifNotesHash` digest (autoland v3 §5.2). Exported so a consumer hashing
// notes to guard a release uses the same definition the server compares against.
export { notesHash, EMPTY_NOTES_HASH } from '../domain/utils/notesHash.js'

// Task lifecycle: ONE definition of "still on the board", shared by every
// storage backend. The D1 adapter expresses it in SQL for perf, the localStorage
// adapter applies isVisible() in JS — but the window is defined here, once.
export {
  COMPLETED_WINDOW_MS,
  completedCutoff,
  isVisible,
  isRecentlyCompleted
} from '../domain/utils/lifecycle.js'

// Core Entity Types
export type {
  Task,
  TasksFile,
  Board,
  BoardsFile,
  StatsFile,
  StatsEventType,
  UserType,
  ULID,
  Lane,
  TaskStatus,
  TaskStatusKind
} from '../domain/types.js'

// Task status (autoland v3 §3.1): the closed `kind` set, its validator, and the
// stored-column parser. A generic board primitive — "an agent reports status on
// a task" — not one pipeline's metadata key.
export {
  TASK_STATUS_KINDS,
  MAX_STATUS_LABEL_LENGTH,
  normalizeTaskStatus,
  parseStoredStatus
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
  assertNotesWithinLimit,
  LaneNotEditableError,
  LaneInvalidError,
  BoardSchemaLockedError,
  ActivationDigestMismatchError,
  LaneSetInvalidError,
  ClaimHeldError,
  LeaseLostError,
  LaneUnknownError,
  LaneChangedError,
  NotesChangedError,
  TaskStatusInvalidError
} from '../domain/types.js'
