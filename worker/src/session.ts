/**
 * Session Management Module
 *
 * Handles session bookkeeping, preferences storage, and session mapping.
 *
 * Key Concepts:
 * - Preferences are keyed by the STABLE user identity (edge-injected X-User-Id),
 *   the same identity boards and tasks use. One preferences object per USER.
 * - Session bookkeeping (session-info, session-map) stays keyed by sessionId,
 *   because that genuinely is per-session state.
 * - Multiple sessionIds per authKey (multi-device support)
 * - Session mapping: authKey → sessionId list (tracks active sessions), which
 *   doubles as the recovery index for preferences stranded under an old
 *   sessionId — see readPreferencesWithRepair.
 *
 * History: preferences used to be keyed by sessionId. edge-router mints a fresh
 * sessionId on every login, so that orphaned a user's settings on each new login
 * or device — 302 stray `prefs:*` blobs for ~9 real users. readPreferencesWithRepair
 * exists to pull those forward.
 */

import type { KVNamespace } from '@cloudflare/workers-types'
import { DEFAULT_PREFERENCES as CONSTANTS_DEFAULT_PREFERENCES } from './constants'
import { preferencesKey, sessionInfoKey, sessionMappingKey } from './kv-keys'
import { maskKey, maskSessionId } from '@wolffm/worker-utils'
import { logger } from './logger'

// ============================================================================
// Types
// ============================================================================

export interface UserPreferences {
  theme?: string
  // `unknown` here was looser than the published contract, which has always
  // said boolean (UserPreferencesSchema) — these are on/off toggles per button
  // and per flag. The gap only survived because the route handlers took `c: any`.
  buttons?: Record<string, boolean>
  experimentalFlags?: Record<string, boolean>
  layout?: Record<string, unknown>
  deviceInfo?: Record<string, unknown>
  lastUpdated?: string
  [key: string]: unknown // Allow additional custom preferences
}

export interface SessionMapping {
  authKey: string
  sessionIds: string[] // List of all sessionIds for this authKey
  lastSessionId: string // Most recently used sessionId
  createdAt: string
  updatedAt: string
}

export interface SessionInfo {
  sessionId: string
  authKey: string
  userType: 'admin' | 'friend' | 'public'
  createdAt: string
  lastAccessedAt: string
}

// ============================================================================
// Session Storage Operations
// ============================================================================

/**
 * Get preferences by sessionId
 */
export async function getPreferencesBySessionId(
  kv: KVNamespace,
  sessionId: string
): Promise<UserPreferences | null> {
  const key = preferencesKey(sessionId)
  const data = await kv.get(key, 'json')
  return data as UserPreferences | null
}

/**
 * Save preferences by sessionId
 */
export async function savePreferencesBySessionId(
  kv: KVNamespace,
  sessionId: string,
  preferences: UserPreferences
): Promise<void> {
  const key = preferencesKey(sessionId)
  const data = {
    ...preferences,
    lastUpdated: new Date().toISOString()
  }
  await kv.put(key, JSON.stringify(data))
}

/**
 * Timestamp a preferences blob was last written, as epoch ms. Blobs carry
 * `lastUpdated` (written by savePreferencesBySessionId) and older ones also
 * carry `updatedAt` from the client shape. Unparseable/absent → 0, which just
 * makes the blob lose every comparison rather than throwing.
 */
function prefsTimestamp(prefs: UserPreferences): number {
  const raw = prefs.lastUpdated ?? prefs.updatedAt
  if (typeof raw !== 'string') return 0
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * How many historical sessionIds to sweep when recovering stranded prefs.
 * Only ever paid once per user (the hit is copied forward), and the sweep runs
 * in parallel, but a user with a long login history shouldn't fan out
 * unboundedly. Newest sessionIds are checked first — see below.
 */
const MAX_RECOVERY_SESSIONS = 40

/**
 * Read preferences for a stable identity, recovering anything stranded under an
 * ephemeral sessionId.
 *
 * Mirrors the read-repair pattern the board/task storage already uses
 * (`readWithRepair` in routes/route-utils.ts): read the primary namespace, fall
 * back to legacy namespaces, and copy a hit forward so later reads land
 * directly.
 *
 * Recovery order:
 *   1. `prefs:{id}` — the stable, correct location.
 *   2. Each id in `legacyIds` — the session id presented on this request and
 *      the pre-userId-flip raw credential.
 *   3. Every sessionId this authKey has ever used, via the existing
 *      `session-map:{authKey}` record, newest first. This is the step that
 *      actually rescues the stranded blobs: after a fresh login the current
 *      X-Session-Id is brand new and holds nothing, so the user's real
 *      preferences are only reachable through their session history.
 *
 * The legacy entry is deliberately left in place on copy-forward, matching
 * readWithRepair — pruning is the cleanup cron's job, and leaving it keeps a
 * rollback possible.
 */
export async function readPreferencesWithRepair(
  kv: KVNamespace,
  id: string,
  legacyIds: string[] = [],
  authKey?: string
): Promise<UserPreferences | null> {
  const primary = await getPreferencesBySessionId(kv, id)
  if (primary) return primary

  const copyForward = async (prefs: UserPreferences, from: string): Promise<UserPreferences> => {
    // Preserve the blob's own lastUpdated: savePreferencesBySessionId stamps
    // `now`, which would make a rescued 2025 blob look freshly written and beat
    // out a genuinely newer one on a later comparison.
    await kv.put(preferencesKey(id), JSON.stringify(prefs))
    logger.info('[Prefs] Recovered stranded preferences', {
      from: maskSessionId(from),
      to: maskSessionId(id)
    })
    return prefs
  }

  for (const legacyId of legacyIds) {
    const legacy = await getPreferencesBySessionId(kv, legacyId)
    if (legacy) return copyForward(legacy, legacyId)
  }

  if (!authKey) return null

  const mapping = await getSessionMapping(kv, authKey)
  if (!mapping?.sessionIds?.length) return null

  // sessionIds is append-ordered, so the tail is the most recent. Check newest
  // first and cap the fan-out.
  const candidates = mapping.sessionIds
    .slice()
    .reverse()
    .filter(sid => sid !== id && !legacyIds.includes(sid))
    .slice(0, MAX_RECOVERY_SESSIONS)
  if (candidates.length === 0) return null

  const found = await Promise.all(
    candidates.map(async sid => ({ sid, prefs: await getPreferencesBySessionId(kv, sid) }))
  )

  // Append order tells us nothing about which session was written to LAST, so
  // pick by the blob's own timestamp rather than trusting position.
  let best: { sid: string; prefs: UserPreferences } | null = null
  for (const { sid, prefs } of found) {
    if (!prefs) continue
    if (!best || prefsTimestamp(prefs) > prefsTimestamp(best.prefs)) best = { sid, prefs }
  }
  if (!best) return null

  return copyForward(best.prefs, best.sid)
}

/**
 * Get session info by sessionId
 */
export async function getSessionInfo(
  kv: KVNamespace,
  sessionId: string
): Promise<SessionInfo | null> {
  const key = sessionInfoKey(sessionId)
  const data = await kv.get(key, 'json')
  return data as SessionInfo | null
}

/**
 * Save session info
 */
export async function saveSessionInfo(kv: KVNamespace, sessionInfo: SessionInfo): Promise<void> {
  const key = sessionInfoKey(sessionInfo.sessionId)
  await kv.put(key, JSON.stringify(sessionInfo))
}

/**
 * Get session mapping for authKey
 */
export async function getSessionMapping(
  kv: KVNamespace,
  authKey: string
): Promise<SessionMapping | null> {
  const key = sessionMappingKey(authKey)
  const data = await kv.get(key, 'json')
  return data as SessionMapping | null
}

/**
 * Update session mapping for authKey with collision detection and retry
 * Adds new sessionId to the list if not present
 *
 * Since Workers KV doesn't support atomic compare-and-swap, we use a simple
 * retry mechanism with random jitter to handle concurrent updates gracefully.
 * We read, modify, write, then verify. If verification fails, we retry.
 *
 * Note: This should only be called AFTER session-info has been successfully saved
 * to prevent orphaned session references (mystery sessions)
 */
export async function updateSessionMapping(
  kv: KVNamespace,
  authKey: string,
  sessionId: string,
  maxRetries = 10,
  // Callers that just wrote session-info themselves can skip the existence
  // read — it's a global KV round-trip whose answer they already know.
  sessionInfoKnownToExist = false
): Promise<void> {
  // Verify session-info exists before adding to mapping
  // This prevents "mystery sessions" that have no session data
  if (!sessionInfoKnownToExist) {
    const sessionInfo = await getSessionInfo(kv, sessionId)
    if (!sessionInfo) {
      logger.warn(
        `[SessionMapping] Cannot add session ${maskSessionId(sessionId)} - no session-info exists`
      )
      return
    }
  }

  const key = sessionMappingKey(authKey)
  const now = new Date().toISOString()

  // Retry loop to handle concurrent modifications
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Read current mapping
    const existing = await getSessionMapping(kv, authKey)

    let newMapping: SessionMapping

    if (existing) {
      // If sessionId is already in the list, we're done
      if (existing.sessionIds.includes(sessionId)) {
        return // No update needed
      }

      // Update existing mapping
      newMapping = {
        ...existing,
        sessionIds: [...existing.sessionIds, sessionId],
        lastSessionId: sessionId,
        updatedAt: now
      }
    } else {
      // Create new mapping
      newMapping = {
        authKey,
        sessionIds: [sessionId],
        lastSessionId: sessionId,
        createdAt: now,
        updatedAt: now
      }
    }

    // Write the new mapping
    await kv.put(key, JSON.stringify(newMapping))

    // Small delay to allow KV to propagate
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify the write by reading back
    const verification = await getSessionMapping(kv, authKey)

    // Check if our sessionId made it into the mapping
    if (verification && verification.sessionIds.includes(sessionId)) {
      // Success! Our write is reflected
      return
    }

    // Conflict detected - retry with exponential backoff + jitter
    if (attempt === maxRetries - 1) {
      logger.error(
        `[SessionMapping] Failed to update after ${maxRetries} attempts for authKey ${maskKey(authKey)}`
      )
      throw new Error('Session mapping update failed due to concurrent modifications')
    }

    // Exponential backoff with random jitter to avoid thundering herd
    const baseDelay = Math.min(50 * Math.pow(2, attempt), 500)
    const jitter = Math.random() * baseDelay * 0.5
    const delay = baseDelay + jitter

    await new Promise(resolve => setTimeout(resolve, delay))
    logger.info(
      `[SessionMapping] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms for authKey ${maskKey(authKey)}`
    )
  }
}

// ============================================================================
// Session Handshake Logic
// ============================================================================

/**
 * Default preferences for new sessions
 */
const DEFAULT_PREFERENCES: UserPreferences = {
  ...CONSTANTS_DEFAULT_PREFERENCES,
  lastUpdated: new Date().toISOString()
}

export interface HandshakeRequest {
  /**
   * Optional AND nullable, matching SessionHandshakeInputSchema. Declaring it
   * `string | null` was only tenable while the route handler took `c: any`;
   * the request body genuinely omits it on a first login.
   */
  oldSessionId?: string | null
  newSessionId: string
}

export interface HandshakeResponse {
  sessionId: string
  preferences: UserPreferences
  isNewSession: boolean
  migratedFrom?: string
  userType: 'admin' | 'friend' | 'public' // Return validated userType to client
}

/**
 * Handle session handshake
 *
 * Logic:
 * 1. Load preferences from the STABLE identity (`storageId`), recovering from
 *    oldSessionId / this authKey's session history if nothing is there yet.
 * 2. If nothing found, use default preferences
 * 3. Save preferences back to `storageId` — never to newSessionId
 * 4. Update authKey → sessionId mapping
 * 5. Create session info for newSessionId with the VALIDATED userType (from auth middleware)
 * 6. Delete old session info if it was migrated
 *
 * `storageId` is the edge-injected X-User-Id (stable per user, survives key
 * rotation). Session bookkeeping — session-info and session-map — stays keyed by
 * the ephemeral sessionId, because that genuinely IS per-session state.
 * Preferences are not: writing them per-session is what stranded ~270 blobs in
 * TASKS_KV, one per login.
 *
 * IMPORTANT: The userType parameter comes from auth middleware which has already validated
 * the authKey. This ensures we always return the current, correct userType based on key validity.
 */
export async function handleSessionHandshake(
  kv: KVNamespace,
  authKey: string,
  userType: 'admin' | 'friend' | 'public',
  request: HandshakeRequest,
  storageId: string
): Promise<HandshakeResponse> {
  const { oldSessionId, newSessionId } = request

  // Log the validated userType for debugging
  logger.info('[Session Handshake] Validated userType from auth middleware', { userType })

  let preferences: UserPreferences | null = null
  let migratedFrom: string | undefined = undefined
  let isNewSession = true
  let sessionIdToDelete: string | null = null

  // Resolve preferences from the stable identity, falling back to oldSessionId
  // and then to this authKey's whole session history. readPreferencesWithRepair
  // copies whatever it finds forward, so the recovery is paid once.
  //
  // The mapping is read alongside it because the migration cleanup below needs
  // it, and every KV read is a global round-trip.
  const [resolvedPrefs, mapping] = await Promise.all([
    readPreferencesWithRepair(kv, storageId, oldSessionId ? [oldSessionId] : [], authKey),
    getSessionMapping(kv, authKey)
  ])

  if (resolvedPrefs) {
    preferences = resolvedPrefs
    isNewSession = false
    // Report the source the client asked us to migrate from, when it had one.
    migratedFrom = oldSessionId ?? mapping?.lastSessionId
    // Only the explicitly-migrated session is safe to delete; a session from
    // the mapping may still be live on another device.
    if (oldSessionId) sessionIdToDelete = oldSessionId
  }

  // Use defaults if nothing found
  if (!preferences) {
    preferences = { ...DEFAULT_PREFERENCES }
  }

  const now = new Date().toISOString()
  const sessionInfo: SessionInfo = {
    sessionId: newSessionId,
    authKey,
    userType,
    createdAt: now,
    lastAccessedAt: now
  }

  // Preferences and session-info are independent writes — issue them together.
  // Preferences go to the STABLE id; session-info is genuinely per-session.
  // The mapping update must still land AFTER session-info exists, otherwise the
  // mapping can reference a session that has no session-info ("mystery sessions").
  await Promise.all([
    savePreferencesBySessionId(kv, storageId, preferences),
    saveSessionInfo(kv, sessionInfo)
  ])

  // Delete old preferences and session info ONLY if explicitly migrating.
  // Reuses the mapping already read above.
  if (sessionIdToDelete && sessionIdToDelete !== newSessionId) {
    const cleanup: Promise<unknown>[] = [kv.delete(sessionInfoKey(sessionIdToDelete))]
    // Never delete the stable namespace we just wrote to — only a genuinely
    // session-scoped leftover.
    if (sessionIdToDelete !== storageId) {
      cleanup.push(kv.delete(preferencesKey(sessionIdToDelete)))
    }
    if (mapping) {
      mapping.sessionIds = mapping.sessionIds.filter(id => id !== sessionIdToDelete)
      cleanup.push(kv.put(sessionMappingKey(authKey), JSON.stringify(mapping)))
    }
    await Promise.all(cleanup)
  }

  // Add new sessionId to mapping (AFTER session-info is created).
  // We wrote session-info in the Promise.all above, so skip the existence re-read.
  await updateSessionMapping(kv, authKey, newSessionId, 10, true)

  // Clean up stale sessions (30+ days old) in the background.
  // This runs asynchronously and won't block the handshake response. Safe to run
  // after recovery: readPreferencesWithRepair above already copied any stranded
  // blob forward into `storageId`, synchronously, before we prune anything.
  cleanupStaleSessions(kv, authKey, storageId).catch(err => {
    logger.error('[SessionCleanup] Failed to cleanup stale sessions', {
      error: err instanceof Error ? err.message : String(err)
    })
  })

  return {
    sessionId: newSessionId,
    preferences,
    isNewSession,
    migratedFrom,
    userType // Return the validated userType from auth middleware
  }
}

// ============================================================================
// Session Cleanup
// ============================================================================

/**
 * Clean up stale sessions (30+ days since last access)
 *
 * This runs asynchronously during handshake to avoid blocking the response.
 * Checks all sessions for the given authKey and removes:
 * - Sessions not accessed in 30+ days
 * - Orphaned session-info entries (in mapping but no session-info exists)
 */
async function cleanupStaleSessions(
  kv: KVNamespace,
  authKey: string,
  storageId?: string
): Promise<void> {
  const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds
  const now = Date.now()

  try {
    // Get session mapping for this user
    const mapping = await getSessionMapping(kv, authKey)
    if (!mapping?.sessionIds || mapping.sessionIds.length === 0) {
      return
    }

    const sessionsToDelete: string[] = []
    const validSessions: string[] = []

    // Check all sessions in parallel for better performance
    const sessionChecks = await Promise.all(
      mapping.sessionIds.map(async sessionId => {
        const sessionInfo = await getSessionInfo(kv, sessionId)

        if (!sessionInfo) {
          // Orphaned session - no session-info exists
          logger.info(`[SessionCleanup] Removing orphaned session: ${maskSessionId(sessionId)}`)
          return { sessionId, action: 'delete' as const }
        }

        // Check if session is stale (30+ days)
        const lastAccessed = new Date(sessionInfo.lastAccessedAt).getTime()
        const age = now - lastAccessed

        if (age > STALE_THRESHOLD_MS) {
          logger.info(
            `[SessionCleanup] Removing stale session: ${maskSessionId(sessionId)} (${Math.floor(age / (24 * 60 * 60 * 1000))} days old)`
          )
          return { sessionId, action: 'delete' as const }
        } else {
          return { sessionId, action: 'keep' as const }
        }
      })
    )

    // Separate sessions to delete from those to keep
    for (const { sessionId, action } of sessionChecks) {
      if (action === 'delete') {
        sessionsToDelete.push(sessionId)
      } else {
        validSessions.push(sessionId)
      }
    }

    // Delete stale sessions
    if (sessionsToDelete.length > 0) {
      logger.info(
        `[SessionCleanup] Deleting ${sessionsToDelete.length} stale sessions for authKey: ${maskKey(authKey)}`
      )

      // Delete preferences and session-info for each stale session. The stable
      // preferences namespace is never session-scoped, so it must survive even
      // if it happens to collide with a sessionId being pruned.
      const deletePromises = sessionsToDelete.flatMap(sessionId =>
        sessionId === storageId
          ? [kv.delete(sessionInfoKey(sessionId))]
          : [kv.delete(preferencesKey(sessionId)), kv.delete(sessionInfoKey(sessionId))]
      )

      await Promise.all(deletePromises)

      // Update session mapping to remove deleted sessions
      mapping.sessionIds = validSessions
      mapping.updatedAt = new Date().toISOString()
      await kv.put(sessionMappingKey(authKey), JSON.stringify(mapping))

      logger.info(`[SessionCleanup] Cleanup complete. ${validSessions.length} sessions remaining.`)
    }
  } catch (error) {
    logger.error('[SessionCleanup] Error during cleanup', {
      error: error instanceof Error ? error.message : String(error)
    })
    // Don't throw - cleanup is best-effort and shouldn't fail handshake
  }
}
