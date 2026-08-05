/**
 * Type definitions for @wolffm/task-ui-components
 */

import type { ReactNode } from 'react'
// The theme MODEL lives in @wolffm/themes now; this file keeps only the types
// that describe THIS package's components. Re-exported so existing imports of
// ThemeName/ThemeFamily/ThemeMode from here keep resolving — to the same
// declarations, not copies.
export type { ThemeName, ThemeFamily, ThemeMode } from '@wolffm/themes'
import type { ThemeName, ThemeFamily, ThemeMode } from '@wolffm/themes'

/**
 * Dropdown placement direction
 * - 'right': Opens to the right of the toggle button (default)
 * - 'left': Opens to the left of the toggle button
 * - 'auto': Automatically detects edge collisions and flips direction
 */
export type DropdownPlacement = 'left' | 'right' | 'auto'

/**
 * Theme picker component props
 */
export interface ThemePickerProps {
  /** Current active theme */
  currentTheme: ThemeName
  /** Whether the theme picker dropdown is visible */
  isOpen: boolean
  /** Available theme families */
  themeFamilies: ThemeFamily[]
  /** Callback when theme is changed */
  onThemeChange: (theme: ThemeName) => void
  /** Callback to toggle picker visibility */
  onToggle: () => void
  /** Optional callback when settings icon is clicked */
  onSettingsClick?: () => void
  /** Optional: Function to get icon for current theme (for toggle button) */
  getThemeIcon?: (theme: ThemeName) => ReactNode
  /** Optional: CSS class name for the container */
  className?: string
  /** Optional: Direction the dropdown opens. Defaults to 'auto' (edge detection) */
  dropdownPlacement?: DropdownPlacement
  /** Optional: Active theme mode. Required to render the Simple/Advanced toggle. */
  themeMode?: ThemeMode
  /** Optional: Callback when theme mode is changed. Required to render the toggle. */
  onThemeModeChange?: (mode: ThemeMode) => void
  /** Optional: True when the active theme has an advanced visual contract.
   *  Toggle is hidden when false. */
  hasAdvanced?: boolean
}
