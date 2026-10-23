/**
 * Where a popup (tooltip bubble, dropdown list) should be portalled.
 *
 * Theme tokens are scoped: HadokuThemeRoot puts `data-theme` on the app
 * container, and a nested `[data-theme]` scope (a theme preview, an embedded
 * board) can sit inside that. A popup must render inside the SAME scope as its
 * anchor, or it paints in the wrong theme — portalled to <body>, it loses the
 * container's tokens entirely.
 *
 * Rendering it in place keeps the theme but breaks on any ancestor with a
 * `transform`, which becomes the containing block for `position: fixed` and
 * drags the popup off its anchor. The nearest `[data-theme]` ancestor is the
 * best of both: the right tokens, and above every transform between the
 * anchor and the theme root. When the only match is <html>, <body> takes it —
 * :root tokens reach body, and a portal into <html> itself would sit outside
 * the document's body.
 */
export function themeScopeOf(anchor: Element | null): HTMLElement | null {
  if (!anchor) return null
  const scope = anchor.closest<HTMLElement>('[data-theme]')
  if (!scope || scope === document.documentElement) return document.body
  return scope
}
