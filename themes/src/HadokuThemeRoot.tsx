/**
 * HadokuThemeRoot — the single thing a hadoku app mounts to get the platform's
 * theming and the locked header.
 *
 * Wrap the app root once:
 *
 * ```tsx
 * import { HadokuThemeRoot } from '@wolffm/themes'
 *
 * export function mount(el: HTMLElement) {
 *   createRoot(el).render(
 *     <HadokuThemeRoot>
 *       <App />
 *     </HadokuThemeRoot>
 *   )
 * }
 * ```
 *
 * That is the entire integration. `<AppHeader>` then renders the shared theme
 * picker and the shared settings gear from this context — an app does not pass
 * them, cannot substitute them, and no longer needs a local `useTheme`,
 * `themePrefs` or `themeConfig` module.
 *
 * WHY THE CONTEXT LIVES HERE TOO
 * -------------------------------
 * It did not always. The context was defined in task-ui-components (where
 * AppHeader consumes it) and only FILLED here, because this package used to
 * import the theme icons from there and the reverse import would have closed a
 * cycle.
 *
 * A context defined in one package and provided from another only works while
 * exactly one copy of the defining module exists across every install tree,
 * bundle and import map that touches it. That held until it didn't: on
 * 2026-08-05 three apps threw "No <HadokuThemeRoot> above this component" with
 * the provider plainly mounted, because a second copy of task-ui-components
 * meant a second createContext() — provider filling one, consumer reading the
 * other.
 *
 * Moving the icons here reversed the arrow, so the context now ships beside the
 * provider that fills it, in the package every app already resolves through the
 * parent's import map.
 */
import React, { useMemo, type RefObject } from 'react'
import { HadokuThemeProvider, type HadokuThemeValue } from './themeContext'
import { useTheme } from './useTheme'
import { THEME_ICON_MAP } from './metadata'

export interface HadokuThemeRootProps {
  children: React.ReactNode
  /** Theme forced by a parent shell (the portfolio passes its resolved theme
   *  into micro-frontend mounts). Omit for a standalone app. */
  theme?: string
  /** Mirror `data-theme` onto this container as well as <html> — needed when
   *  the app mounts into a subtree rather than owning the document. */
  containerRef?: RefObject<HTMLElement | null>
  /** Reported when a requested theme could not be honoured and a default was
   *  applied instead. Passed straight through to useTheme — see the rationale
   *  on UseThemeOptions.onThemeDegraded for why this is a callback and not a
   *  log call inside this package. */
  onThemeDegraded?: (info: { requested: string; applied: string; reason: string }) => void
}

/** Resolve a theme name to its icon. Central so the picker's toggle button
 *  looks identical in every app — this used to be a per-app arrow function,
 *  and one app had a debug logger inside it. */
function getThemeIcon(theme: string): React.ReactNode {
  const Icon = THEME_ICON_MAP[theme as keyof typeof THEME_ICON_MAP]
  return Icon ? <Icon /> : null
}

export function HadokuThemeRoot({
  children,
  theme: propsTheme,
  containerRef,
  onThemeDegraded
}: HadokuThemeRootProps) {
  const t = useTheme({ propsTheme, containerRef, onThemeDegraded })

  const value = useMemo<HadokuThemeValue>(
    () => ({
      theme: t.theme,
      setTheme: t.setTheme,
      themeFamilies: t.themeFamilies,
      getThemeIcon,
      isDarkTheme: t.isDarkTheme,
      experimentalThemes: t.experimentalThemes,
      setExperimentalThemes: t.setExperimentalThemes,
      isThemeReady: t.isThemeReady,
      isInitialThemeLoad: t.isInitialThemeLoad
    }),
    [
      t.theme,
      t.setTheme,
      t.themeFamilies,
      t.isDarkTheme,
      t.experimentalThemes,
      t.setExperimentalThemes,
      t.isThemeReady,
      t.isInitialThemeLoad
    ]
  )

  return <HadokuThemeProvider value={value}>{children}</HadokuThemeProvider>
}
