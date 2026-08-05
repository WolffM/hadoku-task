/**
 * One-shot migration of this app's theme preferences into the platform's.
 *
 * WHY
 * ---
 * Until @wolffm/task-ui-components 3.0.0, this app persisted `theme`,
 * `themeMode` and `experimentalThemes` in its OWN prefs row (appId `task`,
 * via taskPrefs) — its private useTheme hook took `savePreferences` and wrote
 * them there. Every other app in the ecosystem wrote the same three fields to
 * the shared platform row (appId `portfolio`, via @wolffm/themes' themePrefs).
 *
 * The header lockdown moved this app onto the shared hook, which reads the
 * shared row. Without this migration that is a silent data loss: a user who
 * had picked `coffee-dark` and Advanced mode in the task app would open it
 * and find neither, because their values are sitting in a row nothing reads
 * any more.
 *
 * WHAT IT MIGRATES, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------
 * Only values that DIFFER from this app's own defaults.
 *
 * The prefs SDK's read() returns the schema-validated, DEFAULTS-APPLIED blob —
 * there is no raw accessor — so `themeMode: 'simple'` is indistinguishable
 * from "never chose a mode", and `theme` always comes back as at least
 * getDefaultTheme(). A value equal to the default therefore carries no
 * information: the shared row would resolve to the same outcome from its own
 * defaulting, and copying it across would convert "unset" into "explicitly
 * set" for every app the user touches. So a default-valued field is left
 * alone.
 *
 * The shared row also always WINS. A value already there is either a genuine
 * cross-app choice or a completed migration; either way this app's older copy
 * must not overwrite it.
 *
 * SCOPES match both schemas: theme and themeMode are per-device, and
 * experimentalThemes is per-user (it follows the person across devices).
 *
 * Idempotent by construction — once a field exists in the shared row the
 * `=== undefined` guard fails forever. The ref only prevents a duplicate write
 * inside the one render pass between saving and the subscription firing.
 */
import { useEffect, useRef } from 'react'
import { usePrefs } from '@wolffm/prefs-client/react'
import { themePrefs } from '@wolffm/themes'
import { logger } from '@wolffm/logger/client'
import { DEFAULT_TASK_PREFERENCES } from '../prefs/taskPrefs'
import { planThemePrefsMigration, isEmptyPlan } from '../prefs/themePrefsMigration'
import type { UserPreferences } from '../domain/types'

export function useThemePrefsMigration(
  preferences: UserPreferences,
  preferencesLoaded: boolean
): void {
  const { prefs: shared, save: saveShared, loading } = usePrefs(themePrefs)
  const migrated = useRef(false)

  useEffect(() => {
    if (migrated.current) return
    // Both rows must have actually RESOLVED. `shared === null` is the
    // pre-resolve state, not an empty row — acting on it would read every
    // field as absent and migrate this app's defaults over the top of
    // whatever the server holds.
    if (!preferencesLoaded || loading || shared === null) return
    migrated.current = true

    // The rules live in planThemePrefsMigration and are pinned by
    // src/test/theme-prefs-migration-verify.ts — they are subtle enough
    // (shared-wins, default-means-unset, split scopes) to be worth asserting
    // rather than re-deriving here.
    const { device, user } = planThemePrefsMigration(shared, preferences, DEFAULT_TASK_PREFERENCES)
    if (isEmptyPlan({ device, user })) return

    const writes: Promise<void>[] = []
    if (Object.keys(device).length > 0) {
      writes.push(saveShared(device, { scope: 'device' }))
    }
    if (Object.keys(user).length > 0) {
      writes.push(saveShared(user, { scope: 'user' }))
    }
    if (writes.length === 0) return

    logger.info('[themePrefsMigration] carrying task theme prefs to the shared row', {
      device: Object.keys(device),
      user: Object.keys(user)
    })

    Promise.all(writes).catch((err: unknown) => {
      // Not swallowed: a failure here means the user's theme silently reverts
      // to the platform default, which reads as "the app forgot my settings".
      // The ref stays set for this session, but the migration retries on the
      // next mount because the shared row is still missing the fields.
      migrated.current = false
      logger.error('[themePrefsMigration] failed to carry theme prefs across', {
        error: (err as Error)?.message ?? String(err)
      })
    })
  }, [preferences, preferencesLoaded, shared, loading, saveShared])
}
