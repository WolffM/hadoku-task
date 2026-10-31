/**
 * The settings popout's remembered tab, per user and per app.
 *
 * Stored on the shared 'portfolio' row (themePrefs) under `settingsTabs`, keyed
 * by the app's path prefix, so cardtable's "Sound" and the task app's "App"
 * don't overwrite each other. User scope: the tab follows the person, not the
 * device.
 *
 * Read through a subscription taken when this module evaluates, never through
 * `themePrefs.read()`: every read() with a cached blob kicks a background GET,
 * and the theme hook has already issued the boot read. Subscribing first means
 * this sees the cache hydrate and that read's result without asking again.
 */
import { useCallback, useSyncExternalStore } from 'react'
import { themePrefs, type ThemePrefs } from './themePrefs'

let tabs: Record<string, string> = {}
const listeners = new Set<() => void>()

themePrefs.subscribe((next: ThemePrefs) => {
  tabs = next.settingsTabs ?? {}
  for (const l of listeners) l()
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getTabs = () => tabs

/** The app this page belongs to: its first path segment ('' at the site root). */
function appScope(): string {
  if (typeof window === 'undefined') return ''
  return window.location.pathname.split('/')[1] ?? ''
}

/**
 * `[savedTabId, saveTabId]` for the current app. The saved id may name a tab
 * the app no longer offers; the caller falls back to its default then.
 */
export function useSettingsTab(): [string | null, (id: string) => void] {
  const all = useSyncExternalStore(subscribe, getTabs, getTabs)
  const scope = appScope()
  const save = useCallback(
    (id: string) => {
      themePrefs
        .save({ settingsTabs: { ...tabs, [scope]: id } }, { scope: 'user' })
        .catch((err: unknown) => {
          console.error('[useSettingsTab] prefs save failed', (err as Error)?.message ?? err)
        })
    },
    [scope]
  )
  return [all[scope] ?? null, save]
}
