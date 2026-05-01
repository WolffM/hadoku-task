/**
 * useTheme hook
 * Manages theme state, auto-switching on system preference changes, and theme picker UI
 */

import { useState, useEffect, useMemo, useCallback, type RefObject } from 'react'
import type { UserPreferences } from '../domain/types'
import type { ThemeName } from '../app/types'
import { getThemeFamilies, isExperimentalTheme, type ThemeFamily } from '../app/themeConfig'
import { logger } from '@wolffm/task-ui-components'
import { setTheme as applyThemeToDOM, setThemeMode as applyThemeModeToDOM } from '@wolffm/themes'

export interface UseThemeReturn {
  theme: ThemeName
  showThemePicker: boolean
  setShowThemePicker: (show: boolean) => void
  THEME_FAMILIES: ThemeFamily[]
  setTheme: (theme: ThemeName) => void
  isThemeReady: boolean
  isInitialThemeLoad: boolean
}

/**
 * Validate if a theme is available given the experimental themes setting
 */
function isThemeAvailable(themeName: string | undefined, experimentalEnabled: boolean): boolean {
  if (!themeName) return false

  const families = getThemeFamilies(experimentalEnabled)
  return families.some(f => f.lightTheme === themeName || f.darkTheme === themeName)
}

/**
 * Hook to manage theme state and behavior
 * Handles theme picker visibility, auto-switching on system preference changes,
 * and applying theme to container element
 */
export function useTheme(
  preferences: UserPreferences,
  savePreferences: (updates: Partial<UserPreferences>) => Promise<void>,
  containerRef: RefObject<HTMLDivElement | null>,
  preferencesLoaded: boolean = true,
  initialTheme?: string
): UseThemeReturn {
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [isThemeReady, setIsThemeReady] = useState(false)
  const [isInitialThemeLoad, setIsInitialThemeLoad] = useState(true)
  const [pendingTheme, setPendingTheme] = useState<ThemeName | null>(null)

  // Use system preference as default theme (like the loading skeleton)
  const systemPrefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  const defaultTheme = systemPrefersDark ? 'dark' : 'light'

  // Auto-enable experimental themes if initialTheme is experimental
  useEffect(() => {
    if (initialTheme && isExperimentalTheme(initialTheme) && !preferences.experimentalThemes) {
      logger.info(
        `[useTheme] Auto-enabling experimental themes for mount parameter: ${initialTheme}`
      )
      savePreferences({ experimentalThemes: true })
    }
  }, [initialTheme, preferences.experimentalThemes, savePreferences])

  // Clear pending theme once preferences sync catches up
  useEffect(() => {
    if (pendingTheme !== null && preferences.theme === pendingTheme) {
      setPendingTheme(null)
    }
  }, [preferences.theme, pendingTheme])

  // Compute theme families based on experimental preferences
  const THEME_FAMILIES = useMemo(
    () => getThemeFamilies(preferences.experimentalThemes || false),
    [preferences.experimentalThemes]
  )

  // Validate and sanitize theme - prioritize user selection, then mount params, then preferences
  const theme = useMemo(() => {
    // Priority 1: Pending theme (user just clicked a theme in the picker - always wins)
    if (pendingTheme && isThemeAvailable(pendingTheme, preferences.experimentalThemes || false)) {
      return pendingTheme
    }

    // Priority 2: User preferences (saved theme from previous session)
    // Check this before initialTheme so that a user's saved choice isn't overridden
    // by the parent site's theme prop on every mount
    const requestedTheme = preferences.theme

    // Check if the requested theme is available
    if (isThemeAvailable(requestedTheme, preferences.experimentalThemes || false)) {
      return requestedTheme as ThemeName
    }

    // Theme is invalid or not available (e.g., experimental theme but experimentalThemes=false)
    // Try to find a suitable fallback based on the requested theme's mode (light/dark)
    if (requestedTheme) {
      const isDarkMode = requestedTheme.endsWith('-dark') || requestedTheme === 'dark'
      const fallbackTheme = isDarkMode ? 'dark' : 'light'

      // Log the fallback for debugging
      if (preferencesLoaded) {
        logger.info(
          `[useTheme] Theme '${requestedTheme}' not available, falling back to '${fallbackTheme}'`,
          {
            experimentalEnabled: preferences.experimentalThemes || false
          }
        )
      }

      return fallbackTheme as ThemeName
    }

    // Priority 3: Mount parameter theme (initial theme from parent site)
    // Used as default when user has no saved preference yet
    if (initialTheme && isThemeAvailable(initialTheme, preferences.experimentalThemes || false)) {
      logger.info(`[useTheme] Using theme from mount parameter: ${initialTheme}`)
      return initialTheme as ThemeName
    }

    // Priority 4: System preference (lowest priority)
    return defaultTheme as ThemeName
  }, [
    initialTheme,
    pendingTheme,
    preferences.theme,
    preferences.experimentalThemes,
    defaultTheme,
    preferencesLoaded
  ])

  const setTheme = useCallback(
    (newTheme: ThemeName) => {
      setPendingTheme(newTheme)
      applyThemeToDOM(newTheme)
      savePreferences({ theme: newTheme })
    },
    [savePreferences]
  )

  // Apply theme to both document root and container (for microfrontend compatibility)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    if (containerRef.current) {
      containerRef.current.setAttribute('data-theme', theme)
    }

    logger.info(`[useTheme] Applied theme: ${theme}`, { preferencesLoaded })

    if (isInitialThemeLoad) {
      const timer = setTimeout(() => {
        setIsThemeReady(true)
        setIsInitialThemeLoad(false)
      }, 50)
      return () => clearTimeout(timer)
    } else {
      setIsThemeReady(true)
    }
  }, [theme, containerRef, preferencesLoaded, isInitialThemeLoad])

  // Apply theme-mode attribute. The themes package owns documentElement;
  // we mirror to containerRef for microfrontend host isolation.
  useEffect(() => {
    const mode = preferences.themeMode ?? 'advanced'
    applyThemeModeToDOM(mode)
    if (containerRef.current) {
      containerRef.current.setAttribute('data-theme-mode', mode)
    }
  }, [preferences.themeMode, containerRef])

  // Auto-switch theme variant when system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleColorSchemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const prefersDark = e.matches

      // Extract theme family and current mode
      const themeFamily = theme.replace(/-light$|-dark$/, '') as string
      const currentMode = theme.endsWith('-dark')
        ? 'dark'
        : theme.endsWith('-light')
          ? 'light'
          : null

      // Only auto-switch if we have a themed family (not base light/dark)
      if (currentMode && themeFamily !== 'light' && themeFamily !== 'dark') {
        const targetMode = prefersDark ? 'dark' : 'light'

        if (currentMode !== targetMode) {
          const newTheme = `${themeFamily}-${targetMode}` as ThemeName
          logger.info(`[Theme] Auto-switching from ${theme} to ${newTheme} (system preference)`)
          setTheme(newTheme)
        }
      }
    }

    // Listen for changes
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleColorSchemeChange)
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleColorSchemeChange)
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleColorSchemeChange)
      } else {
        mediaQuery.removeListener(handleColorSchemeChange)
      }
    }
  }, [theme, setTheme])

  return {
    theme,
    showThemePicker,
    setShowThemePicker,
    THEME_FAMILIES,
    setTheme,
    isThemeReady,
    isInitialThemeLoad
  }
}
