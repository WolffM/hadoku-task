/**
 * Hadoku Theme System - Utilities
 * Framework-agnostic theme management for Hadoku themes
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
  'pink-dark'
] as const

export type Theme = typeof THEMES[number]

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
 * @returns Saved theme or 'light' if none saved
 */
export function loadTheme(): Theme {
  const saved = sessionStorage.getItem('hadoku-theme') as Theme
  if (saved && THEMES.includes(saved)) {
    setTheme(saved)
    return saved
  }
  return 'light'
}

/**
 * Initialize theme system on page load
 * Loads saved theme or defaults to light
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
