/**
 * useTheme React hook - React integration for theme management
 * Provides stateful theme + theme-mode management with React.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  getTheme,
  setTheme as setThemeVanilla,
  saveTheme,
  getThemeMode,
  setThemeMode as setThemeModeVanilla,
  saveThemeMode,
  loadThemeMode
} from './index'
import type { Theme, ThemeMode } from './index'
import { hasAdvanced as themeHasAdvanced } from './effects'

/**
 * React hook for theme management.
 *
 * Returns the active theme + theme mode and setters that persist
 * across reloads. `hasAdvanced` is true when the active theme ships
 * an advanced visual contract — UI uses it to show/hide the
 * Simple/Advanced toggle.
 *
 * @example
 * ```tsx
 * import { useTheme } from '@wolffm/themes'
 *
 * function MyComponent() {
 *   const { theme, setTheme, themeMode, setThemeMode, hasAdvanced } = useTheme()
 *   return (
 *     <>
 *       <button onClick={() => setTheme('dark')}>Current: {theme}</button>
 *       {hasAdvanced && (
 *         <button onClick={() => setThemeMode(themeMode === 'simple' ? 'advanced' : 'simple')}>
 *           Mode: {themeMode}
 *         </button>
 *       )}
 *     </>
 *   )
 * }
 * ```
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('light')
  const [themeMode, setThemeModeState] = useState<ThemeMode>('simple')

  useEffect(() => {
    setThemeState(getTheme())
    setThemeModeState(loadThemeMode())

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'hadoku-theme') {
        setThemeState(getTheme())
      } else if (e.key === 'hadoku-theme-mode') {
        setThemeModeState(getThemeMode())
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeVanilla(newTheme)
    saveTheme(newTheme)
    setThemeState(newTheme)
  }, [])

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeVanilla(mode)
    saveThemeMode(mode)
    setThemeModeState(mode)
  }, [])

  return {
    theme,
    setTheme,
    themeMode,
    setThemeMode,
    hasAdvanced: themeHasAdvanced(theme)
  }
}
