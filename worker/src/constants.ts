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
// public < friend < service < wife < admin.

// ============================================================================
// Session & Board Defaults
// ============================================================================

export const DEFAULT_SESSION_ID = 'public'
export const DEFAULT_BOARD_ID = 'main'
export const DEFAULT_BOARD_NAME = 'main'

// ============================================================================
// KV Key Prefixes
// ============================================================================

export const KV_PREFIXES = {
  BOARDS: 'boards',
  TASKS: 'tasks'
} as const
