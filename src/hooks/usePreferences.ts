/**
 * usePreferences hook
 * Manages user preferences: loading, saving, cleanup, and migrations
 */

import { useState, useEffect } from 'react'
import type { UserPreferences } from '../domain/types'
import {
  loadTaskPreferences,
  saveTaskPreferences,
  DEFAULT_TASK_PREFERENCES
} from '../prefs/taskPrefs'
import { logger } from '@wolffm/task-ui-components'

export interface UsePreferencesReturn {
  preferences: UserPreferences
  savePreferences: (updates: Partial<UserPreferences>) => Promise<void>
  preferencesLoaded: boolean
  isDarkTheme: boolean
  setPreferences: (prefs: UserPreferences) => void
  setPreferencesLoaded: (loaded: boolean) => void
}

/**
 * Hook to manage user preferences
 * Handles loading, saving, migrations, and storage cleanup
 *
 * NOTE: Initial loading is now handled by App.tsx via session handshake.
 * This hook maintains preferences state and provides save functionality.
 */
export function usePreferences(
  userType: string,
  sessionId: string,
  skipInitialLoad: boolean = false
): UsePreferencesReturn {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_TASK_PREFERENCES)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)

  // Load preferences on mount (only if not skipped)
  useEffect(() => {
    if (skipInitialLoad) {
      // Don't auto-set to true - let the caller control this
      return
    }

    const loadPreferences = async () => {
      logger.info('[usePreferences] Loading preferences...', { userType, sessionId })
      // Unified prefs store (SDK). Legacy simpleMode→themeMode migration now
      // lives in the SDK's migrations chain; the one-shot legacy-store
      // migration runs inside loadTaskPreferences on first load.
      const prefs = await loadTaskPreferences(userType, sessionId)
      logger.info('[usePreferences] Loaded preferences', { prefs })

      if (prefs) {
        setPreferences(prefs)
        logger.info('[usePreferences] Applied preferences to state')
      }

      setPreferencesLoaded(true)
    }

    void loadPreferences()
  }, [userType, sessionId, skipInitialLoad])

  // Save preferences function. Optimistically update local state, then persist
  // the delta through the SDK (scope-split + debounced PUT). We pass `updates`
  // (the delta) rather than the merged object so each scope only re-writes its
  // changed fields.
  const savePreferences = async (updates: Partial<UserPreferences>) => {
    const newPrefs = { ...preferences, ...updates, updatedAt: new Date().toISOString() }
    setPreferences(newPrefs)
    await saveTaskPreferences(updates)
  }

  // Compute if current theme is dark
  const isDarkTheme = preferences.theme?.endsWith('-dark') || preferences.theme === 'dark'

  return {
    preferences,
    savePreferences,
    preferencesLoaded,
    isDarkTheme,
    setPreferences,
    setPreferencesLoaded
  }
}
