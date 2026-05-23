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
import { loadTaskPreferences } from '../prefs/taskPrefs'
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

      // Determine the effective sessionId to use
      let finalSessionId = propsSessionId
      if (userType === 'public') {
        // Public users: use their stable localStorage sessionId
        finalSessionId = getStoredSessionId() || propsSessionId

        // Load preferences from the unified store (SDK). For public/anon the
        // SDK serves its localStorage cache (prefs-api 401s anon, by design).
        const prefs = await loadTaskPreferences('public', finalSessionId)
        setPreferences(prefs)
        setPreferencesLoaded(true)
      } else {
        // Authenticated users: use the sessionId from props (from parent)
        finalSessionId = propsSessionId

        // Load the merged (user + device) view from the unified store. The SDK
        // already merges scopes + applies defaults, so the old localStorage-vs-
        // server priority dance is gone (handshakeResult.preferences was always
        // null client-side anyway). The one-shot legacy migration runs inside
        // loadTaskPreferences on first load for this session.
        const prefs = await loadTaskPreferences(userType, finalSessionId)
        setPreferences(prefs)
        setPreferencesLoaded(true)

        // Clear old session storage keys if sessionId changed
        if (oldSessionId && oldSessionId !== propsSessionId) {
          logger.info('[App] SessionId changed, clearing old storage')
          clearOldSessionStorage(oldSessionId, userType)
        }

        // Welcome toast for authenticated users with a display name (user-scoped,
        // so it follows the account across devices).
        const displayName = prefs?.displayName
        if (displayName) {
          showToast(`Welcome back, ${displayName}`, 'success')
        }
      }

      // Set the effective sessionId for all hooks to use (only if different)
      if (finalSessionId !== effectiveSessionId) {
        setEffectiveSessionId(finalSessionId)
      }

      // Unblock the shell as soon as preferences are resolved. useTasks's own
      // user-context effect has already hydrated tasks/boards from localStorage
      // by this point, so the shell renders with cached data immediately.
      // initialLoad() (which talks to the API and replaces local state with the
      // server view) runs in the background and surfaces fresh data when ready.
      setIsLoaded(true)

      // Background data sync — don't gate first paint on the network round-trip.
      void initialLoad().catch(err => {
        logger.warn('[App] initialLoad failed in background', { error: String(err) })
      })
    }

    void initializeSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType, propsSessionId])
}
