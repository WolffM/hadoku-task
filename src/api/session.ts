import { logger } from '@wolffm/task-ui-components'

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
 * Perform session handshake with server
 * Sends old and new sessionIds, receives preferences for the new session
 * 
 * For public users: skips handshake, maintains stable sessionId in localStorage
 */
export async function performSessionHandshake(
  newSessionId: string,
  userType: string
): Promise<any> {
  const oldSessionId = getStoredSessionId()
  
  // Public users: don't perform handshake, use stable localStorage-based sessionId
  if (userType === 'public') {
    // If we have a stored sessionId, keep using it (stable across reloads)
    if (oldSessionId) {
      logger.info('[Session] Public user - using existing sessionId', { oldSessionId })
      return null // No preferences from server, will use localStorage
    }

    // First time public user - generate and store a stable sessionId
    const publicSessionId = `public-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    storeSessionId(publicSessionId)
    logger.info('[Session] Public user - created stable sessionId', { publicSessionId })
    return null
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

    return data.preferences
  } catch (error) {
    logger.error('[Session] Handshake failed', { error: error instanceof Error ? error.message : String(error) })
    // Store the new sessionId anyway
    storeSessionId(newSessionId)
    // Return null to indicate no preferences available
    return null
  }
}

/**
 * Clear all localStorage keys associated with old sessionId
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
