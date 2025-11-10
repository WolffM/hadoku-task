/**
 * ThemePicker component
 * A beautiful theme picker with light/dark variants for each theme family
 * Designed to work with any theme system via configuration
 */

import React from 'react'
import type { ThemePickerProps } from '../types'
import { SettingsIcon, MoonIcon, getFallbackIcon } from './ThemeIcons'

/**
 * ThemePicker - Dropdown theme selector with optional settings button
 *
 * @example
 * ```tsx
 * import { ThemePicker } from '@wolffm/task-ui-components'
 * import '@wolffm/task-ui-components/theme-picker.css'
 *
 * <ThemePicker
 *   currentTheme="dark"
 *   isOpen={showPicker}
 *   themeFamilies={MY_THEME_FAMILIES}
 *   onThemeChange={setTheme}
 *   onToggle={() => setShowPicker(!showPicker)}
 *   onSettingsClick={() => openSettings()}
 * />
 * ```
 */
export function ThemePicker({
  currentTheme,
  isOpen,
  themeFamilies,
  onThemeChange,
  onToggle,
  onSettingsClick,
  getThemeIcon,
  className = ''
}: ThemePickerProps) {
  // Get icon for current theme (use provided function or fallback to MoonIcon)
  const currentIcon = getThemeIcon ? getThemeIcon(currentTheme) : <MoonIcon />

  return (
    <div className={`theme-picker ${className}`}>
      <button
        className="theme-toggle-btn"
        onClick={onToggle}
        aria-label="Choose theme"
        title="Choose theme"
      >
        {currentIcon}
      </button>
      {isOpen && (
        <div className="theme-picker__dropdown" onClick={e => e.stopPropagation()}>
          <div className="theme-picker__pills">
            {themeFamilies.map((family, idx) => {
              // Use provided icons or fallback to generic shapes
              const lightIcon = family.lightIcon ?? getFallbackIcon(idx)
              const darkIcon = family.darkIcon ?? getFallbackIcon(idx)

              return (
                <div key={idx} className="theme-pill">
                  {/* Light variant button */}
                  <button
                    className={`theme-pill__btn theme-pill__btn--light ${currentTheme === family.lightTheme ? 'active' : ''}`}
                    onClick={() => onThemeChange(family.lightTheme)}
                    title={family.lightLabel}
                    aria-label={family.lightLabel}
                  >
                    <div className="theme-pill__icon">{lightIcon}</div>
                  </button>

                  {/* Dark variant button */}
                  <button
                    className={`theme-pill__btn theme-pill__btn--dark ${currentTheme === family.darkTheme ? 'active' : ''}`}
                    onClick={() => onThemeChange(family.darkTheme)}
                    title={family.darkLabel}
                    aria-label={family.darkLabel}
                  >
                    <div className="theme-pill__icon">{darkIcon}</div>
                  </button>
                </div>
              )
            })}
          </div>
          {/* Settings button - separate column on the right */}
          {onSettingsClick && (
            <button
              className="theme-picker__settings-icon"
              onClick={() => {
                onSettingsClick()
                onToggle() // Close picker after opening settings
              }}
              aria-label="Settings"
              title="Settings"
            >
              <SettingsIcon />
            </button>
          )}
        </div>
      )}
      {isOpen && <div className="theme-picker__overlay" onClick={onToggle} />}
    </div>
  )
}
