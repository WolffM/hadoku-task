/**
 * usePreferences hook
 * Holds user preferences state. The initial load is useSessionInitialization's
 * (it settles the sessionId first); saves go through App's handleSavePreferences.
 */

import { useState } from 'react'
import type { UserPreferences } from '../domain/types'
import { DEFAULT_TASK_PREFERENCES } from '../prefs/taskPrefs'

export interface UsePreferencesReturn {
  preferences: UserPreferences
  preferencesLoaded: boolean
  isDarkTheme: boolean
  setPreferences: (prefs: UserPreferences) => void
  setPreferencesLoaded: (loaded: boolean) => void
}

export function usePreferences(): UsePreferencesReturn {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_TASK_PREFERENCES)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)

  // Compute if current theme is dark
  const isDarkTheme = preferences.theme?.endsWith('-dark') || preferences.theme === 'dark'

  return {
    preferences,
    preferencesLoaded,
    isDarkTheme,
    setPreferences,
    setPreferencesLoaded
  }
}
