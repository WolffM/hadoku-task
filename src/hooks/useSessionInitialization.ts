/**
 * Hook for handling session initialization and handshake
 */

import { useEffect } from 'react'
import type { UserPreferences } from '../domain/types'
import {
  performSessionHandshake,
  clearOldSessionStorage,
  getStoredSessionId,
  getAnonSessionId,
  storeUserType
} from '../api/session'
import { loadTaskPreferences } from '../prefs/taskPrefs'
import { logger } from '@wolffm/logger/client'
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

      // The handshake is server-side session bookkeeping (KV writes: preferences,
      // session-info, authKey->session mapping). The only thing the client needs
      // out of it is serverUserType, for the rare session-expiry case. So we start
      // it here but do NOT await it before painting — awaiting it used to serialize
      // handshake -> prefs -> boards and put the whole chain on the critical path.
      const handshakePromise = performSessionHandshake(propsSessionId, userType)

      /** Session expired server-side: tell the user and reload. */
      function handleExpiry(serverUserType: string): boolean {
        if (serverUserType === userType) return false
        logger.warn('[App] User type changed - session may have expired', {
          expected: userType,
          actual: serverUserType
        })
        if (userType !== 'public' && serverUserType === 'public') {
          storeUserType(serverUserType)
          showToast('Your session has expired. Please enter your key again.', 'info')
          setTimeout(() => {
            window.location.reload()
          }, 1500)
          return true
        }
        return false
      }

      let finalSessionId = propsSessionId

      if (userType === 'public') {
        // Public handshake never touches the network — it just settles a stable
        // sessionId in localStorage, which finalSessionId depends on. Awaiting it
        // is free.
        const handshakeResult = await handshakePromise
        if (handleExpiry(handshakeResult.serverUserType)) return

        // Public users key their local data by the host-independent anon id, NOT
        // hadoku_session_id (which the host wipes for public users every boot).
        finalSessionId = getAnonSessionId()

        // For public/anon the SDK serves its localStorage cache (prefs-api 401s
        // anon, by design).
        const prefs = await loadTaskPreferences('public', finalSessionId)
        setPreferences(prefs)
        setPreferencesLoaded(true)
      } else {
        // Authenticated: finalSessionId is propsSessionId, known without the
        // handshake. So prefs and the board sync can both run concurrently with
        // the in-flight handshake instead of queueing behind it.
        finalSessionId = propsSessionId

        // Kick the board sync off now. It's the long pole (the boards fetch is
        // the slowest call in the load), and it needs nothing from the handshake
        // or from prefs — useTasks already holds the right sessionId on first
        // render. Starting it here rather than after both awaits is what gets
        // tasks on screen sooner.
        const boardSync = initialLoad().catch(err => {
          logger.warn('[App] initialLoad failed in background', { error: String(err) })
        })

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

        // Expiry is handled off the critical path. If the key was revoked the
        // board sync 401s and reports through onSyncError anyway; this just adds
        // the explicit "enter your key again" prompt + reload.
        void handshakePromise
          .then(r => handleExpiry(r.serverUserType))
          .catch(err => logger.warn('[App] handshake failed', { error: String(err) }))
        void boardSync
      }

      // Set the effective sessionId for all hooks to use (only if different)
      if (finalSessionId !== effectiveSessionId) {
        setEffectiveSessionId(finalSessionId)
      }

      // Unblock the shell as soon as preferences are resolved. useTasks's own
      // user-context effect has already hydrated tasks/boards from localStorage
      // by this point, so the shell renders with cached data immediately.
      setIsLoaded(true)

      if (userType === 'public') {
        // Public has no syncFromApi; this just re-reads localStorage.
        void initialLoad().catch(err => {
          logger.warn('[App] initialLoad failed in background', { error: String(err) })
        })
      }
    }

    void initializeSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType, propsSessionId])
}
