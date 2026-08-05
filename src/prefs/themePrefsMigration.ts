/**
 * The decision half of the task -> platform theme-prefs migration.
 *
 * Kept as a pure function, separate from the hook that calls it, because the
 * rules are the part worth testing and they are not obvious:
 *
 *   - the SHARED row always wins. A value already there is either a genuine
 *     cross-app choice or an earlier completed migration; this app's older
 *     copy must never overwrite it.
 *   - a value equal to THIS APP's default is skipped. The prefs SDK's read()
 *     returns the defaults-applied blob and offers no raw accessor, so
 *     `themeMode: 'simple'` cannot be told apart from "never chose a mode".
 *     Copying it would convert "unset" into "explicitly set" across every app
 *     the user touches, while changing nothing about what they see.
 *   - scopes differ per field and must match both schemas: theme and themeMode
 *     are per-DEVICE, experimentalThemes is per-USER (it follows the person).
 *
 * See useThemePrefsMigration for why this migration exists at all.
 */
import type { ThemePrefs } from '@wolffm/themes'
import type { UserPreferences } from '../domain/types'

/** The subset of this app's preferences that used to live here and now lives
 *  in the platform row. Deliberately structural, so the harness can build one
 *  without dragging in the whole UserPreferences shape. */
export interface TaskThemeSource {
  theme?: string
  themeMode?: 'simple' | 'advanced'
  experimentalThemes?: boolean
}

export interface MigrationPlan {
  /** Per-device fields to write. Empty object means nothing to do. */
  device: Partial<ThemePrefs>
  /** Per-user fields to write. */
  user: Partial<ThemePrefs>
}

export function isEmptyPlan(plan: MigrationPlan): boolean {
  return Object.keys(plan.device).length === 0 && Object.keys(plan.user).length === 0
}

/**
 * @param shared    the RESOLVED platform row. Never pass the pre-resolve
 *                  `null` — every field would read as absent and this app's
 *                  values would be written over whatever the server holds.
 * @param source    this app's resolved (defaults-applied) preferences.
 * @param defaults  this app's defaults, for the "carries no information" test.
 */
export function planThemePrefsMigration(
  shared: ThemePrefs,
  source: TaskThemeSource,
  defaults: Pick<UserPreferences, 'theme' | 'themeMode' | 'experimentalThemes'>
): MigrationPlan {
  const device: Partial<ThemePrefs> = {}
  const user: Partial<ThemePrefs> = {}

  if (shared.theme === undefined && source.theme && source.theme !== defaults.theme) {
    device.theme = source.theme
  }

  if (
    shared.themeMode === undefined &&
    source.themeMode &&
    source.themeMode !== defaults.themeMode
  ) {
    device.themeMode = source.themeMode
  }

  if (
    shared.experimentalThemes === undefined &&
    source.experimentalThemes !== undefined &&
    source.experimentalThemes !== defaults.experimentalThemes
  ) {
    user.experimentalThemes = source.experimentalThemes
  }

  return { device, user }
}
