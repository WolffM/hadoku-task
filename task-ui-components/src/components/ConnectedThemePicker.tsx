/**
 * ConnectedThemePicker - Stateful theme picker component
 * A convenience wrapper around ThemePicker with built-in state management
 */

import React from 'react'
import { ThemePicker } from './ThemePicker'
import type { ThemeFamily, DropdownPlacement } from '../types'

export interface ConnectedThemePickerProps {
  /** Available theme families */
  themeFamilies: ThemeFamily[]
  /** Current active theme */
  currentTheme: string
  /** Callback when theme is changed */
  onThemeChange: (theme: string) => void
  /** Optional: Function to get icon for current theme (for toggle button) */
  getThemeIcon?: (theme: string) => React.ReactNode
  /** Optional: CSS class name for the container */
  className?: string
  /** Optional callback when settings icon is clicked */
  onSettingsClick?: () => void
  /** Optional: Direction the dropdown opens. Defaults to 'auto' (edge detection) */
  dropdownPlacement?: DropdownPlacement
}

/**
 * ConnectedThemePicker - A stateful theme picker with built-in open/close state management
 *
 * This component manages its own isOpen state, making it easier to use than the base ThemePicker.
 *
 * @example
 * ```tsx
 * import { ConnectedThemePicker } from '@wolffm/task-ui-components'
 * import { THEME_FAMILIES, THEME_ICON_MAP } from '@wolffm/themes'
 * import '@wolffm/task-ui-components/theme-picker.css'
 *
 * function App() {
 *   const { theme, setTheme } = useTheme()
 *
 *   return (
 *     <ConnectedThemePicker
 *       themeFamilies={THEME_FAMILIES}
 *       currentTheme={theme}
 *       onThemeChange={setTheme}
 *       getThemeIcon={(theme) => {
 *         const Icon = THEME_ICON_MAP[theme]
 *         return Icon ? <Icon /> : null
 *       }}
 *     />
 *   )
 * }
 * ```
 */
export function ConnectedThemePicker({
  themeFamilies,
  currentTheme,
  onThemeChange,
  getThemeIcon,
  className,
  onSettingsClick,
  dropdownPlacement
}: ConnectedThemePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <ThemePicker
      currentTheme={currentTheme}
      isOpen={isOpen}
      themeFamilies={themeFamilies}
      onThemeChange={onThemeChange}
      onToggle={() => setIsOpen(!isOpen)}
      getThemeIcon={getThemeIcon}
      className={className}
      onSettingsClick={onSettingsClick}
      dropdownPlacement={dropdownPlacement}
    />
  )
}
