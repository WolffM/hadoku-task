/**
 * Unified-preferences adapter for hadoku-task.
 *
 * Backs preferences with the @wolffm/prefs-client SDK (→ hadoku.me/prefs/api/v1/task,
 * D1-persisted) instead of the legacy localStorage + KV `prefs:{sessionId}` path.
 * See ../../hadoku_site/docs/planning/unified-prefs-2026-05-20.md.
 *
 * This is the ONLY client prefs path — the legacy client code (api/client.ts
 * prefs methods, utils/preferences.ts) was deleted in Tranche A. The only
 * legacy remnant is the worker route /task/api/preferences, retained for the
 * migration window so stale users still migrate; readLegacyPrefs() reads it.
 * Deleted in Tranche B.
 *
 * That route now keys off the STABLE user identity (X-User-Id) and recovers
 * blobs stranded under old session ids. It previously keyed off X-Session-Id,
 * which edge-router re-mints on every login — so this migration read usually
 * missed and users silently got defaults. The X-Session-Id header below is now
 * only a recovery hint, not the lookup key.
 *
 * Per-field scope split (locked decision):
 *   device-scoped (differs per device): theme, themeMode, alwaysVerticalLayout,
 *     showNotesButton, showCompleteButton, showDeleteButton, showTagButton
 *   user-scoped (syncs across devices): displayName, experimentalThemes
 *
 * The public surface mirrors the shapes usePreferences/useSessionInitialization
 * already call: loadTaskPreferences() and saveTaskPreferences().
 */
import { z } from 'zod'
import { createPrefsClient, type PrefsClient } from '@wolffm/prefs-client'
import type { UserPreferences } from '../domain/types'
import { logger } from '@wolffm/logger/client'
import { readStoredTheme } from '../utils/theme'

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
  showNotesButton: z.boolean().optional(),
  showCompleteButton: z.boolean().optional(),
  showDeleteButton: z.boolean().optional(),
  showTagButton: z.boolean().optional()
})

export type TaskPrefs = z.infer<typeof TaskPrefsSchema>

const DEVICE_FIELDS = [
  'theme',
  'themeMode',
  'alwaysVerticalLayout',
  'showNotesButton',
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
  // A theme inherited from the hadoku.me host page (sessionStorage
  // 'hadoku-theme', bare family tokens expanded per color scheme) beats the
  // plain system-preference default.
  return readStoredTheme(prefersDark) ?? (prefersDark ? 'dark' : 'light')
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
      showNotesButton: true,
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
    ]
    // NOTE: no bootstrapToSessionStorage here — still required as of
    // @wolffm/prefs-client@1.0.2 (see package.json), which write-throughs the
    // resolved blob to sessionStorage on every read/hydrate/refresh/broadcast.
    // sessionStorage['hadoku-theme'] is a shared contract with the hadoku.me
    // host page (and the inline <head> FOUC script): the host seeds it, and
    // useTheme writes it only on explicit in-app theme changes (see
    // writeStoredTheme in ../utils/theme.ts). A read-path write-through would
    // clobber an inherited theme with the app's own resolved default.
    //
    // A prefs-client fix (mirrors only on explicit save() by default, with a
    // mirrorBootstrapOnRead opt-in for the old behavior) is prepared on
    // hadoku_site's fix/prefs-client-race branch but not yet published. Once
    // this app depends on a version that includes it, bootstrapToSessionStorage
    // + the manual writeStoredTheme path can likely be consolidated — verify
    // against e2e/theme-inheritance.spec.ts before removing either side.
  })
  return cachedClient
}

/**
 * Default preferences for the hook's initial React state (before the SDK
 * resolves). Single source of truth now that utils/preferences.ts is gone.
 */
export const DEFAULT_TASK_PREFERENCES: UserPreferences = {
  version: 1,
  updatedAt: new Date().toISOString(),
  experimentalThemes: false,
  alwaysVerticalLayout: false,
  themeMode: 'simple',
  theme: getDefaultTheme(),
  showNotesButton: true,
  showCompleteButton: true,
  showDeleteButton: true,
  showTagButton: false
}

/** SDK merged blob → UserPreferences (synthesize version + updatedAt for UI compat). */
function toUserPreferences(blob: TaskPrefs): UserPreferences {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...blob
  } as UserPreferences
}

/**
 * Read the legacy preferences for one-shot migration, self-contained (no
 * dependency on the deleted createApi/localStorageApi prefs methods):
 *   1. localStorage `{userType}-{sessionId}-preferences` — authoritative for
 *      any user who used the app before cutover (the old client mirrored
 *      server→localStorage on every load).
 *   2. Auth users on a fresh browser (no localStorage): fetch the legacy
 *      worker route `/task/api/preferences` (KV `prefs:{sessionId}`), which
 *      is retained for the 30-day migration window (deleted in Tranche B).
 * Returns null when there's nothing to migrate.
 */
async function readLegacyPrefs(
  userType: string,
  sessionId: string
): Promise<UserPreferences | null> {
  if (typeof window !== 'undefined') {
    const raw = window.localStorage.getItem(`${userType}-${sessionId}-preferences`)
    if (raw) {
      try {
        return JSON.parse(raw) as UserPreferences
      } catch {
        // Corrupt legacy blob — fall through to server (auth) or null.
      }
    }
  }
  if (userType !== 'public') {
    try {
      const resp = await fetch('/task/api/preferences', {
        headers: {
          'Content-Type': 'application/json',
          'X-User-Type': userType,
          'X-Session-Id': sessionId
        }
      })
      if (resp.ok) return (await resp.json()) as UserPreferences
    } catch {
      // Network/route failure — non-fatal; migration retries next load.
    }
  }
  return null
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
 * via readLegacyPrefs (localStorage for public; localStorage-or-worker-route
 * for auth), splits + saves into the new store, then removes the stale legacy
 * localStorage key. Idempotent and flagged so it runs at most once per
 * legacy storage key.
 */
async function migrateOnce(userType: string, sessionId: string): Promise<void> {
  if (typeof window === 'undefined') return
  const legacyKey = `${userType}-${sessionId}-preferences`
  const flagKey = `task-prefs-migrated:${legacyKey}`
  if (window.localStorage.getItem(flagKey)) return

  try {
    const legacy = await readLegacyPrefs(userType, sessionId)
    if (legacy) {
      // Map legacy simpleMode → themeMode here: saveSplit only forwards
      // known scope fields, so the SDK-level migration never sees simpleMode.
      const { simpleMode, ...rest } = legacy as UserPreferences & { simpleMode?: boolean }
      if (simpleMode !== undefined && rest.themeMode === undefined) {
        rest.themeMode = simpleMode ? 'simple' : 'advanced'
      }
      await saveSplit(rest)
      logger.info('[taskPrefs] Migrated legacy prefs into unified store', {
        userType,
        fields: Object.keys(rest)
      })
    }
  } catch (err) {
    // Migration failure is non-fatal: the SDK falls back to defaults/cache.
    // Leave the flag UNSET so a later load retries.
    logger.warn('[taskPrefs] Legacy migration failed; will retry next load', {
      error: err instanceof Error ? err.message : String(err)
    })
    return
  }

  // Mark migrated, then drop the stale legacy localStorage blob (Tranche A
  // runtime cleanup) — the SDK cache is now authoritative on this device.
  window.localStorage.setItem(flagKey, new Date().toISOString())
  window.localStorage.removeItem(legacyKey)
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
