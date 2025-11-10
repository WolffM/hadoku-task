/**
 * AppHeader component
 * Displays app title and theme picker dropdown
 */

import React from 'react'
import { SettingsIcon } from '@wolffm/task-ui-components'
import { getThemeIcon, type ThemeFamily } from '../app/themeConfig'
import type { ThemeName } from '../app/types'

export interface AppHeaderProps {
  theme: ThemeName
  experimentalThemes: boolean
  showThemePicker: boolean
  onThemePickerToggle: () => void
  onThemeChange: (theme: ThemeName) => void
  onSettingsClick: () => void
  THEME_FAMILIES: ThemeFamily[]
}

export function AppHeader({
  theme,
  experimentalThemes,
  showThemePicker,
  onThemePickerToggle,
  onThemeChange,
  onSettingsClick,
  THEME_FAMILIES
}: AppHeaderProps) {
  return (
    <div className="task-app__header-container">
      <h1
        className="task-app__header"
        onClick={onSettingsClick}
        style={{ cursor: 'pointer' }}
        title="Settings"
      >
        Tasks
      </h1>
      <div className="theme-picker">
        <button
          className="theme-toggle-btn"
          onClick={onThemePickerToggle}
          aria-label="Choose theme"
          title="Choose theme"
        >
          {getThemeIcon(theme, experimentalThemes)}
        </button>
        {showThemePicker && (
          <div className="theme-picker__dropdown" onClick={e => e.stopPropagation()}>
            <div className="theme-picker__pills">
              {THEME_FAMILIES.map((family, idx) => (
                <div key={idx} className="theme-pill">
                  {/* Light variant button */}
                  <button
                    className={`theme-pill__btn theme-pill__btn--light ${theme === family.lightTheme ? 'active' : ''}`}
                    onClick={() => onThemeChange(family.lightTheme)}
                    title={family.lightLabel}
                    aria-label={family.lightLabel}
                  >
                    <div className="theme-pill__icon">{family.lightIcon}</div>
                  </button>

                  {/* Dark variant button */}
                  <button
                    className={`theme-pill__btn theme-pill__btn--dark ${theme === family.darkTheme ? 'active' : ''}`}
                    onClick={() => onThemeChange(family.darkTheme)}
                    title={family.darkLabel}
                    aria-label={family.darkLabel}
                  >
                    <div className="theme-pill__icon">{family.darkIcon}</div>
                  </button>
                </div>
              ))}
            </div>
            {/* Settings button - separate column on the right */}
            <button
              className="theme-picker__settings-icon"
              onClick={() => {
                onSettingsClick()
                onThemePickerToggle() // Close picker after opening settings
              }}
              aria-label="Settings"
              title="Settings"
            >
              <SettingsIcon />
            </button>
          </div>
        )}
      </div>
      {showThemePicker && <div className="theme-picker__overlay" onClick={onThemePickerToggle} />}
    </div>
  )
}
