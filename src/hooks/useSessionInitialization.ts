/**
 * Hook for settling the session id and loading preferences on mount.
 *
 * Identity is the edge's: edge-router resolves the hadoku_session cookie and
 * stamps X-User-Id + tier on every /task/api request, and the host page hands us
 * the resulting userType/sessionId as props. There is no app-level session
 * round trip to make.
 */

import { useEffect } from 'react'
import type { UserPreferences } from '../domain/types'
import { getAnonSessionId } from '../api/session'
import { loadTaskPreferences } from '../prefs/taskPrefs'
import { logger } from '@wolffm/logger/client'
import { logPackageVersions } from '../utils/version'

interface UseSessionInitializationProps {
  userType: string
  propsSessionId: string
  effectiveSessionId: string
  setEffectiveSessionId: (sessionId: string) => void
  setPreferences: (prefs: UserPreferences) => void
  setPreferencesLoaded: (loaded: boolean) => void
  setIsLoaded: (loaded: boolean) => void
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
}

export function useSessionInitialization({
  userType,
  propsSessionId,
  effectiveSessionId,
  setEffectiveSessionId,
  setPreferences,
  setPreferencesLoaded,
  setIsLoaded,
  showToast
}: UseSessionInitializationProps) {
  useEffect(() => {
    async function initializeSession() {
      logger.info('[App] Initializing session...', { userType, sessionId: propsSessionId })

      // Log package versions on every page load (helps identify cache issues)
      logPackageVersions()

      // Public users key their local data by the host-independent anon id, NOT
      // hadoku_session_id (which the host wipes for public users every boot).
      // Authenticated users use the host's sessionId as-is. The BOARD load is
      // not driven from here: useTasks owns it (its user-context effect fires on
      // the same sessionId), doing a cache-first paint then a network revalidate.
      const finalSessionId = userType === 'public' ? getAnonSessionId() : propsSessionId

      // For public/anon the SDK serves its localStorage cache (prefs-api 401s
      // anon, by design).
      const prefs = await loadTaskPreferences()
      setPreferences(prefs)
      setPreferencesLoaded(true)

      // Welcome toast for authenticated users with a display name (user-scoped,
      // so it follows the account across devices).
      if (userType !== 'public' && prefs.displayName) {
        showToast(`Welcome back, ${prefs.displayName}`, 'success')
      }

      // Set the effective sessionId for all hooks to use (only if different)
      if (finalSessionId !== effectiveSessionId) {
        setEffectiveSessionId(finalSessionId)
      }

      // Prefs are settled; unblock the theme/prefs half of the reveal gate.
      // Board content is gated separately by useTasks' `boardsLoaded`, which
      // flips after its fast cache paint — so the shell still reveals with
      // content, without this hook waiting on the network.
      setIsLoaded(true)
    }

    void initializeSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType, propsSessionId])
}
