/**
 * Type definitions for the @wolffm/task/editor export. Hand-maintained and
 * copied into dist/editor/ by vite.config.ts, the same way src/app/entry.d.ts is.
 */

export interface ThemeEditorProps {
  /** Theme to open on. Defaults to `light`. */
  theme?: string
  /** Dev stack only — see src/editor/entry.tsx. Never set in production. */
  devTier?: string
}

export function mount(el: HTMLElement, props?: ThemeEditorProps): void
export function unmount(el: HTMLElement): void
