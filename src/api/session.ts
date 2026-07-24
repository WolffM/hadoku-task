import { logger } from '@wolffm/logger/client'
import { formatError } from '../domain/utils/tags'
import type { UserType } from '../domain/types'

/**
 * Result from session handshake
 */
export interface HandshakeResult {
  preferences: null
  serverUserType: UserType
}

/**
 * Generate a unique session ID for this browser tab/session
 * Used to identify which tab made changes when coordinating cross-tab sync via BroadcastChannel
 */
export const SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

/**
 * One-shot migration (2026-05-07): rename legacy 'currentSessionId' /
 * 'currentUserType' to platform-canonical 'hadoku_session_id' /
 * 'hadoku_user_type'. The mf-loader (hadoku_site/src/components/mf-loader.js)
 * and auth-client (hadoku_site/src/lib/api/auth-client.ts) both read the
 * canonical names. Without this rename, cross-origin clients (Capacitor APK)
 * loop on "session expired" because their cookies are blocked by SameSite=Strict
 * and the X-Session-Id header fallback couldn't find the sessionId at the
 * key the loader was looking at. Safe to remove after one release cycle.
 */
if (typeof window !== 'undefined') {
  const legacySessionId = localStorage.getItem('currentSessionId')
  if (legacySessionId && !localStorage.getItem('hadoku_session_id')) {
    localStorage.setItem('hadoku_session_id', legacySessionId)
    localStorage.removeItem('currentSessionId')
  }
  const legacyUserType = localStorage.getItem('currentUserType')
  if (legacyUserType && !localStorage.getItem('hadoku_user_type')) {
    localStorage.setItem('hadoku_user_type', legacyUserType)
    localStorage.removeItem('currentUserType')
  }
}

/**
 * Get the last sessionId we used (stored in localStorage)
 */
export function getStoredSessionId(): string | null {
  return localStorage.getItem('hadoku_session_id')
}

/**
 * Store the current sessionId in localStorage
 */
export function storeSessionId(sessionId: string): void {
  localStorage.setItem('hadoku_session_id', sessionId)
  logger.info('[Session] Stored sessionId', { sessionId })
}

/**
 * Anon-session storage key.
 *
 * DELIBERATELY NOT `hadoku_session_id`: the host page's micro-frontend loader
 * (hadoku_site mf-loader.js) OWNS `hadoku_session_id` and wipes it on every boot
 * when the server says the user is public — it treats any stored value as a
 * stale *auth* session. Our anon local session is a different thing, so it needs
 * a key the host never touches; otherwise the host wipes it, we re-mint a fresh
 * id, and every reload strands the previous anon user's tasks.
 */
const ANON_SESSION_KEY = 'task_anon_session_id'

/**
 * The stable per-browser anon (public-user) sessionId. Minted once and reused
 * across reloads, so an unauthenticated user's local tasks survive a reload.
 */
export function getAnonSessionId(): string {
  let id = localStorage.getItem(ANON_SESSION_KEY)
  if (!id) {
    id = `public-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    localStorage.setItem(ANON_SESSION_KEY, id)
    logger.info('[Session] Minted anon sessionId', { id })
  }
  return id
}

/**
 * Get the stored userType from localStorage
 */
export function getStoredUserType(): UserType | null {
  return localStorage.getItem('hadoku_user_type') as UserType | null
}

/**
 * Store the current userType in localStorage
 */
export function storeUserType(userType: UserType): void {
  localStorage.setItem('hadoku_user_type', userType)
  logger.info('[Session] Stored userType', { userType })
}

/**
 * Perform session handshake with server
 * Sends old and new sessionIds, receives preferences for the new session
 *
 * For public users: skips handshake, maintains stable sessionId in localStorage
 *
 * Returns both the server preferences and the server's determined userType.
 * The serverUserType may differ from the client's userType if the session expired.
 */
export async function performSessionHandshake(
  newSessionId: string,
  userType: string
): Promise<HandshakeResult> {
  const oldSessionId = getStoredSessionId()

  // Public users: no server handshake. Resolve (and, first time, mint) the stable
  // anon sessionId from a host-independent key so it survives reloads — the host
  // wipes `hadoku_session_id` for public users on every boot (see ANON_SESSION_KEY).
  if (userType === 'public') {
    const anonId = getAnonSessionId()
    logger.info('[Session] Public user - using anon sessionId', { anonId })
    return { preferences: null, serverUserType: 'public' }
  }

  // Authenticated users: perform handshake with server
  logger.info('[Session] Performing handshake...', { oldSessionId, newSessionId, userType })

  try {
    const response = await fetch(`/task/api/session/handshake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Type': userType,
        'X-Session-Id': newSessionId
      },
      body: JSON.stringify({
        oldSessionId,
        newSessionId
      })
    })

    if (!response.ok) {
      throw new Error(`Handshake failed: ${response.status}`)
    }

    const data = await response.json()
    logger.info('[Session] Handshake successful', { data })

    // Store the new sessionId
    storeSessionId(newSessionId)

    // Check for userType mismatch - session may have expired
    const serverUserType: UserType = data.userType || userType
    if (data.userType && data.userType !== userType) {
      logger.warn('[Session] Server userType differs from client', {
        clientUserType: userType,
        serverUserType: data.userType
      })
      // Update stored userType to match server
      storeUserType(data.userType)
    }

    return {
      preferences: data.preferences,
      serverUserType
    }
  } catch (error) {
    logger.error('[Session] Handshake failed', {
      error: formatError(error)
    })
    // Store the new sessionId anyway
    storeSessionId(newSessionId)
    // Return null preferences but keep client's userType assumption
    return { preferences: null, serverUserType: userType as UserType }
  }
}

/**
 * Clear all localStorage keys associated with old sessionId for a specific userType
 */
export function clearOldSessionStorage(oldSessionId: string, userType: string): void {
  if (!oldSessionId) return

  const keysToRemove: string[] = []

  // Find all keys matching the old session pattern
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.includes(`${userType}-${oldSessionId}-`)) {
      keysToRemove.push(key)
    }
  }

  logger.info('[Session] Clearing old storage keys', { count: keysToRemove.length })

  // Remove them
  keysToRemove.forEach(key => {
    logger.info('[Session] Removing key', { key })
    localStorage.removeItem(key)
  })
}

/**
 * Clear all localStorage keys associated with a sessionId across ALL userTypes
 * Used when switching accounts to ensure old data doesn't persist
 */
export function clearAllSessionStorage(oldSessionId: string): void {
  if (!oldSessionId) return

  const userTypes = ['public', 'friend', 'admin']
  const keysToRemove: string[] = []

  // Find all keys matching the old session pattern for any userType
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) {
      for (const ut of userTypes) {
        if (key.startsWith(`${ut}-${oldSessionId}-`)) {
          keysToRemove.push(key)
          break
        }
      }
    }
  }

  logger.info('[Session] Clearing all session storage keys', {
    sessionId: oldSessionId,
    count: keysToRemove.length
  })

  // Remove them
  keysToRemove.forEach(key => {
    logger.info('[Session] Removing key', { key })
    localStorage.removeItem(key)
  })
}
