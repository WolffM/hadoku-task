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
 * WHY THIS LIVES IN @wolffm/themes AND NOT IN task-ui-components
 * -------------------------------------------------------------
 * The context is DEFINED in task-ui-components (that is where AppHeader reads
 * it) but can only be FILLED here. This package already peer-depends on
 * task-ui-components and imports `ThemeFamily` plus every icon from it; the
 * reverse edge would be a cycle. Providing the value from this side keeps the
 * dependency arrow pointing one way — themes -> task-ui-components — while
 * still letting the header own its controls.
 */
import React, { useMemo, type RefObject } from 'react'
import { HadokuThemeProvider, type HadokuThemeValue } from '@wolffm/task-ui-components'
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
  containerRef
}: HadokuThemeRootProps) {
  const t = useTheme({ propsTheme, containerRef })

  const value = useMemo<HadokuThemeValue>(
    () => ({
      theme: t.theme,
      setTheme: t.setTheme,
      themeFamilies: t.themeFamilies,
      getThemeIcon,
      isDarkTheme: t.isDarkTheme,
      themeMode: t.themeMode,
      setThemeMode: t.setThemeMode,
      hasAdvanced: t.hasAdvanced,
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
      t.themeMode,
      t.setThemeMode,
      t.hasAdvanced,
      t.experimentalThemes,
      t.setExperimentalThemes,
      t.isThemeReady,
      t.isInitialThemeLoad
    ]
  )

  return <HadokuThemeProvider value={value}>{children}</HadokuThemeProvider>
}
