/**
 * Shared TypeScript types for Task application
 * Single source of truth for ALL domain types (used by both client and server)
 */

// Core domain types
export type ULID = string

// UserType is any string identifier
// "public" is special: localStorage-only, no server sync
// All others (friend, admin, custom names) sync to server
export type UserType = string

export interface Task {
  id: ULID
  title: string
  tag?: string | null
  state: 'Active' | 'Deleted' | 'Completed'
  createdAt: string // ISO 8601
  updatedAt?: string | null // ISO 8601 - when task was last modified (edit title/tag)
  closedAt?: string | null // ISO 8601 - when task was completed or deleted
  // Calendar scheduling (optional - tasks without `date` appear only in board view)
  // `date` is the canonical calendar-day membership key (local "YYYY-MM-DD").
  //   - date set, startTime/endTime null  => all-day "task for this day"
  //   - date + startTime + endTime         => timed task (date == local day of startTime)
  // Tasks carrying startTime/endTime are always backfilled with a matching `date`.
  date?: string | null // local calendar day, "YYYY-MM-DD"
  startTime?: string | null // ISO 8601 - scheduled start time
  endTime?: string | null // ISO 8601 - scheduled end time or deadline
}

export interface TasksFile {
  // Monotonic optimistic-concurrency version, bumped on every write.
  // Legacy blobs were written as the literal 1; widened to number so writes can increment.
  version: number
  updatedAt: string
  tasks: Task[]
}

// Board types (multi-board support)
export interface Board {
  id: string // boardId, e.g. "main", "work"
  name: string // display name
  tasks: Task[]
  // persistent list of known tags for this board (allows empty tag lists to remain)
  tags: string[]
  stats?: StatsFile
}

export interface BoardsFile {
  version: 1
  updatedAt: string
  boards: Board[]
}

export interface StatsFile {
  version: 2
  updatedAt: string
  counters: {
    created: number
    completed: number
    edited: number
    deleted: number
  }
  timeline: Array<{
    t: string
    event: 'created' | 'completed' | 'edited' | 'deleted'
    id?: ULID
  }>
  // Persistent snapshot of every task ever seen (by id)
  // Uses Task type directly to avoid duplication
  tasks: Record<ULID, Task>
}

export interface AuthContext {
  userType: UserType
  sessionId?: string
}

export interface CreateTaskInput {
  id?: string // Client-generated ID (optional, server will generate if not provided)
  title: string
  tag?: string
  createdAt?: string // Original creation timestamp (optional, for preserving when moving tasks)
  date?: string | null // local calendar day, "YYYY-MM-DD" (backfilled from startTime when omitted)
  startTime?: string | null // ISO 8601 - scheduled start time
  endTime?: string | null // ISO 8601 - scheduled end time or deadline
}

export interface UpdateTaskInput {
  title?: string
  tag?: string
  date?: string | null // local calendar day, "YYYY-MM-DD"
  startTime?: string | null // ISO 8601 - scheduled start time
  endTime?: string | null // ISO 8601 - scheduled end time or deadline
}

// User preferences (device-specific, stored in localStorage)
// These settings are device-specific (mobile vs desktop) and don't sync to server
export interface UserPreferences {
  version: 1
  updatedAt: string
  experimentalThemes?: boolean
  alwaysVerticalLayout?: boolean
  displayName?: string // Display name for user
  themeMode?: 'simple' | 'advanced' // Toggle the theme's advanced visuals
  // Device-specific settings (localStorage only)
  theme?: string
  showCompleteButton?: boolean
  showDeleteButton?: boolean
  showTagButton?: boolean
}

// --- Error Types ---

/**
 * Base error class for domain errors with HTTP status codes.
 * Consuming HTTP frameworks should catch these and return the appropriate status.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

/**
 * Error thrown when a task is not found.
 * HTTP status: 404 Not Found
 */
export class TaskNotFoundError extends DomainError {
  constructor(taskId?: string) {
    super(taskId ? `Task ${taskId} not found` : 'Task not found', 'TASK_NOT_FOUND', 404)
    this.name = 'TaskNotFoundError'
  }
}

/**
 * Error thrown when a board is not found.
 * HTTP status: 404 Not Found
 */
export class BoardNotFoundError extends DomainError {
  constructor(boardId: string) {
    super(`Board ${boardId} not found`, 'BOARD_NOT_FOUND', 404)
    this.name = 'BoardNotFoundError'
  }
}

/**
 * Error thrown when an optimistic-concurrency check fails: the client presented
 * an `If-Match` version that no longer matches the stored board version.
 * Carries the current version so the client can re-pull and retry.
 * HTTP status: 409 Conflict
 */
export class VersionConflictError extends DomainError {
  constructor(public readonly currentVersion: number) {
    super(`Version conflict: board has moved to version ${currentVersion}`, 'VERSION_CONFLICT', 409)
    this.name = 'VersionConflictError'
  }
}
