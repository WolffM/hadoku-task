/**
 * Application Constants
 *
 * Centralized location for all magic strings, default values, and configuration constants.
 */

// The USER_TYPES map that used to live here was removed with the 2026-07-25
// tier-hierarchy unification. It predated the `service` tier and so couldn't
// name it, and comparing `auth.userType` against its members was an exact match
// that locked higher tiers out of lower-tier routes. Gate with
// `tierAtLeast(auth, 'admin')` from @wolffm/worker-utils instead — it ranks
// public < friend < service < admin.

// ============================================================================
// Session & Board Defaults
// ============================================================================

export const DEFAULT_SESSION_ID = 'public'
export const DEFAULT_BOARD_ID = 'main'
export const DEFAULT_BOARD_NAME = 'main'

// ============================================================================
// Theme Constants
// ============================================================================

export const THEMES = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark',
  STRAWBERRY: 'strawberry',
  STRAWBERRY_DARK: 'strawberry-dark'
} as const

export const DEFAULT_THEME = THEMES.SYSTEM

// ============================================================================
// KV Key Prefixes
// ============================================================================

export const KV_PREFIXES = {
  BOARDS: 'boards',
  TASKS: 'tasks',
  PREFS: 'prefs',
  SESSION_INFO: 'session-info',
  SESSION_MAP: 'session-map'
} as const

// ============================================================================
// Default Values
// ============================================================================

/**
 * Default preferences for new users/sessions
 * Note: lastUpdated should be added at usage time, not here
 */
export const DEFAULT_PREFERENCES = {
  theme: DEFAULT_THEME,
  buttons: {},
  experimentalFlags: {},
  layout: {}
} as const

/**
 * Default board structure
 */
export const DEFAULT_BOARD = {
  id: DEFAULT_BOARD_ID,
  name: DEFAULT_BOARD_NAME,
  tags: [],
  tasks: []
} as const

// ============================================================================
// Rate Limiting & Throttling
// ============================================================================

export const RATE_LIMITS = {
  MAX_OPERATIONS_PER_SECOND: 10,
  THROTTLE_DELAY_MS: 100
} as const

// ============================================================================
// Validation Limits
// ============================================================================

export const VALIDATION_LIMITS = {
  MAX_TITLE_LENGTH: 1000,
  MAX_TAG_LENGTH: 50,
  MAX_BOARD_NAME_LENGTH: 100,
  MAX_TAGS_PER_BOARD: 100,
  MAX_TASKS_PER_BOARD: 10000,
  MAX_BOARDS_PER_USER: 100
} as const

// ============================================================================
// HTTP Status Codes
// ============================================================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500
} as const

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
  INVALID_REQUEST: 'Invalid request',
  BOARD_EXISTS: 'Board already exists',
  BOARD_NOT_FOUND: 'Board not found',
  TASK_NOT_FOUND: 'Task not found',
  TAG_NOT_FOUND: 'Tag not found',
  UNAUTHORIZED: 'Unauthorized',
  RATE_LIMITED: 'Too many requests'
} as const
