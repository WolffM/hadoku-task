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

// Single definition, in theme-types alongside ThemeFamily — it used to be
// declared both here and in task-ui-components' types.
export type { ThemeMode } from './theme-types'
import type { ThemeMode } from './theme-types'

/** Read the theme key from one storage, tolerating environments where the
 *  storage object exists but throws on access (private mode, blocked cookies).
 *  Returns null rather than throwing, so a blocked storage degrades to the
 *  browser-preference fallback instead of breaking theme load entirely. */
function readStored(which: 'sessionStorage' | 'localStorage'): string | null {
  try {
    return window[which].getItem('hadoku-theme')
  } catch {
    return null
  }
}

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
 * Persist the theme and apply it.
 *
 * BOTH storages, deliberately. sessionStorage is what the pre-paint inline
 * `<head>` script reads within a tab, but it dies with the tab — so writing
 * only there meant a browser restart came back with nothing persisted, the
 * script fell through to the browser preference, and the app then swapped to
 * the real theme once React mounted. A visible default-then-swap flash, and
 * "my theme reset itself" for anyone whose theme wasn't the system default.
 * localStorage is what survives, so it is what makes the next cold load paint
 * correctly the first time.
 */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem('hadoku-theme', theme)
    sessionStorage.setItem('hadoku-theme', theme)
  } catch {
    /* storage unavailable (private mode, blocked cookies) — the theme still
       applies for this page, it just won't survive the navigation. */
  }
  setTheme(theme)
}

/**
 * Load the saved theme.
 * @returns Saved theme, or browser preference, or 'light' if none available
 */
export function loadTheme(): Theme {
  // sessionStorage first — within a tab it is the freshest value (the FOUC
  // script and same-tab writes both go there). localStorage is the fallback
  // that carries a theme across a browser restart.
  const saved = (readStored('sessionStorage') ?? readStored('localStorage')) as Theme
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
  // Both, to match saveTheme — clearing only sessionStorage left the
  // localStorage copy to resurrect the theme on the next cold load.
  try {
    sessionStorage.removeItem('hadoku-theme')
    localStorage.removeItem('hadoku-theme')
  } catch {
    /* storage unavailable — nothing was persisted to clear */
  }
  setTheme('light')
}

/**
 * Set the active theme mode (writes data-theme-mode on documentElement).
 * 'advanced' renders the gradient + effects; 'simple' uses flat colors.
 *
 * Nothing calls this with 'advanced' any more: the Simple/Advanced toggle was
 * removed from the picker, and `useTheme` pins the attribute to 'simple' on
 * every theme apply. The mode is not persisted or read back for the same
 * reason — there is no user choice left to remember. The advanced kit itself
 * (advanced.css, THEME_EFFECTS, the hdk-advanced-* class hooks) is untouched
 * and still keys off this attribute, so bringing advanced back means restoring
 * the toggle, not rebuilding the visuals.
 */
export function setThemeMode(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme-mode', mode)
}

// Theme metadata and React integration (optional peer dependencies)
export { THEME_FAMILIES, THEME_ICON_MAP } from './metadata'
export { useTheme } from './useTheme'
export type { UseThemeOptions } from './useTheme'
// The one thing a child app mounts, and the context it fills — deliberately in
// the same package now (see HadokuThemeRoot.tsx).
export { HadokuThemeRoot } from './HadokuThemeRoot'
export { HadokuThemeProvider, useHadokuTheme, useHadokuThemeOptional } from './themeContext'
export type { HadokuThemeValue, HadokuThemeProviderProps } from './themeContext'
// Theme-family icons — moved here from task-ui-components so this package
// depends on nothing of ours.
export {
  SunIcon,
  MoonIcon,
  StrawberryIcon,
  WaveIcon,
  ZapIcon,
  CoffeeIcon,
  FlowerIcon,
  HeartIcon,
  LeafIcon,
  SpaIcon
} from './ThemeIcons'
export type { ThemeName, ThemeFamily } from './theme-types'
export type { HadokuThemeRootProps } from './HadokuThemeRoot'
// Canonical theme prefs client — was copy-pasted into every child app.
export { themePrefs, ThemePrefsSchema } from './themePrefs'
export type { ThemePrefs } from './themePrefs'
// Shared by every prefs client in the ecosystem, so a dev/E2E stack can point
// them all at a local prefs-api with one global instead of mocking the network.
export { resolvePrefsApiBase, PREFS_API_BASE_GLOBAL } from './prefsApiBase'
export { THEME_EFFECTS, hasAdvanced, getThemeEffects } from './effects'
export type { AdvancedEffect, ThemeEffectMap } from './effects'
// Icon module — the enforced ecosystem icon set. Artwork is vendored from lucide
// (ISC, see LICENSE-lucide) and generated into src/icons/registry.generated.ts, so
// this package still ships with zero runtime dependencies and serves the Astro/Qwik
// consumers that have no React at all.
export { Icon } from './icons/Icon'
export type { IconProps } from './icons/Icon'
export {
  ICON_MARKUP,
  ICON_NAMES,
  ICON_SOURCE_SLUGS,
  ICON_FAMILIES,
  LUCIDE_VERSION,
  getIconSvg,
  getIconTileClass,
  isIconName
} from './icons/index'
export type { IconName, IconFamily, IconVariant, IconSvgOptions } from './icons/index'
// Platform context — one device definition for the fleet, replacing six
// hand-rolled `useIsMobile` implementations with four different thresholds.
// Framework-free half is also published at `@wolffm/themes/platform` for the
// plain-TS consumers, exactly as the icon module is.
export {
  detectPlatform,
  createPlatform,
  stampPlatform,
  isSamePlatform,
  NARROW_BREAKPOINT,
  NARROW_QUERY,
  TOUCH_FIRST_QUERY
} from './platform/index'
export type { PlatformSeed, PlatformStore } from './platform/index'
export { usePlatform } from './platform/usePlatform'
export type { UsePlatformOptions } from './platform/usePlatform'
