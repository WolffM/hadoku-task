import { logger } from '@wolffm/task-ui-components'
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
 * Get the last sessionId we used (stored in localStorage)
 */
export function getStoredSessionId(): string | null {
  return localStorage.getItem('currentSessionId')
}

/**
 * Store the current sessionId in localStorage
 */
export function storeSessionId(sessionId: string): void {
  localStorage.setItem('currentSessionId', sessionId)
  logger.info('[Session] Stored sessionId', { sessionId })
}

/**
 * Get the stored userType from localStorage
 */
export function getStoredUserType(): UserType | null {
  return localStorage.getItem('currentUserType')
}

/**
 * Store the current userType in localStorage
 */
export function storeUserType(userType: UserType): void {
  localStorage.setItem('currentUserType', userType)
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

  // Public users: don't perform handshake, use stable localStorage-based sessionId
  if (userType === 'public') {
    // If we have a stored sessionId, keep using it (stable across reloads)
    if (oldSessionId) {
      logger.info('[Session] Public user - using existing sessionId', { oldSessionId })
      return { preferences: null, serverUserType: 'public' }
    }

    // First time public user - generate and store a stable sessionId
    const publicSessionId = `public-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    storeSessionId(publicSessionId)
    logger.info('[Session] Public user - created stable sessionId', { publicSessionId })
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
