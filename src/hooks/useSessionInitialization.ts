/**
 * Hook for handling session initialization and handshake
 */

import { useEffect } from 'react'
import type { UserPreferences } from '../domain/types'
import {
  performSessionHandshake,
  clearOldSessionStorage,
  getStoredSessionId,
  storeUserType
} from '../api/session'
import { createApi } from '../api/client'
import { logger } from '@wolffm/task-ui-components'
import { logPackageVersions } from '../utils/version'

interface UseSessionInitializationProps {
  userType: string
  propsSessionId: string
  preferences: UserPreferences
  effectiveSessionId: string
  setEffectiveSessionId: (sessionId: string) => void
  setPreferences: (prefs: UserPreferences) => void
  setPreferencesLoaded: (loaded: boolean) => void
  initialLoad: () => Promise<void>
  setIsLoaded: (loaded: boolean) => void
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
}

export function useSessionInitialization({
  userType,
  propsSessionId,
  preferences: _preferences,
  effectiveSessionId,
  setEffectiveSessionId,
  setPreferences,
  setPreferencesLoaded,
  initialLoad,
  setIsLoaded,
  showToast
}: UseSessionInitializationProps) {
  // Session handshake and initialization on mount
  useEffect(() => {
    async function initializeSession() {
      logger.info('[App] Initializing session...', { userType, sessionId: propsSessionId })

      // Log package versions on every page load (helps identify cache issues)
      logPackageVersions()

      // Get old sessionId before handshake
      const oldSessionId = getStoredSessionId()

      // Perform handshake (for public users, this ensures stable sessionId in localStorage)
      const handshakeResult = await performSessionHandshake(propsSessionId, userType)

      // Check for session expiration - server userType differs from client
      if (handshakeResult.serverUserType !== userType) {
        logger.warn('[App] User type changed - session may have expired', {
          expected: userType,
          actual: handshakeResult.serverUserType
        })

        // If user was authenticated but session expired (now treated as public)
        if (userType !== 'public' && handshakeResult.serverUserType === 'public') {
          // Update stored userType to match server
          storeUserType(handshakeResult.serverUserType)

          // Notify user and reload to reinitialize with correct state
          showToast('Your session has expired. Please enter your key again.', 'info')

          // Small delay to let the toast show before reload
          setTimeout(() => {
            window.location.reload()
          }, 1500)
          return
        }
      }

      const serverPreferences = handshakeResult.preferences

      // Determine the effective sessionId to use
      let finalSessionId = propsSessionId
      if (userType === 'public') {
        // Public users: use their stable localStorage sessionId
        finalSessionId = getStoredSessionId() || propsSessionId

        // For public users, load preferences from localStorage now
        const api = createApi('public', finalSessionId)
        const localPrefs = await api.getPreferences()
        if (localPrefs) {
          setPreferences(localPrefs)
        }
        setPreferencesLoaded(true)
      } else {
        // Authenticated users: use the sessionId from props (from parent)
        finalSessionId = propsSessionId

        // Priority 1: Check localStorage first (device-specific preferences)
        const api = createApi(userType as 'public' | 'friend' | 'admin', finalSessionId)
        const localPrefs = await api.getPreferences()

        // Check if localStorage has actual stored data (not just defaults)
        const hasLocalData = localPrefs && localPrefs.updatedAt !== undefined

        if (hasLocalData) {
          // Use localStorage preferences (device-specific)
          logger.info('[App] Using device-specific localStorage preferences')
          setPreferences(localPrefs)
        } else if (serverPreferences) {
          // Priority 2: Use server preferences as fallback
          logger.info('[App] No localStorage data, using server preferences')
          setPreferences(serverPreferences)
          // Save server preferences to localStorage for next time
          await api.savePreferences(serverPreferences)
        }
        // If neither exists, DEFAULT_PREFERENCES will be used

        setPreferencesLoaded(true)

        // Clear old session storage keys if sessionId changed
        if (oldSessionId && oldSessionId !== propsSessionId) {
          logger.info('[App] SessionId changed, clearing old storage')
          clearOldSessionStorage(oldSessionId, userType)
        }

        // Show welcome toast for authenticated users AFTER preferences are loaded
        // Use the final preferences (either from localStorage or server)
        const finalPrefs = hasLocalData ? localPrefs : serverPreferences
        const displayName = finalPrefs?.displayName

        if (displayName) {
          // Only show toast if user has a display name
          showToast(`Welcome back, ${displayName}`, 'success')
        }
        // Don't show any toast if display name is empty/undefined
      }

      // Set the effective sessionId for all hooks to use (only if different)
      if (finalSessionId !== effectiveSessionId) {
        setEffectiveSessionId(finalSessionId)
      }

      // Now load full data from API
      await initialLoad()

      // Mark as fully loaded (session initialized + preferences loaded + data loaded)
      setIsLoaded(true)
    }

    void initializeSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType, propsSessionId])
}
