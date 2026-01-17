/**
 * Preferences utilities
 * Functions for managing user preferences, migrations, and storage cleanup
 */

import type { UserPreferences } from '../domain/types'
import { STORAGE_VERSION, STORAGE_VERSION_KEY, ORPHANED_KEY_PATTERNS } from '../app/constants'
import { formatError } from '../domain/utils/tags'
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
  simpleMode: false,
  theme: getDefaultTheme(),
  showCompleteButton: true,
  showDeleteButton: true,
  showTagButton: false
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

/**
 * One-time migration: Move settings from sessionStorage to localStorage
 * @deprecated This migration should be removed after all users have migrated (circa 2026)
 * @returns Partial preferences object if migration occurred, null otherwise
 */
export function migrateFromSessionStorage(
  currentPreferences: UserPreferences
): Partial<UserPreferences> | null {
  try {
    const sessionTheme = sessionStorage.getItem('theme')
    const sessionComplete = sessionStorage.getItem('showCompleteButton')
    const sessionDelete = sessionStorage.getItem('showDeleteButton')
    const sessionTag = sessionStorage.getItem('showTagButton')

    const migrations: Partial<UserPreferences> = {}

    // Only migrate if localStorage doesn't have the value
    if (sessionTheme && !currentPreferences.theme) {
      migrations.theme = sessionTheme
    }
    if (sessionComplete !== null && currentPreferences.showCompleteButton === undefined) {
      migrations.showCompleteButton = sessionComplete === 'true'
    }
    if (sessionDelete !== null && currentPreferences.showDeleteButton === undefined) {
      migrations.showDeleteButton = sessionDelete === 'true'
    }
    if (sessionTag !== null && currentPreferences.showTagButton === undefined) {
      migrations.showTagButton = sessionTag === 'true'
    }

    if (Object.keys(migrations).length > 0) {
      logger.info('[Preferences] Migrating settings from sessionStorage to localStorage', {
        migrations
      })

      // Clean up old sessionStorage values
      sessionStorage.removeItem('theme')
      sessionStorage.removeItem('showCompleteButton')
      sessionStorage.removeItem('showDeleteButton')
      sessionStorage.removeItem('showTagButton')

      return migrations
    }

    return null
  } catch (error) {
    logger.warn('[Preferences] Failed to migrate settings', {
      error: formatError(error)
    })
    return null
  }
}
