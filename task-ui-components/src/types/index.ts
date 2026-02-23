/**
 * Type definitions for @wolffm/task-ui-components
 */

import type { ReactNode } from 'react'

/**
 * Theme name - can be any string that matches your theme system
 */
export type ThemeName = string

/**
 * Theme family configuration
 * Represents a light/dark theme pair with icons and labels
 *
 * Icons are optional - if not provided, the ThemePicker will use fallback icons
 * based on the theme's position in the array
 */
export interface ThemeFamily {
  lightIcon?: ReactNode
  darkIcon?: ReactNode
  lightTheme: ThemeName
  darkTheme: ThemeName
  lightLabel: string
  darkLabel: string
}

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
}
