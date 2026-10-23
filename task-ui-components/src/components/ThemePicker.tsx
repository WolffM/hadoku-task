/**
 * ThemePicker component
 * A beautiful theme picker with light/dark variants for each theme family
 * Designed to work with any theme system via configuration
 */

import React, { useRef, useLayoutEffect, useState } from 'react'
import { Tooltip } from './Tooltip'
import type { ThemePickerProps } from '../types'
import { SettingsIcon, getFallbackIcon } from './ThemeIcons'
// MoonIcon is a theme-family icon and lives with the theme model now.
import { MoonIcon } from '@wolffm/themes'
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
  dropdownPlacement = 'auto'
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
      <Tooltip content="Choose theme">
        <button
          className="app-header__icon-btn theme-toggle-btn"
          onClick={onToggle}
          aria-label="Choose theme"
        >
          {currentIcon}
        </button>
      </Tooltip>
      {isOpen && (
        <div
          ref={dropdownRef}
          className="theme-picker__dropdown"
          onClick={e => e.stopPropagation()}
        >
          <div className="theme-picker__main">
            <div className="theme-picker__pills">
              {themeFamilies.map((family, idx) => {
                // Use provided icons or fallback to generic shapes
                const lightIcon = family.lightIcon ?? getFallbackIcon(idx)
                const darkIcon = family.darkIcon ?? getFallbackIcon(idx)

                return (
                  <div key={idx} className="theme-pill">
                    {/* Light variant button */}
                    <Tooltip content={family.lightLabel}>
                      <button
                        className={`theme-pill__btn theme-pill__btn--light ${currentTheme === family.lightTheme ? 'active' : ''}`}
                        onClick={() => onThemeChange(family.lightTheme)}
                        aria-label={family.lightLabel}
                      >
                        <div className="theme-pill__icon">{lightIcon}</div>
                      </button>
                    </Tooltip>

                    {/* Dark variant button */}
                    <Tooltip content={family.darkLabel}>
                      <button
                        className={`theme-pill__btn theme-pill__btn--dark ${currentTheme === family.darkTheme ? 'active' : ''}`}
                        onClick={() => onThemeChange(family.darkTheme)}
                        aria-label={family.darkLabel}
                      >
                        <div className="theme-pill__icon">{darkIcon}</div>
                      </button>
                    </Tooltip>
                  </div>
                )
              })}
            </div>
            {/* Settings button - separate column on the right */}
            {onSettingsClick && (
              <Tooltip content="Settings">
                <button
                  className="theme-picker__settings-icon"
                  onClick={() => {
                    onSettingsClick()
                    onToggle() // Close picker after opening settings
                  }}
                  aria-label="Settings"
                >
                  <SettingsIcon />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      )}
      {isOpen && <div className="theme-picker__overlay" onClick={onToggle} />}
    </div>
  )
}
