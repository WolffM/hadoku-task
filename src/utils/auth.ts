/**
 * Authentication utilities
 * Functions for handling user authentication and key validation
 */

import { logger } from '@wolffm/task-ui-components'
import { isMobileApp } from './platform'

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
      // Store the key in sessionStorage (secure, not in URL)
      sessionStorage.setItem('auth_key', trimmedKey)
      logger.info('[Auth] Key validated and stored in sessionStorage')

      // For mobile app: Notify about the auth change
      if (isMobileApp()) {
        logger.info('[Auth] Mobile app detected - dispatching authKeyChanged event')

        // Dispatch event that mobile app can listen to
        const event = new window.CustomEvent('authKeyChanged', {
          detail: {
            timestamp: Date.now()
            // Don't include the actual key - mobile app doesn't need it
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

        // No URL change needed - key is in sessionStorage
        // Page will re-render with new auth state
        window.location.reload()
        return { success: true }
      } else {
        // For web: Also use sessionStorage, just reload to pick up new auth
        logger.info('[Auth] Web app - reloading to apply new auth')
        window.location.reload()
        return { success: true }
      }
    } else {
      return { success: false, error: 'Invalid key' }
    }
  } catch (err) {
    logger.error('[Auth] Key validation failed', {
      error: err instanceof Error ? err.message : String(err)
    })
    return { success: false, error: 'Failed to validate key' }
  }
}

/**
 * Get the stored authentication key from sessionStorage
 * @returns The stored key or null if not found
 */
export function getStoredAuthKey(): string | null {
  return sessionStorage.getItem('auth_key')
}

/**
 * Clear the stored authentication key
 */
export function clearStoredAuthKey(): void {
  sessionStorage.removeItem('auth_key')
  logger.info('[Auth] Cleared stored auth key')
}
