/**
 * Shared theme-name utilities for the hadoku.me theme contract.
 *
 * The host page persists the current theme in sessionStorage under
 * 'hadoku-theme' and applies it as data-theme on <html>. The stored value is
 * either a fully-qualified theme name ('light', 'dark', '<family>-light',
 * '<family>-dark') or a bare family token (e.g. 'coffee') that must be
 * expanded to a variant using the system color-scheme preference.
 */

import { THEME_FAMILIES } from '@wolffm/themes'
import type { ThemeName } from '../app/types'

/** sessionStorage key shared with the hadoku.me host page + FOUC head script. */
const THEME_STORAGE_KEY = 'hadoku-theme'

const VALID_THEMES = new Set<string>(THEME_FAMILIES.flatMap(f => [f.lightTheme, f.darkTheme]))

// Family token → variant pair, e.g. 'coffee' → { light: 'coffee-light',
// dark: 'coffee-dark' }. The base family maps 'light'/'dark' to themselves,
// but those are already fully-qualified and matched by VALID_THEMES first.
const FAMILY_VARIANTS = new Map<string, { light: string; dark: string }>(
  THEME_FAMILIES.map(f => [
    f.lightTheme.replace(/-light$/, ''),
    { light: f.lightTheme, dark: f.darkTheme }
  ])
)

/**
 * Normalize a raw theme value (from sessionStorage or a storage event) to a
 * fully-qualified ThemeName. Bare family tokens expand to the light/dark
 * variant per `prefersDark`. Returns null for unrecognized values so callers
 * can fall back to their own default instead of silently landing on 'light'.
 */
function normalizeThemeName(
  value: string | null | undefined,
  prefersDark: boolean
): ThemeName | null {
  const raw = value?.trim()
  if (!raw) return null
  if (VALID_THEMES.has(raw)) return raw as ThemeName
  const variants = FAMILY_VARIANTS.get(raw)
  if (variants) return (prefersDark ? variants.dark : variants.light) as ThemeName
  return null
}

/** Read + normalize the shared theme key. Safe when storage is unavailable. */
export function readStoredTheme(prefersDark: boolean): ThemeName | null {
  if (typeof window === 'undefined') return null
  try {
    return normalizeThemeName(window.sessionStorage.getItem(THEME_STORAGE_KEY), prefersDark)
  } catch {
    return null
  }
}
