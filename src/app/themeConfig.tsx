/**
 * Theme configuration
 * Splits the package's THEME_FAMILIES into base + experimental sets,
 * gated by the user's experimentalThemes preference, and provides a
 * helper to look up the icon for a specific theme.
 */

import React from 'react'
import { THEME_FAMILIES as ALL_THEME_FAMILIES } from '@wolffm/themes'
import { MoonIcon } from '@wolffm/task-ui-components'
import type { ThemeFamily as PackageThemeFamily } from '@wolffm/task-ui-components'
import type { ThemeName } from './types'

export type ThemeFamily = PackageThemeFamily

/**
 * Theme families that are gated behind the experimentalThemes pref.
 * Everything else from the package is shown by default.
 */
const EXPERIMENTAL_THEMES = new Set<string>([
  'cyberpunk-light',
  'cyberpunk-dark',
  'pink-light',
  'pink-dark',
  'izakaya-light',
  'izakaya-dark'
])

const BASE_THEME_FAMILIES: ThemeFamily[] = ALL_THEME_FAMILIES.filter(
  f => !EXPERIMENTAL_THEMES.has(f.lightTheme) && !EXPERIMENTAL_THEMES.has(f.darkTheme)
)

const EXPERIMENTAL_THEME_FAMILIES: ThemeFamily[] = ALL_THEME_FAMILIES.filter(
  f => EXPERIMENTAL_THEMES.has(f.lightTheme) || EXPERIMENTAL_THEMES.has(f.darkTheme)
)

/**
 * Get all theme families based on experimental preference
 */
export function getThemeFamilies(experimentalEnabled: boolean): ThemeFamily[] {
  return experimentalEnabled
    ? [...BASE_THEME_FAMILIES, ...EXPERIMENTAL_THEME_FAMILIES]
    : BASE_THEME_FAMILIES
}

/**
 * Check if a theme is experimental
 */
export function isExperimentalTheme(themeName: string): boolean {
  return EXPERIMENTAL_THEMES.has(themeName)
}

/**
 * Get icon for a specific theme
 */
export function getThemeIcon(themeName: ThemeName, experimentalEnabled: boolean): React.ReactNode {
  const families = getThemeFamilies(experimentalEnabled)
  const family = families.find(f => f.lightTheme === themeName || f.darkTheme === themeName)
  if (!family) return <MoonIcon />
  return themeName.endsWith('-dark') || themeName === 'dark' ? family.darkIcon : family.lightIcon
}
