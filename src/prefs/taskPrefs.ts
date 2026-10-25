/**
 * Unified-preferences adapter for hadoku-task.
 *
 * Backs preferences with the @wolffm/prefs-client SDK (→ hadoku.me/prefs/api/v1/task,
 * D1-persisted) instead of the legacy localStorage + KV `prefs:{sessionId}` path.
 * See ../../hadoku_site/docs/planning/unified-prefs-2026-05-20.md.
 *
 * This is the ONLY prefs path. The legacy localStorage blobs and the worker's
 * /task/api/preferences route (KV `prefs:{id}`) are gone, along with the
 * one-shot migration that read them.
 *
 * Per-field scope split (locked decision):
 *   device-scoped (differs per device): theme, themeMode, alwaysVerticalLayout,
 *     showNotesButton, showCompleteButton, showDeleteButton, showTagButton
 *   user-scoped (syncs across devices): displayName
 *
 * The public surface is loadTaskPreferences() and saveTaskPreferences().
 */
import { z } from 'zod'
import { createPrefsClient, type PrefsClient } from '@wolffm/prefs-client'
import type { UserPreferences } from '../domain/types'
import { readStoredTheme } from '../utils/theme'
import { resolvePrefsApiBase } from '@wolffm/themes'

// Zod schema mirroring the FLAT UserPreferences shape (src/domain/types.ts).
// version + updatedAt are NOT persisted as prefs fields — the SDK manages
// per-row versioning + timestamps server-side; we synthesize them in
// toUserPreferences() purely for type-compat with the existing UI.
export const TaskPrefsSchema = z.object({
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

const USER_FIELDS = ['displayName'] as const

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
    // Undefined in production. A dev/E2E stack sets the global so BOTH rows —
    // this one and the shared 'portfolio' row useTheme reads — resolve to the
    // local prefs-api. Overriding only one would leave the other reaching
    // hadoku.me, which is exactly the split that hid the migration bug.
    apiBase: resolvePrefsApiBase(),
    defaults: {
      theme: getDefaultTheme(),
      themeMode: 'simple',
      alwaysVerticalLayout: false,
      showNotesButton: true,
      showCompleteButton: true,
      showDeleteButton: true,
      showTagButton: false
    }
    // NOTE: no bootstrapToSessionStorage here — still required as of
    // @wolffm/prefs-client@1.0.2 (see package.json), which write-throughs the
    // resolved blob to sessionStorage on every read/hydrate/refresh/broadcast.
    // sessionStorage['hadoku-theme'] is a shared contract with the hadoku.me
    // host page (and the inline <head> FOUC script): the host seeds it, and
    // it is written only on explicit in-app theme changes (saveTheme in
    // @wolffm/themes). A read-path write-through would clobber an inherited
    // theme with the app's own resolved default.
    //
    // A prefs-client fix (mirrors only on explicit save() by default, with a
    // mirrorBootstrapOnRead opt-in for the old behavior) is prepared on
    // hadoku_site's fix/prefs-client-race branch but not yet published. Once
    // this app depends on a version that includes it, bootstrapToSessionStorage
    // can likely take over the mirroring — verify against
    // e2e/theme-inheritance.spec.ts before removing either side.
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
 * Load the user's preferences from the unified store: the SDK's merged
 * (user + device) view mapped to the UserPreferences shape.
 *
 * Read-only. It used to run a one-shot migration from the legacy worker route
 * first, flagged per sessionId — so every new session re-ran it, the route
 * answered 200 with defaults, and those defaults overwrote the user's real
 * prefs (theme included). Loading must never write.
 */
export async function loadTaskPreferences(): Promise<UserPreferences> {
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
