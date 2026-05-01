/**
 * Preferences utilities
 * Functions for managing user preferences, migrations, and storage cleanup
 */

import type { UserPreferences } from '../domain/types'
import { STORAGE_VERSION, STORAGE_VERSION_KEY, ORPHANED_KEY_PATTERNS } from '../app/constants'
import { logger } from '@wolffm/task-ui-components'

/**
 * Get default user preferences
 * Respects browser's color scheme preference for theme
 */
function getDefaultTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

/**
 * Default user preferences
 * Used when no preferences exist or for fallback values
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  version: 1,
  updatedAt: new Date().toISOString(),
  experimentalThemes: false,
  alwaysVerticalLayout: false,
  themeMode: 'advanced',
  theme: getDefaultTheme(),
  showCompleteButton: true,
  showDeleteButton: true,
  showTagButton: false
}

/**
 * Migrate legacy preference keys to their current shape.
 *
 * - `simpleMode: boolean` → `themeMode: 'simple' | 'advanced'`
 *
 * Returns a cleaned preferences object (with the legacy key removed)
 * when a migration occurred, or null when the input is already current.
 *
 * Callers that persist the result MUST overwrite the stored value
 * directly (e.g. `localStorage.setItem(key, JSON.stringify(migrated))`)
 * — a shallow-merge save would leave the stale legacy key in storage.
 */
export function migrateLegacyKeys(prefs: UserPreferences): UserPreferences | null {
  // Cast through unknown so we can read keys that have been removed from the type.
  const legacy = prefs as unknown as { simpleMode?: boolean }
  if (legacy.simpleMode === undefined) return null

  const result: UserPreferences & { simpleMode?: boolean } = { ...prefs }
  if (result.themeMode === undefined) {
    result.themeMode = legacy.simpleMode ? 'simple' : 'advanced'
  }
  delete result.simpleMode

  logger.info('[Preferences] Migrated legacy simpleMode → themeMode', {
    themeMode: result.themeMode
  })
  return result
}

/**
 * Clean up orphaned localStorage keys from intermediate schema versions
 * Removes keys that don't match the current userType-sessionId prefix pattern
 */
export function cleanupOrphanedKeys(userType: string, sessionId: string): void {
  const currentVersion = window.localStorage.getItem(STORAGE_VERSION_KEY)

  if (currentVersion !== STORAGE_VERSION) {
    logger.info('[Preferences] Storage version mismatch, cleaning up orphaned keys', {
      current: currentVersion,
      expected: STORAGE_VERSION
    })

    Object.keys(window.localStorage).forEach(key => {
      // Only remove if it matches orphaned pattern AND doesn't match current schema
      const isOrphaned = ORPHANED_KEY_PATTERNS.some(pattern => pattern.test(key))
      const isCurrentSchema = key.includes(`${userType}-${sessionId}`)

      if (isOrphaned && !isCurrentSchema) {
        logger.info('[Preferences] Removing orphaned key', { key })
        window.localStorage.removeItem(key)
      }
    })

    // Mark storage as upgraded
    window.localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION)
    logger.info('[Preferences] Storage upgraded to version', { version: STORAGE_VERSION })
  }
}
