/**
 * AppHeader — the ecosystem-standard top bar for every hadoku.me app.
 *
 * Enforces the shared contract so child apps stop drifting:
 *   [ title (left) ] ————— <space> ————— [ status? · ThemePicker · Settings gear ] (right)
 *
 * Everything BELOW the header is the app's own concern. The header only owns
 * the title and the right-hand action bar. The settings gear (ConnectedSettings)
 * is injected automatically and self-wires to the hadoku edge-router, so the
 * minimal adoption is:
 *
 * @example
 * ```tsx
 * import { AppHeader, ConnectedThemePicker } from '@wolffm/task-ui-components'
 * import { THEME_FAMILIES, THEME_ICON_MAP } from '@wolffm/themes'
 * import '@wolffm/task-ui-components/app-header.css'
 * import '@wolffm/task-ui-components/theme-picker.css'
 *
 * <AppHeader
 *   title="Print Tool"
 *   status={<ApiStatus status={apiStatus} />}
 *   themePicker={
 *     <ConnectedThemePicker
 *       themeFamilies={THEME_FAMILIES}
 *       currentTheme={theme}
 *       onThemeChange={setTheme}
 *       getThemeIcon={(t) => { const I = THEME_ICON_MAP[t]; return I ? <I /> : null }}
 *     />
 *   }
 * />
 * ```
 */
import React from 'react'
import { ConnectedSettings, type ConnectedSettingsProps } from './ConnectedSettings'

export interface AppHeaderProps {
  /** Left-aligned header title. A string is wrapped in an <h1>; pass a node for
   *  custom markup (e.g. a clickable title button). */
  title: React.ReactNode
  /** The theme control — pass a `<ConnectedThemePicker />`. */
  themePicker?: React.ReactNode
  /** Optional status/extra node shown left of the theme + settings controls
   *  (e.g. an "API Online" indicator). Acceptable per the header contract. */
  status?: React.ReactNode
  /** Show the unified settings gear. Default true. */
  showSettings?: boolean
  /** Forwarded to ConnectedSettings (userType / name / onNameChange). Omit to
   *  let it self-resolve identity via whoami(). */
  settingsProps?: ConnectedSettingsProps
  /** Extra class on the <header> root. */
  className?: string
}

export function AppHeader({
  title,
  themePicker,
  status,
  showSettings = true,
  settingsProps,
  className = ''
}: AppHeaderProps) {
  return (
    <header className={`app-header ${className}`.trim()}>
      {typeof title === 'string' ? (
        <h1 className="app-header__title">{title}</h1>
      ) : (
        <div className="app-header__title">{title}</div>
      )}
      <div className="app-header__actions">
        {status}
        {themePicker}
        {showSettings && <ConnectedSettings {...settingsProps} />}
      </div>
    </header>
  )
}
