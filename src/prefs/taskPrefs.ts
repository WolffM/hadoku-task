/**
 * Unified-preferences adapter for hadoku-task.
 *
 * Backs preferences with the @wolffm/prefs-client SDK (→ hadoku.me/prefs/api/v1/task,
 * D1-persisted) instead of the legacy localStorage + KV `prefs:{sessionId}` path.
 * See ../../hadoku_site/docs/planning/unified-prefs-2026-05-20.md.
 *
 * STAGING (PR1): this adapter is the active prefs path, but the legacy code
 * (api/client.ts prefs methods, utils/preferences.ts, worker prefs routes) is
 * deliberately LEFT IN PLACE so PR1 is revertible and the migration can read
 * the old prefs to seed the new store. PR2 deletes the legacy paths once
 * multi-device parity is verified in prod.
 *
 * Per-field scope split (locked decision):
 *   device-scoped (differs per device): theme, themeMode, alwaysVerticalLayout,
 *     showCompleteButton, showDeleteButton, showTagButton
 *   user-scoped (syncs across devices): displayName, experimentalThemes
 *
 * The public surface mirrors the shapes usePreferences/useSessionInitialization
 * already call: loadTaskPreferences() and saveTaskPreferences().
 */
import { z } from 'zod'
import { createPrefsClient, type PrefsClient } from '@wolffm/prefs-client'
import { createApi } from '../api/client'
import type { UserPreferences } from '../domain/types'
import { logger } from '@wolffm/task-ui-components'

// Zod schema mirroring the FLAT UserPreferences shape (src/domain/types.ts).
// version + updatedAt are NOT persisted as prefs fields — the SDK manages
// per-row versioning + timestamps server-side; we synthesize them in
// toUserPreferences() purely for type-compat with the existing UI.
export const TaskPrefsSchema = z.object({
  experimentalThemes: z.boolean().optional(),
  alwaysVerticalLayout: z.boolean().optional(),
  displayName: z.string().optional(),
  themeMode: z.enum(['simple', 'advanced']).optional(),
  theme: z.string().optional(),
  showCompleteButton: z.boolean().optional(),
  showDeleteButton: z.boolean().optional(),
  showTagButton: z.boolean().optional()
})

export type TaskPrefs = z.infer<typeof TaskPrefsSchema>

const DEVICE_FIELDS = [
  'theme',
  'themeMode',
  'alwaysVerticalLayout',
  'showCompleteButton',
  'showDeleteButton',
  'showTagButton'
] as const

const USER_FIELDS = ['displayName', 'experimentalThemes'] as const

function getDefaultTheme(): string {
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

let cachedClient: PrefsClient<TaskPrefs> | null = null

function getClient(): PrefsClient<TaskPrefs> {
  if (cachedClient) return cachedClient
  cachedClient = createPrefsClient({
    appId: 'task',
    schema: TaskPrefsSchema,
    defaults: {
      theme: getDefaultTheme(),
      themeMode: 'simple',
      alwaysVerticalLayout: false,
      showCompleteButton: true,
      showDeleteButton: true,
      showTagButton: false,
      experimentalThemes: false
    },
    migrations: [
      // Legacy simpleMode → themeMode (mirrors utils/preferences.migrateLegacyKeys).
      // Idempotent: only acts if a stale simpleMode field is present.
      blob => {
        const legacy = blob as { simpleMode?: boolean }
        if (legacy.simpleMode !== undefined) {
          if (blob.themeMode === undefined) {
            blob.themeMode = legacy.simpleMode ? 'simple' : 'advanced'
          }
          delete (blob as Record<string, unknown>).simpleMode
        }
        return blob
      }
    ],
    // Keep the inline <head> FOUC script working: it reads
    // sessionStorage['hadoku-theme'] and applies it as data-theme before
    // React mounts. The SDK write-throughs the resolved theme on every read.
    bootstrapToSessionStorage: { theme: 'hadoku-theme' }
  })
  return cachedClient
}

/** SDK merged blob → UserPreferences (synthesize version + updatedAt for UI compat). */
function toUserPreferences(blob: TaskPrefs): UserPreferences {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...blob
  } as UserPreferences
}

/** Split a prefs patch by scope and save each scope through the SDK. */
async function saveSplit(patch: Partial<UserPreferences>): Promise<void> {
  const client = getClient()
  const devicePatch: Partial<TaskPrefs> = {}
  const userPatch: Partial<TaskPrefs> = {}

  for (const f of DEVICE_FIELDS) {
    if (patch[f] !== undefined) (devicePatch as Record<string, unknown>)[f] = patch[f]
  }
  for (const f of USER_FIELDS) {
    if (patch[f] !== undefined) (userPatch as Record<string, unknown>)[f] = patch[f]
  }

  if (Object.keys(devicePatch).length > 0) {
    await client.save(devicePatch, { scope: 'device' })
  }
  if (Object.keys(userPatch).length > 0) {
    await client.save(userPatch, { scope: 'user' })
  }
}

/**
 * One-shot migration: seed prefs-api from the legacy path the first time we
 * load for a given (userType, sessionId). Reads the authoritative legacy prefs
 * via the OLD createApi (localStorage for public; server-or-localStorage for
 * auth), then splits + saves into the new store. Idempotent and flagged in
 * localStorage so it runs at most once per legacy storage key.
 */
async function migrateOnce(userType: string, sessionId: string): Promise<void> {
  if (typeof window === 'undefined') return
  const flagKey = `task-prefs-migrated:${userType}-${sessionId}-preferences`
  if (window.localStorage.getItem(flagKey)) return

  try {
    const legacyApi = createApi(userType as 'public' | 'friend' | 'admin', sessionId)
    const legacy = await legacyApi.getPreferences()
    if (legacy) {
      await saveSplit(legacy)
      logger.info('[taskPrefs] Migrated legacy prefs into unified store', {
        userType,
        fields: Object.keys(legacy)
      })
    }
  } catch (err) {
    // Migration failure is non-fatal: the SDK falls back to defaults/cache and
    // the legacy path is still present. Log and let the flag stay UNSET so a
    // later load retries.
    logger.warn('[taskPrefs] Legacy migration failed; will retry next load', {
      error: err instanceof Error ? err.message : String(err)
    })
    return
  }

  window.localStorage.setItem(flagKey, new Date().toISOString())
}

/**
 * Load the user's preferences from the unified store. Runs the one-shot legacy
 * migration first, then returns the SDK's merged (user + device) view mapped to
 * the UserPreferences shape. Drop-in for the legacy createApi().getPreferences().
 */
export async function loadTaskPreferences(
  userType: string,
  sessionId: string
): Promise<UserPreferences> {
  await migrateOnce(userType, sessionId)
  const merged = await getClient().read()
  return toUserPreferences(merged)
}

/**
 * Save a preferences patch. Splits by scope (device vs user) and writes through
 * the SDK (debounced PUT, optimistic localStorage cache). Drop-in for the legacy
 * createApi().savePreferences().
 */
export async function saveTaskPreferences(patch: Partial<UserPreferences>): Promise<void> {
  await saveSplit(patch)
}
