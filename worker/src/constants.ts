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

const THEMES = {
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
