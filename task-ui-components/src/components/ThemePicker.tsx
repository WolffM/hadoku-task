/**
 * ThemePicker component
 * A beautiful theme picker with light/dark variants for each theme family
 * Designed to work with any theme system via configuration
 */

import React, { useRef, useLayoutEffect, useState } from 'react'
import type { ThemePickerProps } from '../types'
import { SettingsIcon, MoonIcon, getFallbackIcon } from './ThemeIcons'
import '../theme-picker.css'

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
  className = '',
  dropdownPlacement = 'auto',
  themeMode,
  onThemeModeChange,
  hasAdvanced
}: ThemePickerProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [resolvedPlacement, setResolvedPlacement] = useState<'left' | 'right'>('right')

  // Edge detection: when 'auto', measure the dropdown after render and flip if it overflows
  useLayoutEffect(() => {
    if (!isOpen) return

    if (dropdownPlacement !== 'auto') {
      setResolvedPlacement(dropdownPlacement)
      return
    }

    // Start with right (default), then check if it overflows
    setResolvedPlacement('right')

    // Use rAF to measure after the browser has laid out the dropdown
    const frameId = requestAnimationFrame(() => {
      const el = dropdownRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.right > window.innerWidth) {
        setResolvedPlacement('left')
      }
    })

    return () => cancelAnimationFrame(frameId)
  }, [isOpen, dropdownPlacement])

  // Get icon for current theme (use provided function or fallback to MoonIcon)
  const currentIcon = getThemeIcon ? getThemeIcon(currentTheme) : <MoonIcon />

  const openLeftClass = resolvedPlacement === 'left' ? 'theme-picker--open-left' : ''

  return (
    <div className={`theme-picker ${openLeftClass} ${className}`.trim()}>
      <button
        className="theme-toggle-btn"
        onClick={onToggle}
        aria-label="Choose theme"
        title="Choose theme"
      >
        {currentIcon}
      </button>
      {isOpen && (
        <div
          ref={dropdownRef}
          className="theme-picker__dropdown"
          onClick={e => e.stopPropagation()}
        >
          {hasAdvanced && themeMode && onThemeModeChange && (
            <div className="theme-picker__mode-toggle" role="group" aria-label="Theme mode">
              <button
                type="button"
                className={`theme-picker__mode-btn ${themeMode === 'simple' ? 'active' : ''}`}
                onClick={() => onThemeModeChange('simple')}
                aria-pressed={themeMode === 'simple'}
              >
                Simple
              </button>
              <button
                type="button"
                className={`theme-picker__mode-btn ${themeMode === 'advanced' ? 'active' : ''}`}
                onClick={() => onThemeModeChange('advanced')}
                aria-pressed={themeMode === 'advanced'}
              >
                Advanced
              </button>
            </div>
          )}
          <div className="theme-picker__main">
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
        </div>
      )}
      {isOpen && <div className="theme-picker__overlay" onClick={onToggle} />}
    </div>
  )
}
