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

/**
 * One lane in an automation board's fixed vocabulary (§5.1). Exactly four fields
 * are interpreted; any other keys a provider hangs off a lane are preserved
 * verbatim and handed back untouched (`additionalProperties: true`).
 */
export interface Lane {
  /** The literal tag written on a task in this lane. Unique within the board. */
  tag: string
  /** Display name for the section. */
  label: string
  /** Fixed render position; never frequency-ranked. */
  order: number
  /** Who may move a task into/out of this lane — the guarantee (§5.2). */
  editableBy: 'user' | 'agent'
  /** Provider-specific extras, stored + returned verbatim. */
  [key: string]: unknown
}

/**
 * A lane contract a provider publishes, fetched live by the worker (§5.4) so the
 * activation UI offers the provider's CURRENT schema instead of a JSON blob a
 * human pasted at some point. Hands straight to `activateAutomation`.
 */
export interface AutomationPreset {
  providerId: string
  providerLabel: string
  schemaId: string
  schemaVersion: number | null
  label: string
  description: string | null
  lanes: Lane[]
}

/**
 * The provider has published a newer contract than this board was activated from
 * (§5.5). Advisory: the owner still drives the activation handshake, this only
 * says there is something worth offering. Absent when the board is current, isn't
 * an automation board, or is being read by someone who couldn't activate it.
 */
export interface PresetUpdate {
  providerId: string
  providerLabel: string
  schemaId: string
  /** What the provider publishes now — the version to activate up to. */
  schemaVersion: number
  label: string
  description: string | null
  /** Applying it would move no task. False ⇒ a real migration, show the preview. */
  safe: boolean
  /** Active tasks that would be cleared to the Inbox (0 when `safe`). */
  toInbox: number
}

/** Per-provider fetch outcome, so the picker can tell "no presets exist" apart
 * from "the provider is down and these are the lanes we last saw". */
export interface PresetSourceStatus {
  id: string
  label: string
  url: string
  ok: boolean
  count: number
  cached?: boolean
  notModified?: boolean
  stale?: boolean
  error?: string
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
  // Automation lane set (§5.1). Present (non-null) only on automation boards;
  // the provider's ordered lane vocabulary, stored + returned verbatim.
  lanes?: Lane[] | null
  // Which repo/checkout this board drives (§5.5). Automation boards only.
  repo?: string | null
  // The provider's opaque contract labels (§5.1) — stored verbatim, never keys
  // into any registry of ours. Present on automation boards.
  schemaId?: string | null
  schemaVersion?: number | null
  // Globally-unique opaque board reference (§7.1). Slugs (`id`) collide across
  // users — every user has a `main` — so the API disambiguates shared boards by
  // `handle`. Own boards may still be addressed by slug.
  handle?: string
  // Sharing (§7). Present on every board in a GET /boards response so a client
  // knows what it may offer before the user acts. `ownerUserId` is the board's
  // owner; `access` is THIS caller's level on it.
  ownerUserId?: string
  access?: 'owner' | 'contributor' | 'readonly'
  // Who this board is shared WITH, annotated with display name + tier. Hydrated
  // by GET /boards for boards this viewer OWNS (only an owner may see a board's
  // grantees), so the share UI renders the list immediately instead of fetching
  // per board when a panel opens. Absent ⇒ not hydrated (the panel then fetches).
  shares?: BoardShare[]
}

/** A grantee on a board, as surfaced to the share UI. */
export interface BoardShare {
  granteeUserId: string
  level: string
  createdAt: string
  name?: string | null
  tier?: string | null
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

/** Every event the stats timeline can carry. See StatsFile.timeline. */
export type StatsEventType = 'created' | 'completed' | 'edited' | 'deleted' | 'uncompleted'

export interface StatsFile {
  version: 2
  updatedAt: string
  counters: {
    created: number
    completed: number
    edited: number
    deleted: number
  }
  // `uncompleted` is the ✓-toggle undoing a completion. It is a timeline event
  // but NOT a counter: `counters.completed` is the NET count, so a
  // complete/uncomplete/complete cycle reads as one completion, not two.
  timeline: Array<{
    t: string
    event: StatsEventType
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

/**
 * UTF-8 byte length of a string, computed without TextEncoder so this stays in
 * the environment-agnostic domain layer. Counts a surrogate pair (one astral
 * codepoint) as its 4 encoded bytes.
 */
function utf8ByteLength(s: string): number {
  let bytes = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4
      i++ // consume the low surrogate
    } else bytes += 3
  }
  return bytes
}

/**
 * Reject a `notes` body over MAX_NOTES_BYTES (§6). Measured on the UTF-8 byte
 * length so multibyte content can't slip past. null/undefined = no notes.
 *
 * Lives here, next to the limit and the error, because BOTH write paths must
 * enforce it: the human path (create/update) and the agent path (`/agent/release`
 * writes the plan into `notes`). The agent one is the path that actually gets
 * machine-generated text, so exempting it would have made the cap decorative.
 */
export function assertNotesWithinLimit(notes: string | null | undefined): void {
  if (notes == null) return
  const bytes = utf8ByteLength(notes)
  if (bytes > MAX_NOTES_BYTES) throw new NotesTooLargeError(bytes)
}

// --- Automation-board (§5) errors ---

/**
 * A human write (PATCH, batch tag op, MCP update) tried to move a task into an
 * `editableBy: agent` lane. Only the agent path (a live claim token) may (§5.2).
 * HTTP status: 403 Forbidden
 */
export class LaneNotEditableError extends DomainError {
  constructor(lane: string) {
    super(
      `Lane "${lane}" is agent-owned; the human path can't move tasks into it`,
      'LANE_NOT_EDITABLE',
      403
    )
    this.name = 'LaneNotEditableError'
  }
}

/**
 * A task on an automation board was given a tag that isn't exactly one of the
 * board's lanes (§5.2) — a free label, multiple tags, or an unknown tag. The
 * board's tag vocabulary IS the provider's contract, so anything else is drift.
 * HTTP status: 422 Unprocessable Entity
 */
export class LaneInvalidError extends DomainError {
  constructor(detail: string) {
    super(`Invalid lane assignment: ${detail}`, 'LANE_INVALID', 422)
    this.name = 'LaneInvalidError'
  }
}

/**
 * A structural mutation of an automation board's tag vocabulary (createTag /
 * deleteTag / batchClearTag) was attempted. The lane set is immutable while
 * `mode = 'automation'`; the provider changes it by re-activating (§5.2).
 * HTTP status: 409 Conflict
 */
export class BoardSchemaLockedError extends DomainError {
  constructor() {
    super(
      'Board schema is locked while automation is active; re-activate to change lanes',
      'BOARD_SCHEMA_LOCKED',
      409
    )
    this.name = 'BoardSchemaLockedError'
  }
}

/**
 * A committing `activate-automation` echoed a digest that no longer matches the
 * board's current state — something changed since the preview, so the commit is
 * refused rather than silently reshaping a board nobody looked at (§5.4).
 * HTTP status: 409 Conflict
 */
export class ActivationDigestMismatchError extends DomainError {
  constructor(public readonly currentDigest: string) {
    super(
      'Activation digest is stale; re-run the dry-run preview and retry',
      'DIGEST_MISMATCH',
      409
    )
    this.name = 'ActivationDigestMismatchError'
  }
}

/**
 * The activation payload failed structural validation (§5.1): duplicate lane
 * tags, a bad `editableBy`, or a missing `order`.
 * HTTP status: 422 Unprocessable Entity
 */
export class LaneSetInvalidError extends DomainError {
  constructor(detail: string) {
    super(`Invalid lane set: ${detail}`, 'LANE_SET_INVALID', 422)
    this.name = 'LaneSetInvalidError'
  }
}

// --- Claim-protocol (§4) errors ---

/**
 * A claim was attempted on a task whose lease is still live — held by another
 * agent (§4.1). The body carries the current holder + expiry so the caller can
 * move on. An expired lease is stealable and never raises this.
 * HTTP status: 409 Conflict
 */
export class ClaimHeldError extends DomainError {
  constructor(
    public readonly holder: string,
    public readonly expiresAt: string
  ) {
    super(`Task is claimed by ${holder} until ${expiresAt}`, 'CLAIM_HELD', 409)
    this.name = 'ClaimHeldError'
  }
}

/**
 * A heartbeat/set-lane/release presented a token that no longer holds the claim —
 * the lease expired and was taken by another agent (§4.2). Abort, write nothing.
 * HTTP status: 409 Conflict
 */
export class LeaseLostError extends DomainError {
  constructor() {
    super('Your lease was taken; abort without writing', 'LEASE_LOST', 409)
    this.name = 'LeaseLostError'
  }
}

/**
 * A claim/set-lane/release named a destination lane that isn't a lane on this
 * (automation) board — e.g. after a re-activation removed it (§5.4).
 * HTTP status: 422 Unprocessable Entity
 */
export class LaneUnknownError extends DomainError {
  constructor(lane: string) {
    super(`"${lane}" is not a lane on this board`, 'LANE_UNKNOWN', 422)
    this.name = 'LaneUnknownError'
  }
}

/**
 * A release's optional `ifCurrentLane` guard didn't match the task's current lane —
 * a human retagged it mid-claim (§8). The release wrote nothing; the runner aborts.
 * HTTP status: 409 Conflict
 */
export class LaneChangedError extends DomainError {
  constructor(public readonly currentLane: string | null) {
    super(
      `Task's lane changed since claim; it is now "${currentLane ?? '(inbox)'}"`,
      'LANE_CHANGED',
      409
    )
    this.name = 'LaneChangedError'
  }
}
