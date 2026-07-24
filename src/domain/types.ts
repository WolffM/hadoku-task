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
  // Freeform markdown body / the plan (§6). Explicit column, not metadata, so it's
  // enforceable and editable from the UI and MCP. Size-capped (~64 KB) on write.
  notes?: string | null
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
  // External provider origin (calendar integrations). `source` + `sourceId` form an
  // idempotency key so an ingested event is created once and never duplicated/overwritten.
  // null source = locally created task.
  source?: string | null // provider id, e.g. "contact", "admin-mail", "gcal"
  sourceId?: string | null // the event id within that provider
  // Arbitrary provider-specific detail (who scheduled it, intro, meeting link, …).
  metadata?: Record<string, unknown> | null
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
  // Per-VIEWER board state (board_prefs, §7.2). `pinned` puts the board in the
  // top bar and the cold-load hydration set; `position` orders the pinned set.
  // Populated on read; a board with neither is an unpinned board reached via the
  // picker. Optional so pre-T2 payloads and the KV path stay valid.
  pinned?: boolean
  position?: number
  // Board type (§5.3): 'standard' (default, today's rendering) | 'automation'
  // (two-track vertical flow). Selects the BoardTypeConfig. Optional/absent ⇒
  // standard.
  mode?: string | null
  // Globally-unique opaque board reference (§7.1). Slugs (`id`) collide across
  // users — every user has a `main` — so the API disambiguates shared boards by
  // `handle`. Own boards may still be addressed by slug.
  handle?: string
  // Sharing (§7). Present on every board in a GET /boards response so a client
  // knows what it may offer before the user acts. `ownerUserId` is the board's
  // owner; `access` is THIS caller's level on it.
  ownerUserId?: string
  access?: 'owner' | 'contributor' | 'readonly'
}

export interface BoardsFile {
  // Monotonic optimistic-concurrency version for the board COLLECTION, bumped on
  // every board create/delete/reorder. Legacy blobs were written as the literal
  // 1; widened to number (like TasksFile.version) so board writes can increment
  // it and clients can present it as If-Match.
  version: number
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
  // The DATA scope: whose namespace this operation reads/writes. For own-board
  // access this is the caller; for a shared board it is resolved to the board's
  // OWNER (§7.1), so the 16 handler signatures + the Storage interface never
  // learn about sharing — only board resolution does.
  sessionId?: string
  // The AUTHORISATION identity: the authenticated key's userId, always the
  // caller regardless of whose data `sessionId` points at. Undefined ⇒ same as
  // sessionId (own-board access, the common path).
  callerId?: string
  // The caller's access level on the resolved board. Undefined ⇒ 'owner' (own
  // board). Routes gate writes on this without trusting the caller's word.
  access?: 'owner' | 'contributor' | 'readonly'
}

export interface CreateTaskInput {
  id?: string // Client-generated ID (optional, server will generate if not provided)
  title: string
  notes?: string | null // markdown body / the plan (§6)
  tag?: string
  createdAt?: string // Original creation timestamp (optional, for preserving when moving tasks)
  date?: string | null // local calendar day, "YYYY-MM-DD" (backfilled from startTime when omitted)
  startTime?: string | null // ISO 8601 - scheduled start time
  endTime?: string | null // ISO 8601 - scheduled end time or deadline
  // Calendar-integration origin. When source + sourceId are supplied, create is
  // idempotent on that pair (ingest-once): a re-send returns the existing task.
  source?: string | null
  sourceId?: string | null
  metadata?: Record<string, unknown> | null
}

export interface UpdateTaskInput {
  title?: string
  notes?: string | null // markdown body / the plan (§6)
  tag?: string
  date?: string | null // local calendar day, "YYYY-MM-DD"
  startTime?: string | null // ISO 8601 - scheduled start time
  endTime?: string | null // ISO 8601 - scheduled end time or deadline
  // source/sourceId are immutable (set once on create); metadata may be edited.
  metadata?: Record<string, unknown> | null
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

/**
 * Largest allowed size for a task's `notes` body, in bytes (UTF-8). ~64 KB — a
 * plan, not a log file (§6). Measured on the encoded string so multibyte content
 * can't slip past a length check.
 */
export const MAX_NOTES_BYTES = 64 * 1024

/**
 * Error thrown when a task's `notes` exceeds MAX_NOTES_BYTES.
 * HTTP status: 413 Payload Too Large
 */
export class NotesTooLargeError extends DomainError {
  constructor(public readonly bytes: number) {
    super(
      `Notes too large: ${bytes} bytes exceeds the ${MAX_NOTES_BYTES}-byte limit`,
      'NOTES_TOO_LARGE',
      413
    )
    this.name = 'NotesTooLargeError'
  }
}
