/**
 * AppHeader — the ecosystem-standard top bar for every hadoku.me app.
 *
 * Enforces the shared contract so child apps stop drifting:
 *   [ title (left) ] ————— <space> ————— [ status? · ThemePicker · Settings gear ] (right)
 *
 * Everything BELOW the header is the app's own concern. The header owns the
 * title, and it OWNS both right-hand controls outright — it renders the theme
 * picker and the settings gear itself. Neither is a prop.
 *
 * WHY THEY ARE NOT PROPS ANY MORE
 * -------------------------------
 * `themePicker?: React.ReactNode` was an open hole: a slot that accepts a node
 * accepts ANY node, so "every app uses the same picker" was a convention, and
 * conventions drift. They did — one app passed a raw `<ThemePicker>` with its
 * own `isOpen` state and a debug logger wired into `getThemeIcon`, and eight
 * apps each kept a hand-copied `useTheme` hook to feed it. Those copies had
 * already diverged on real behaviour (only one wrote `localStorage`, so the
 * rest lost the theme on browser restart and flashed a default on next paint).
 *
 * The control is now rendered here, from `useHadokuTheme()`. An app cannot
 * substitute, restyle or omit it. What an app CAN do is inject its own
 * preferences — see `children`.
 *
 * @example
 * ```tsx
 * import { AppHeader } from '@wolffm/task-ui-components'
 * import { HadokuThemeRoot } from '@wolffm/themes'
 *
 * // once, at the app root:
 * <HadokuThemeRoot>
 *   <AppHeader title="Print Tool" status={<ApiStatus status={apiStatus} />}>
 *     <MyAppPreferences />   // optional: appended AFTER the canonical rows
 *   </AppHeader>
 * </HadokuThemeRoot>
 * ```
 */
import React from 'react'
import { ConnectedSettings, type ConnectedSettingsProps } from './ConnectedSettings'
import { ConnectedThemePicker } from './ConnectedThemePicker'
import { useHadokuTheme } from '../lib/themeContext'

export interface AppHeaderProps {
  /** Left-aligned header title. A string is wrapped in an <h1>; pass a node for
   *  custom markup (e.g. a clickable title button). */
  title: React.ReactNode
  /** Optional status/extra node shown left of the theme + settings controls
   *  (e.g. an "API Online" indicator). Acceptable per the header contract. */
  status?: React.ReactNode
  /** Identity hints for the settings popout. Narrow on purpose: `userType` and
   *  `name` exist because an app behind a path-prefixed shim may not be able to
   *  reach `/session/whoami` (conjure), NOT as a styling or layout hook. */
  settingsProps?: ConnectedSettingsProps
  /** THE app-specific extension point. Rendered inside the settings popout as a
   *  final section, under the four canonical rows. Put your app's own
   *  preferences here — checkboxes, selects, whatever it needs; this slot is
   *  deliberately unconstrained. What it cannot do is alter the rows above it. */
  children?: React.ReactNode
  /** Extra class on the <header> root. Layout only — it cannot reach the
   *  controls, which own their own markup. */
  className?: string
}

export function AppHeader({
  title,
  status,
  settingsProps,
  children,
  className = ''
}: AppHeaderProps) {
  // Throws with an actionable message when the app root was never wrapped.
  const t = useHadokuTheme()

  return (
    <header className={`app-header ${className}`.trim()}>
      {typeof title === 'string' ? (
        <h1 className="app-header__title">{title}</h1>
      ) : (
        <div className="app-header__title">{title}</div>
      )}
      <div className="app-header__actions">
        {status}
        <ConnectedThemePicker
          themeFamilies={t.themeFamilies}
          currentTheme={t.theme}
          onThemeChange={t.setTheme}
          getThemeIcon={t.getThemeIcon}
          themeMode={t.themeMode}
          onThemeModeChange={t.setThemeMode}
          hasAdvanced={t.hasAdvanced}
        />
        <ConnectedSettings {...settingsProps}>{children}</ConnectedSettings>
      </div>
    </header>
  )
}
