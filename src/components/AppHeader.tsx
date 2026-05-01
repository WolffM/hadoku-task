/**
 * AppHeader component
 * Displays app title and theme picker dropdown
 */

import React from 'react'
import { ThemePicker } from '@wolffm/task-ui-components'
import { getThemeIcon, type ThemeFamily } from '../app/themeConfig'
import type { ThemeName } from '../app/types'
import type { ThemeMode } from '@wolffm/themes'

export interface AppHeaderProps {
  theme: ThemeName
  experimentalThemes: boolean
  showThemePicker: boolean
  onThemePickerToggle: () => void
  onThemeChange: (theme: ThemeName) => void
  onSettingsClick: () => void
  THEME_FAMILIES: ThemeFamily[]
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  hasAdvanced: boolean
}

export function AppHeader({
  theme,
  experimentalThemes,
  showThemePicker,
  onThemePickerToggle,
  onThemeChange,
  onSettingsClick,
  THEME_FAMILIES,
  themeMode,
  onThemeModeChange,
  hasAdvanced
}: AppHeaderProps) {
  return (
    <div className="task-app__header-container">
      <h1
        className="task-app__header task-app__header--clickable"
        onClick={onSettingsClick}
        title="Settings"
      >
        Tasks
      </h1>
      <ThemePicker
        currentTheme={theme}
        isOpen={showThemePicker}
        themeFamilies={THEME_FAMILIES}
        // ThemePicker uses string for theme names; the consumer keeps a
        // strict ThemeName union, so cast at this single boundary.
        onThemeChange={t => onThemeChange(t as ThemeName)}
        onToggle={onThemePickerToggle}
        onSettingsClick={onSettingsClick}
        getThemeIcon={t => getThemeIcon(t as ThemeName, experimentalThemes)}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
        hasAdvanced={hasAdvanced}
      />
    </div>
  )
}
