/**
 * useTheme — the one theme hook for the hadoku ecosystem.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Eight child apps each carried a hand-copied `src/hooks/useTheme.ts`, because
 * the version this package used to ship was strictly weaker than what an app
 * actually needs: no cross-device persistence, no container mirroring for
 * micro-frontend mounts, no FOUC gating, no system-preference auto-switch, no
 * validation that the theme is even available. So everyone wrote their own, and
 * the copies drifted on real behaviour — `hadoku-pygmalion` wrote localStorage
 * (so a browser restart kept the theme and repainted correctly), while
 * `hadoku-jobplatform` wrote only sessionStorage and lost it. Same file, same
 * comments, one had the fix.
 *
 * This is the union of those copies, with the localStorage behaviour taken as
 * canonical (see `saveTheme` in ./index).
 *
 * PERSISTENCE, THREE LAYERS
 * -------------------------
 *   sessionStorage — what the pre-paint inline <head> script reads; per tab.
 *   localStorage   — what survives a browser restart, so the NEXT cold load
 *                    paints the right theme directly with no default-then-swap.
 *   prefs (device) — cross-device, via @wolffm/prefs-client; resolves async.
 *
 * The async layer is why `userOverrodeRef` exists: a late prefs resolve must
 * not yank the user back to the previously persisted theme if they've already
 * picked a new one this session.
 */
import { useState, useEffect, useRef, useMemo, useCallback, type RefObject } from 'react'
import { usePrefs } from '@wolffm/prefs-client/react'
import {
  setTheme as applyTheme,
  saveTheme,
  getThemeMode,
  saveThemeMode,
  loadThemeMode
} from './index'
import type { Theme, ThemeMode } from './index'
import { hasAdvanced as themeHasAdvanced } from './effects'
import { THEME_FAMILIES, EXPERIMENTAL_THEMES } from './metadata'
import { themePrefs } from './themePrefs'

export interface UseThemeOptions {
  /** Theme forced by a parent shell. When set, it wins over everything and the
   *  cross-device adopt is skipped (the shell already plumbed the SDK read). */
  propsTheme?: string
  /** Mirror `data-theme` onto a container element as well as <html>, for
   *  micro-frontend mounts that are styled within their own subtree. */
  containerRef?: RefObject<HTMLElement | null>
}

/** Seed the theme before any async source resolves. Order matters: whatever the
 *  pre-paint script already put on <html> beats storage, because that is what
 *  the user is currently LOOKING at — re-deriving it from storage risks a swap
 *  in the first frame for no reason. */
function seedTheme(propsTheme?: string): string {
  if (propsTheme) return propsTheme
  if (typeof document === 'undefined') return 'light'

  const painted = document.documentElement.getAttribute('data-theme')
  if (painted) return painted

  try {
    const stored = sessionStorage.getItem('hadoku-theme') ?? localStorage.getItem('hadoku-theme')
    if (stored) return stored
  } catch {
    /* storage blocked — fall through to the browser preference */
  }

  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export function useTheme(options: UseThemeOptions = {}) {
  const { propsTheme, containerRef } = options

  const [theme, setThemeState] = useState<string>(() => seedTheme(propsTheme))
  const [themeMode, setThemeModeState] = useState<ThemeMode>('simple')
  const [isThemeReady, setIsThemeReady] = useState(false)
  const [isInitialThemeLoad, setIsInitialThemeLoad] = useState(true)

  // Cross-device row. `save` comes from the hook (not the module) so the SDK
  // can update its in-memory cache — using the module-level save let a stale
  // snapshot race back into state.
  const { prefs: persisted, save: savePrefs } = usePrefs(themePrefs)

  // savePrefs' identity is not stable across renders, and `setTheme` is a
  // dependency of the media-query effect below. Reading it through a ref keeps
  // setTheme referentially stable forever, so that effect re-subscribes only
  // when the theme actually changes rather than on every render. Declared up
  // here because every setter below closes over it.
  const savePrefsRef = useRef(savePrefs)
  useEffect(() => {
    savePrefsRef.current = savePrefs
  })

  // True once the user has picked a theme this session, so a late prefs
  // resolve doesn't overwrite their choice.
  const userOverrodeRef = useRef(false)

  // Experimental families are opt-in, per person, across every app. Gating
  // them here (rather than in one app's themeConfig) is what makes the picker
  // the same control everywhere: same list, same order, same rule.
  const experimentalEnabled = persisted?.experimentalThemes ?? false
  const themeFamilies = useMemo(
    () =>
      experimentalEnabled
        ? THEME_FAMILIES
        : THEME_FAMILIES.filter(
            f => !EXPERIMENTAL_THEMES.has(f.lightTheme) && !EXPERIMENTAL_THEMES.has(f.darkTheme)
          ),
    [experimentalEnabled]
  )

  const setExperimentalThemes = useCallback((enabled: boolean) => {
    savePrefsRef
      .current({ experimentalThemes: enabled }, { scope: 'user' })
      .catch((err: unknown) => {
        console.error('[useTheme] prefs save failed', {
          error: (err as Error)?.message ?? String(err),
          experimentalThemes: enabled
        })
      })
  }, [])

  // Validity is checked against ALL families, never the filtered picker list.
  //
  // Those are different questions: `themeFamilies` controls what the picker
  // OFFERS, while this controls whether an already-active theme is real. Tying
  // validity to the filtered list would force anyone sitting on an experimental
  // theme back to 'light' — and it would do it on EVERY load, because
  // `persisted` resolves async, so `experimentalThemes` reads false for the
  // first frames of every single boot regardless of what the user chose.
  const isThemeAvailable = useCallback(
    (name: string) => THEME_FAMILIES.some(f => f.lightTheme === name || f.darkTheme === name),
    []
  )

  const setTheme = useCallback((next: string) => {
    setThemeState(next)
    userOverrodeRef.current = true
    // Synchronous local write first: it is what preserves no-FOUC and same-tab
    // behaviour regardless of whether the network write lands.
    saveTheme(next as Theme)
    savePrefsRef.current({ theme: next }, { scope: 'device' }).catch((err: unknown) => {
      // Logged, never swallowed — silent save failures were the original
      // "my theme keeps resetting" bug. This package stays free of the logger
      // dependency, so console is the sink.
      console.error('[useTheme] prefs save failed', {
        error: (err as Error)?.message ?? String(err),
        theme: next
      })
    })
  }, [])

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode)
    saveThemeMode(mode)
    savePrefsRef.current({ themeMode: mode }, { scope: 'device' }).catch((err: unknown) => {
      console.error('[useTheme] prefs save failed', {
        error: (err as Error)?.message ?? String(err),
        themeMode: mode
      })
    })
  }, [])

  // Seed theme mode from storage once mounted (it is not part of the pre-paint
  // script, so there is nothing on <html> to read).
  useEffect(() => {
    setThemeModeState(loadThemeMode())

    // Another tab changing the theme should be reflected here.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'hadoku-theme' && e.newValue && !userOverrodeRef.current) {
        setThemeState(e.newValue)
      } else if (e.key === 'hadoku-theme-mode') {
        setThemeModeState(getThemeMode())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Apply to the DOM.
  useEffect(() => {
    const valid = isThemeAvailable(theme) ? theme : 'light'

    document.documentElement.setAttribute('data-theme', valid)
    // Micro-frontend mounts style within their own subtree.
    if (containerRef?.current) {
      containerRef.current.setAttribute('data-theme', valid)
    }
    applyTheme(valid as Theme)

    // Delay "ready" on the very first pass so consumers can gate a fade-in
    // and avoid a flash of unstyled content.
    if (isInitialThemeLoad) {
      const timer = setTimeout(() => {
        setIsThemeReady(true)
        setIsInitialThemeLoad(false)
      }, 50)
      return () => clearTimeout(timer)
    }
    setIsThemeReady(true)
  }, [theme, containerRef, isInitialThemeLoad, isThemeAvailable])

  // Adopt the cross-device theme once the SDK resolves — unless the parent
  // shell forced one, or the user already chose this session.
  useEffect(() => {
    if (propsTheme) return
    if (userOverrodeRef.current) return
    const remote = persisted?.theme
    if (remote && remote !== theme && isThemeAvailable(remote)) {
      setThemeState(remote)
      // Cache it locally so the NEXT cold load's pre-paint script paints it
      // directly instead of defaulting and swapping.
      saveTheme(remote as Theme)
    }
  }, [persisted?.theme, propsTheme, theme, isThemeAvailable])

  useEffect(() => {
    if (propsTheme) return
    const remoteMode = persisted?.themeMode
    if (remoteMode && remoteMode !== themeMode) setThemeModeState(remoteMode)
  }, [persisted?.themeMode, propsTheme, themeMode])

  // Follow the OS light/dark switch WITHIN the active family, so someone on
  // `coffee-light` moves to `coffee-dark` at sunset rather than to plain dark.
  // Base light/dark are left alone — those are explicit choices, not families.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const family = theme.replace(/-light$|-dark$/, '')
      if (family === 'light' || family === 'dark') return

      const current = theme.endsWith('-dark') ? 'dark' : 'light'
      const target = e.matches ? 'dark' : 'light'
      if (current !== target) setTheme(`${family}-${target}`)
    }

    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme, setTheme])

  return {
    theme,
    setTheme,
    themeMode,
    setThemeMode,
    themeFamilies,
    experimentalThemes: experimentalEnabled,
    setExperimentalThemes,
    isDarkTheme: theme.endsWith('-dark') || theme === 'dark',
    hasAdvanced: themeHasAdvanced(theme as Theme),
    isThemeReady,
    isInitialThemeLoad
  }
}
