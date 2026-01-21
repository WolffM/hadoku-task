/**
 * Authentication utilities
 * Functions for handling user authentication and key validation
 */

import { logger } from '@wolffm/task-ui-components'
import { formatError } from '../domain/utils/tags'
import { isMobileApp } from './platform'
import {
  storeSessionId,
  storeUserType,
  getStoredSessionId,
  clearAllSessionStorage
} from '../api/session'
import type { UserType } from '../domain/types'

interface SessionCreateResponse {
  sessionId: string
  userType: UserType
}

/**
 * Create a session with the server using the validated key
 */
async function createSession(key: string): Promise<SessionCreateResponse> {
  const response = await fetch('/session/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Key': key
    }
  })

  if (!response.ok) {
    throw new Error(`Session creation failed: ${response.status}`)
  }

  return response.json()
}

/**
 * Validate a key and store it securely
 * @param key - The authentication key to validate
 * @param validateKeyFn - Function that validates the key (from API client)
 * @returns Promise with success status and optional error message
 */
export async function validateAndChangeKey(
  key: string,
  validateKeyFn: (key: string) => Promise<boolean>
): Promise<{ success: boolean; error?: string }> {
  const trimmedKey = key.trim()

  if (!trimmedKey) {
    return { success: false, error: 'Key cannot be empty' }
  }

  try {
    const isValid = await validateKeyFn(trimmedKey)

    if (isValid) {
      logger.info('[Auth] Key validated - creating session')

      // Create session with the server
      const sessionData = await createSession(trimmedKey)
      logger.info('[Auth] Session created', {
        sessionId: sessionData.sessionId,
        userType: sessionData.userType
      })

      // Get old session info BEFORE storing new session
      const oldSessionId = getStoredSessionId()

      // Clear old session storage if switching sessions
      if (oldSessionId && oldSessionId !== sessionData.sessionId) {
        logger.info('[Auth] Clearing old session storage', { oldSessionId })
        clearAllSessionStorage(oldSessionId)
      }

      // Store new session data in localStorage
      storeSessionId(sessionData.sessionId)
      storeUserType(sessionData.userType)

      // For mobile app: Notify about the auth change before reload
      if (isMobileApp()) {
        logger.info('[Auth] Mobile app detected - dispatching authKeyChanged event')

        // Dispatch event that mobile app can listen to
        const event = new window.CustomEvent('authKeyChanged', {
          detail: {
            timestamp: Date.now()
          }
        })
        window.dispatchEvent(event)

        // Also notify parent window via postMessage (for iframe-based mobile apps)
        if (window.parent !== window) {
          window.parent.postMessage(
            {
              type: 'authKeyChanged',
              timestamp: Date.now()
            },
            '*'
          )
        }
      }

      // Reload page (without ?key= in URL - session is now stored in localStorage)
      const url = new URL(window.location.href)
      url.searchParams.delete('key')
      window.location.href = url.toString()
      return { success: true }
    } else {
      return { success: false, error: 'Invalid key' }
    }
  } catch (err) {
    logger.error('[Auth] Key validation failed', {
      error: formatError(err)
    })
    return { success: false, error: 'Failed to validate key' }
  }
}
