/**
 * useTheme hook
 * Manages theme state, auto-switching on system preference changes, and theme picker UI
 */

import { useState, useEffect, useRef, useMemo, type RefObject } from 'react'
import type { UserPreferences } from '../domain/types'
import type { ThemeName } from '../app/types'
import { getThemeFamilies, type ThemeFamily } from '../app/themeConfig'

export interface UseThemeReturn {
  theme: ThemeName
  showThemePicker: boolean
  setShowThemePicker: (show: boolean) => void
  themePickerRef: RefObject<HTMLDivElement>
  THEME_FAMILIES: ThemeFamily[]
  setTheme: (theme: ThemeName) => void
}

/**
 * Hook to manage theme state and behavior
 * Handles theme picker visibility, auto-switching on system preference changes,
 * and applying theme to container element
 */
export function useTheme(
  preferences: UserPreferences,
  savePreferences: (updates: Partial<UserPreferences>) => Promise<void>,
  containerRef: RefObject<HTMLDivElement>
): UseThemeReturn {
  const [showThemePicker, setShowThemePicker] = useState(false)
  const themePickerRef = useRef<HTMLDivElement>(null)

  const theme = (preferences.theme || 'light') as ThemeName
  const setTheme = (newTheme: ThemeName) => savePreferences({ theme: newTheme })

  // Compute theme families based on experimental preferences
  const THEME_FAMILIES = useMemo(() => 
    getThemeFamilies(preferences.experimentalThemes || false),
    [preferences.experimentalThemes]
  )

  // Apply theme to container element
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.setAttribute('data-theme', theme)
    }
  }, [theme, containerRef])

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
    themePickerRef,
    THEME_FAMILIES,
    setTheme
  }
}
