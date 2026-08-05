/**
 * Theme-domain types.
 *
 * These described the theme model but lived in @wolffm/task-ui-components, so
 * @wolffm/themes had to import them from there — half of the dependency edge
 * that forced the context and its provider into separate packages. A type is
 * erased at runtime and cannot itself cause a duplicate-module bug, but leaving
 * it behind would have kept the import alive for no reason.
 *
 * Picker-specific types (DropdownPlacement, ThemePickerProps) stay in
 * task-ui-components: they describe a component's props, not the theme model.
 */
import type { ReactNode } from 'react'

/** Theme name — any string your theme system recognises. */
export type ThemeName = string

/**
 * A light/dark theme pair with its icons and labels.
 *
 * Icons are optional: the picker falls back to a shape based on the family's
 * position when one is absent.
 */
export interface ThemeFamily {
  lightIcon?: ReactNode
  darkIcon?: ReactNode
  lightTheme: ThemeName
  darkTheme: ThemeName
  lightLabel: string
  darkLabel: string
}

/**
 * Simple flattens advanced visuals (gradients, effects) to their solid colour
 * fallback; advanced renders them.
 */
export type ThemeMode = 'simple' | 'advanced'
