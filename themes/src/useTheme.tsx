/**
 * useTheme React hook - React integration for theme management
 * Provides stateful theme management with React
 */

import { useState, useEffect } from 'react'
import { getTheme, setTheme as setThemeVanilla, saveTheme } from './index'
import type { Theme } from './index'

/**
 * React hook for theme management
 *
 * @returns Object with current theme and setter function
 *
 * @example
 * ```tsx
 * import { useTheme } from '@wolffm/themes'
 *
 * function MyComponent() {
 *   const { theme, setTheme } = useTheme()
 *
 *   return (
 *     <button onClick={() => setTheme('dark')}>
 *       Current: {theme}
 *     </button>
 *   )
 * }
 * ```
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('light')

  useEffect(() => {
    // Initialize with current theme
    setThemeState(getTheme())

    // Listen for theme changes from other sources (e.g., other tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'hadoku-theme') {
        setThemeState(getTheme())
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const setTheme = (newTheme: Theme) => {
    setThemeVanilla(newTheme)
    saveTheme(newTheme)
    setThemeState(newTheme)
  }

  return { theme, setTheme }
}
