/**
 * Authentication utilities
 * Functions for handling user authentication and key validation
 */

import { logger } from '@wolffm/task-ui-components'
import { formatError } from '../domain/utils/tags'
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
      // Reload with ?key= parameter so parent site can validate and set userType/sessionId
      logger.info('[Auth] Key validated - reloading with key parameter')

      // Get current URL and add/update the key parameter
      const url = new URL(window.location.href)
      url.searchParams.set('key', trimmedKey)

      // For mobile app: Notify about the auth change before reload
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
      }

      // Reload with the key in URL so parent site can process it
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
