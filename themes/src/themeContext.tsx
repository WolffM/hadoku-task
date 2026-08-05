/**
 * HadokuThemeContext — how AppHeader gets a theme picker without importing one.
 *
 * WHY A CONTEXT AND NOT AN IMPORT
 * ------------------------------
 * The whole point of the locked header is that AppHeader RENDERS the theme
 * picker itself, so no app can pass a different one. To do that it needs the
 * theme families, the icon map and the current theme — all of which live in
 * `@wolffm/themes`.
 *
 * It cannot import them. `@wolffm/themes` peer-depends on THIS package and
 * imports `ThemeFamily` + every icon from it (see themes/src/metadata.tsx), so
 * `tuic -> themes` closes a cycle. React context inverts the data flow without
 * adding a package edge: tuic DEFINES and CONSUMES the context, themes PROVIDES
 * it via `<HadokuThemeRoot>`. The dependency graph stays themes -> tuic.
 *
 * It also keeps this package dependency-free (react peer only), which is a
 * property worth protecting — everything downstream installs it.
 *
 * Child apps never touch this. They mount `<HadokuThemeRoot>` from
 * `@wolffm/themes` once at their root and are done; the theme picker is then
 * identical everywhere by construction rather than by convention.
 */
import React from 'react'
import type { ThemeFamily, ThemeMode } from './theme-types'

export interface HadokuThemeValue {
  /** Active theme name, e.g. 'coffee-dark'. */
  theme: string
  /** Change the theme. Persists (session + local + cross-device prefs). */
  setTheme: (theme: string) => void
  /** Selectable families, in picker order. */
  themeFamilies: ThemeFamily[]
  /** Icon for a theme name, for the picker's toggle button. */
  getThemeIcon: (theme: string) => React.ReactNode
  /** True when the active theme is a dark variant. */
  isDarkTheme: boolean
  /** Simple/Advanced mode — only meaningful for themes with an advanced
   *  visual contract. Omitted ⇒ the picker hides the toggle. */
  themeMode?: ThemeMode
  setThemeMode?: (mode: ThemeMode) => void
  /** True when the ACTIVE theme ships an advanced contract. */
  hasAdvanced?: boolean
  /** Whether the experimental theme families are unlocked for this person.
   *  A shared preference, not an app setting — see @wolffm/themes themePrefs. */
  experimentalThemes?: boolean
  setExperimentalThemes?: (enabled: boolean) => void
  /** False until the theme has been applied to the DOM. Apps gate their first
   *  paint on this to avoid a flash of unstyled content. */
  isThemeReady: boolean
  /** True only during the very first resolve of a mount — lets an app tell
   *  "still booting" apart from "theme changing", which need different gates. */
  isInitialThemeLoad: boolean
}

const HadokuThemeContext = React.createContext<HadokuThemeValue | null>(null)

export interface HadokuThemeProviderProps {
  value: HadokuThemeValue
  children: React.ReactNode
}

/** Low-level provider. Apps should use `<HadokuThemeRoot>` from
 *  `@wolffm/themes`, which builds the value; this is the seam it plugs into. */
export function HadokuThemeProvider({ value, children }: HadokuThemeProviderProps) {
  return <HadokuThemeContext.Provider value={value}>{children}</HadokuThemeContext.Provider>
}

/**
 * Read the ambient theme. Throws when no provider is mounted rather than
 * degrading to a default — a silent fallback here is precisely the failure
 * mode the locked header exists to remove. A missing provider means the app
 * root was never wrapped, and it should say so at mount, loudly, with the fix
 * in the message. Guessing 'light' would ship a header that looks fine and
 * silently ignores the user's saved theme.
 */
export function useHadokuTheme(): HadokuThemeValue {
  const value = React.useContext(HadokuThemeContext)
  if (!value) {
    throw new Error(
      '[hadoku] No <HadokuThemeRoot> above this component. Every hadoku app must ' +
        "wrap its root once:\n\n  import { HadokuThemeRoot } from '@wolffm/themes'\n\n" +
        '  <HadokuThemeRoot>\n    <App />\n  </HadokuThemeRoot>\n\n' +
        'AppHeader renders the shared theme picker from that context — it is not ' +
        'a prop, so that every app gets the same control.'
    )
  }
  return value
}

/** Non-throwing read, for the rare component that legitimately renders both
 *  inside and outside a themed tree (e.g. a standalone error boundary). */
export function useHadokuThemeOptional(): HadokuThemeValue | null {
  return React.useContext(HadokuThemeContext)
}
