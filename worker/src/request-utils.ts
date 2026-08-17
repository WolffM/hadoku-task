/**
 * Request Utilities for Task API
 *
 * Common utilities for extracting and validating request parameters.
 *
 * NOTE: Many generic utilities have been moved to @wolffm/worker-utils.
 * This file now contains only task-api-specific helpers.
 */
import type { Context } from 'hono'
import { isNonEmptyString } from '@wolffm/worker-utils'
import { DEFAULT_SESSION_ID } from './constants'

/**
 * The identity preferences are stored under, plus the stale namespaces to
 * recover from.
 */
export interface PrefsIdentity {
  /** Stable storage id. Preferences are read and written here. */
  id: string
  /**
   * Older namespaces this user's preferences may still sit under, most-likely
   * first. Read-only: the read path copies forward from these, never writes to
   * them.
   */
  legacyIds: string[]
}

/**
 * Resolve the identity preferences are keyed by.
 *
 * Preferences MUST use the same stable identity as boards and tasks: the
 * edge-injected `X-User-Id` (see the identity-scoping middleware in index.ts,
 * which sets `auth.userId` and points `auth.sessionId` at it).
 *
 * The raw `X-Session-Id` header is NOT a user identity. edge-router mints a
 * fresh random session id on every login (`generateSessionId()` — 16 random
 * bytes, workers/edge-router/src/session.ts), so keying preferences by it
 * orphans a user's settings on every new login and every new device. That is
 * precisely what produced the ~270 stranded 32-hex `prefs:{sessionId}` blobs
 * sitting in TASKS_KV for ~9 real users.
 *
 * `legacyIds` therefore carries every namespace the same user's preferences
 * could have been written to before this fix, so the read path can copy them
 * forward instead of silently serving defaults.
 */
export function resolvePrefsIdentity(
  c: Context,
  auth: { userId?: string; sessionId?: string; legacyId?: string; key?: string }
): PrefsIdentity {
  const id = auth.userId || auth.sessionId || DEFAULT_SESSION_ID

  // Ordered by how likely each is to hold this user's most recent preferences:
  // the session id the client is presenting right now, then the raw-credential
  // namespace that pre-dates the userId flip.
  const legacyIds: string[] = []
  for (const candidate of [c.req.header('X-Session-Id'), auth.legacyId, auth.key]) {
    if (!candidate || candidate === id || candidate === DEFAULT_SESSION_ID) continue
    if (!legacyIds.includes(candidate)) legacyIds.push(candidate)
  }

  return { id, legacyIds }
}

/**
 * Validate board ID (uses util's isNonEmptyString)
 *
 * @param id - Board ID to validate
 * @returns Error message or null if valid
 */
export function validateBoardId(id: string | null): string | null {
  if (!isNonEmptyString(id)) {
    return 'Missing required parameter: board ID'
  }
  return null
}
