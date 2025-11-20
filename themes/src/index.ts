/**
 * Hadoku Theme System - Utilities
 * Framework-agnostic theme management for Hadoku themes
 * 18 beautiful themes across 9 theme families with light/dark variants
 * Now with React integration support!
 */

export const THEMES = [
  'light',
  'dark',
  'coffee-light',
  'coffee-dark',
  'nature-light',
  'nature-dark',
  'lavender-light',
  'lavender-dark',
  'strawberry-light',
  'strawberry-dark',
  'ocean-light',
  'ocean-dark',
  'cyberpunk-light',
  'cyberpunk-dark',
  'pink-light',
  'pink-dark',
  'izakaya-light',
  'izakaya-dark'
] as const

export type Theme = (typeof THEMES)[number]

/**
 * Set the active theme
 * @param theme - Theme name
 */
export function setTheme(theme: Theme): void {
  if (theme === 'light') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

/**
 * Get the currently active theme
 * @returns Current theme name
 */
export function getTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  return (attr as Theme) || 'light'
}

/**
 * Save theme to sessionStorage and apply it
 * @param theme - Theme name
 */
export function saveTheme(theme: Theme): void {
  sessionStorage.setItem('hadoku-theme', theme)
  setTheme(theme)
}

/**
 * Load saved theme from sessionStorage
 * @returns Saved theme, or browser preference, or 'light' if none available
 */
export function loadTheme(): Theme {
  // First check sessionStorage
  const saved = sessionStorage.getItem('hadoku-theme') as Theme
  if (saved && THEMES.includes(saved)) {
    setTheme(saved)
    return saved
  }

  // If no saved theme, respect browser's color scheme preference
  if (typeof window !== 'undefined' && window.matchMedia) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const browserTheme = prefersDark ? 'dark' : 'light'
    setTheme(browserTheme)
    return browserTheme
  }

  // Final fallback to light
  return 'light'
}

/**
 * Initialize theme system on page load
 * Loads saved theme, respects browser preference, or defaults to light
 */
export function initTheme(): Theme {
  return loadTheme()
}

/**
 * Clear saved theme (reset to light)
 */
export function clearTheme(): void {
  sessionStorage.removeItem('hadoku-theme')
  setTheme('light')
}

// Theme metadata and React integration (optional peer dependencies)
export { THEME_FAMILIES, THEME_ICON_MAP } from './metadata'
export { useTheme } from './useTheme'
