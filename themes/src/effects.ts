/**
 * Per-theme advanced effect map
 *
 * Declares which effect modifier each surface type uses for a given
 * theme. Components that want to apply effects automatically (Path B
 * — themed primitive components) read this map. Until then, consumers
 * apply hdk-advanced-surface[--modifier] classes directly in JSX.
 *
 * To add an advanced contract to a theme:
 *   1. Define --advanced-stop-* and --advanced-gradient in the theme's
 *      [data-theme='X'] block in style.css
 *   2. Add an entry to THEME_EFFECTS below
 */

import type { Theme } from './index'

export type AdvancedEffect = 'shift' | 'cascade-rich' | 'sat-rich' | 'none'

export interface ThemeEffectMap {
  card: AdvancedEffect
  modal: AdvancedEffect
  button: AdvancedEffect
}

export const THEME_EFFECTS: Partial<Record<Theme, ThemeEffectMap>> = {
  light: { card: 'shift', modal: 'none', button: 'none' },
  'cyberpunk-dark': { card: 'cascade-rich', modal: 'none', button: 'none' }
}

/** True when the theme ships an advanced visual contract. */
export function hasAdvanced(theme: string): boolean {
  return theme in THEME_EFFECTS
}

/** Returns the effect map for a theme, or null if it has no advanced contract. */
export function getThemeEffects(theme: string): ThemeEffectMap | null {
  return THEME_EFFECTS[theme as Theme] ?? null
}
