/**
 * useTheme hook
 * Manages theme state, auto-switching on system preference changes, and theme picker UI
 */

import { useState, useEffect, useMemo, type RefObject } from 'react'
import type { UserPreferences } from '../domain/types'
import type { ThemeName } from '../app/types'
import { getThemeFamilies, type ThemeFamily } from '../app/themeConfig'

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
 * Hook to manage theme state and behavior
 * Handles theme picker visibility, auto-switching on system preference changes,
 * and applying theme to container element
 */
export function useTheme(
  preferences: UserPreferences,
  savePreferences: (updates: Partial<UserPreferences>) => Promise<void>,
  containerRef: RefObject<HTMLDivElement>,
  preferencesLoaded: boolean = true
): UseThemeReturn {
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [isThemeReady, setIsThemeReady] = useState(false)
  const [isInitialThemeLoad, setIsInitialThemeLoad] = useState(true)

  // Use system preference as default theme (like the loading skeleton)
  const systemPrefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const defaultTheme = systemPrefersDark ? 'dark' : 'light'
  
  const theme = (preferences.theme || defaultTheme) as ThemeName
  const setTheme = (newTheme: ThemeName) => savePreferences({ theme: newTheme })

  // Compute theme families based on experimental preferences
  const THEME_FAMILIES = useMemo(() => 
    getThemeFamilies(preferences.experimentalThemes || false),
    [preferences.experimentalThemes]
  )

  // Apply theme to both document root and container (for microfrontend compatibility)
  useEffect(() => {
    // Apply to document root (for standalone usage)
    document.documentElement.setAttribute('data-theme', theme)

    // Also apply to container (for microfrontend usage where parent may isolate styles)
    if (containerRef.current) {
      containerRef.current.setAttribute('data-theme', theme)
    }

    console.log('[useTheme] Applied theme:', theme, { preferencesLoaded })

    // Only delay theme ready on initial load, not on theme changes
    if (isInitialThemeLoad) {
      // Mark theme as ready after a brief delay to ensure CSS has been applied
      const timer = setTimeout(() => {
        setIsThemeReady(true)
        setIsInitialThemeLoad(false)
      }, 50)
      return () => clearTimeout(timer)
    } else {
      // Theme changes are instant - no skeleton needed
      setIsThemeReady(true)
    }
  }, [theme, containerRef, preferencesLoaded, isInitialThemeLoad])

  // Auto-switch theme variant when system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleColorSchemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const prefersDark = e.matches
      
      // Extract theme family and current mode
      const themeFamily = theme.replace(/-light$|-dark$/, '') as string
      const currentMode = theme.endsWith('-dark') ? 'dark' : theme.endsWith('-light') ? 'light' : null
      
      // Only auto-switch if we have a themed family (not base light/dark)
      if (currentMode && themeFamily !== 'light' && themeFamily !== 'dark') {
        const targetMode = prefersDark ? 'dark' : 'light'
        
        if (currentMode !== targetMode) {
          const newTheme = `${themeFamily}-${targetMode}` as ThemeName
          console.log(`[Theme] Auto-switching from ${theme} to ${newTheme} (system preference)`)
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
