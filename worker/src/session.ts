/**
 * Session Management Module
 *
 * Handles sessionId-based storage, preferences migration, and session mapping.
 *
 * Key Concepts:
 * - Storage by sessionId (not authKey)
 * - One preferences object per sessionId
 * - Multiple sessionIds per authKey (multi-device support)
 * - Session mapping: authKey → sessionId list (tracks active sessions)
 * - Never delete old sessionId preferences
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
  buttons?: Record<string, unknown>
  experimentalFlags?: Record<string, unknown>
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
  maxRetries = 10
): Promise<void> {
  // Verify session-info exists before adding to mapping
  // This prevents "mystery sessions" that have no session data
  const sessionInfo = await getSessionInfo(kv, sessionId)
  if (!sessionInfo) {
    logger.warn(
      `[SessionMapping] Cannot add session ${maskSessionId(sessionId)} - no session-info exists`
    )
    return
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
  oldSessionId: string | null
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
 * 1. If oldSessionId provided, try to load preferences from it
 * 2. If oldSessionId not found, check authKey mapping for last sessionId (for fallback only, don't delete)
 * 3. If nothing found, use default preferences
 * 4. MOVE preferences to newSessionId ONLY if oldSessionId was provided (delete old, save new)
 * 5. Update authKey → sessionId mapping
 * 6. Create session info for newSessionId with the VALIDATED userType (from auth middleware)
 * 7. Delete old session info if it was migrated
 *
 * IMPORTANT: The userType parameter comes from auth middleware which has already validated
 * the authKey. This ensures we always return the current, correct userType based on key validity.
 */
export async function handleSessionHandshake(
  kv: KVNamespace,
  authKey: string,
  userType: 'admin' | 'friend' | 'public',
  request: HandshakeRequest
): Promise<HandshakeResponse> {
  const { oldSessionId, newSessionId } = request

  // Log the validated userType for debugging
  logger.info('[Session Handshake] Validated userType from auth middleware', { userType })

  let preferences: UserPreferences | null = null
  let migratedFrom: string | undefined = undefined
  let isNewSession = true
  let sessionIdToDelete: string | null = null

  // Try to load preferences from oldSessionId (explicit migration)
  if (oldSessionId) {
    preferences = await getPreferencesBySessionId(kv, oldSessionId)
    if (preferences) {
      migratedFrom = oldSessionId
      isNewSession = false
      sessionIdToDelete = oldSessionId // Only delete if explicitly migrating
    }
  }

  // If oldSessionId not provided or not found, try authKey mapping as fallback
  // Note: We DON'T delete this - it might be another device still using it
  if (!preferences) {
    const mapping = await getSessionMapping(kv, authKey)
    if (mapping && mapping.lastSessionId) {
      preferences = await getPreferencesBySessionId(kv, mapping.lastSessionId)
      if (preferences) {
        migratedFrom = mapping.lastSessionId
        isNewSession = false
        // DON'T mark for deletion - this might be a new device
      }
    }
  }

  // Use defaults if nothing found
  if (!preferences) {
    preferences = { ...DEFAULT_PREFERENCES }
  }

  // Save preferences to newSessionId
  await savePreferencesBySessionId(kv, newSessionId, preferences)

  // Delete old preferences and session info ONLY if explicitly migrating
  if (sessionIdToDelete && sessionIdToDelete !== newSessionId) {
    await kv.delete(preferencesKey(sessionIdToDelete))
    await kv.delete(sessionInfoKey(sessionIdToDelete))

    // Remove old sessionId from mapping
    const mapping = await getSessionMapping(kv, authKey)
    if (mapping) {
      mapping.sessionIds = mapping.sessionIds.filter(id => id !== sessionIdToDelete)
      await kv.put(sessionMappingKey(authKey), JSON.stringify(mapping))
    }
  }

  // Create session info for newSessionId FIRST (before updating mapping)
  // This ensures session-info exists when updateSessionMapping checks for it
  const now = new Date().toISOString()
  const sessionInfo: SessionInfo = {
    sessionId: newSessionId,
    authKey,
    userType,
    createdAt: now,
    lastAccessedAt: now
  }
  await saveSessionInfo(kv, sessionInfo)

  // Add new sessionId to mapping (AFTER session-info is created)
  // This prevents "mystery sessions" in the mapping without session-info
  await updateSessionMapping(kv, authKey, newSessionId)

  // Clean up stale sessions (30+ days old) in the background
  // This runs asynchronously and won't block the handshake response
  cleanupStaleSessions(kv, authKey).catch(err => {
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
async function cleanupStaleSessions(kv: KVNamespace, authKey: string): Promise<void> {
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

      // Delete preferences and session-info for each stale session
      const deletePromises = sessionsToDelete.flatMap(sessionId => [
        kv.delete(preferencesKey(sessionId)),
        kv.delete(sessionInfoKey(sessionId))
      ])

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
