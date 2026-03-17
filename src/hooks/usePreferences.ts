/**
 * usePreferences hook
 * Manages user preferences: loading, saving, cleanup, and migrations
 */

import { useState, useEffect } from 'react'
import { createApi } from '../api/client'
import type { UserPreferences } from '../domain/types'
import {
  DEFAULT_PREFERENCES,
  cleanupOrphanedKeys,
  migrateFromSessionStorage
} from '../utils/preferences'
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
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)

  // Load preferences on mount (only if not skipped)
  useEffect(() => {
    if (skipInitialLoad) {
      // Don't auto-set to true - let the caller control this
      return
    }

    const loadPreferences = async () => {
      // Clean up any orphaned keys from schema changes
      cleanupOrphanedKeys(userType, sessionId)

      logger.info('[usePreferences] Loading preferences...', { userType, sessionId })
      const api = createApi(userType as 'public' | 'friend' | 'admin', sessionId)
      const prefs = await api.getPreferences()
      logger.info('[usePreferences] Loaded preferences', { prefs })

      if (prefs) {
        // Check for sessionStorage migration
        const migrations = migrateFromSessionStorage(prefs)
        if (migrations) {
          const newPrefs = { ...prefs, ...migrations, updatedAt: new Date().toISOString() }
          setPreferences(newPrefs)
          // Save migrated preferences
          await api.savePreferences(newPrefs)
          logger.info('[usePreferences] Applied and saved migrations')
        } else {
          setPreferences(prefs)
          logger.info('[usePreferences] Applied preferences to state')
        }
      }

      setPreferencesLoaded(true)
    }

    void loadPreferences()
  }, [userType, sessionId, skipInitialLoad])

  // Save preferences function
  const savePreferences = async (updates: Partial<UserPreferences>) => {
    const newPrefs = { ...preferences, ...updates, updatedAt: new Date().toISOString() }
    setPreferences(newPrefs)

    const api = createApi(userType as 'public' | 'friend' | 'admin', sessionId)
    await api.savePreferences(newPrefs)
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
