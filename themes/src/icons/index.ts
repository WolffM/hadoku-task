/**
 * The enforced icon set — framework-free half.
 *
 * Every consumer references icons BY NAME from `IconName`. Nobody inlines their own
 * SVG: an icon that is not in the registry does not exist, which is what keeps 16 apps
 * rendering the same pictograph for the same idea. TS consumers get that as a type
 * error; everyone else gets it from `scripts/check-icons.mjs`.
 *
 * This module has no React import on purpose. The frontpage POCs are Astro (one Qwik)
 * and cannot mount a React component just to draw a 16px glyph, so the string path is
 * the primary API and `<Icon>` is a convenience on top of it.
 */
import { ICON_MARKUP } from './registry.generated'
import type { IconName } from './registry.generated'

export { ICON_MARKUP, ICON_NAMES, ICON_SOURCE_SLUGS, LUCIDE_VERSION } from './registry.generated'
export type { IconName } from './registry.generated'

/** The five accent families. Same set as the colour tokens — no icon-only families. */
export const ICON_FAMILIES = ['primary', 'success', 'warning', 'danger', 'neutral'] as const
export type IconFamily = (typeof ICON_FAMILIES)[number]

/**
 * How the icon is coloured. Every option resolves through theme tokens — there is
 * no way to pass a raw colour — but WHICH treatment to use is the consumer's call.
 *
 * - `bare`   — glyph inherits `currentColor`. The default. Use it inside a button
 *              or beside a label and the icon matches that text automatically, in
 *              every theme, with no contrast obligation of its own.
 * - `accent` — glyph painted `--color-<family>`. For when the icon is its own
 *              element and should NOT match the surrounding text. You own the
 *              contrast: a bare accent glyph clears 3:1 on a card/page surface in
 *              28 of 36 theme/surface combinations for `warning`, so this is right
 *              when you know the surface and wrong as a blanket default.
 * - `tint`   — glyph in a `--color-<f>-bg` tile with `--color-on-<f>-bg` ink.
 * - `filled` — glyph in a `--color-<f>` tile with `--color-on-<f>` ink.
 *
 * `tint` and `filled` clear 3:1 in all 18 themes for all five families.
 */
export type IconVariant = 'bare' | 'accent' | 'tint' | 'filled'

export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ICON_MARKUP, value)
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/** Escape a caller-supplied string before it goes into the markup we return. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ESCAPES[c])
}

export interface IconSvgOptions {
  /** CSS length. Defaults to `1em` so the glyph scales with its surrounding text. */
  size?: string | number
  /** Extra classes appended after `hdk-icon`. */
  className?: string
  /**
   * Paint the glyph with `--color-<family>` instead of inheriting `currentColor`.
   * Adds `hdk-icon--<family>`; requires icons.css. Omit to inherit.
   */
  family?: IconFamily
  /**
   * Accessible name. Omit for decorative icons (the default) — those are rendered
   * `aria-hidden` so a screen reader does not announce a glyph that repeats an
   * adjacent label. Supply it only when the icon is the sole carrier of meaning.
   */
  title?: string
  /** Stroke width in the 24x24 viewBox. Lucide's default is 2. */
  strokeWidth?: number
}

/**
 * A complete, standalone `<svg>` string for one icon.
 *
 * Astro/Qwik/plain HTML, no client JS:
 *   <span set:html={getIconSvg('popcorn')} />
 *   <span class="hdk-icon-tile hdk-icon-tile--tint hdk-icon-tile--warning"
 *         set:html={getIconSvg('popcorn')} />
 */
export function getIconSvg(name: IconName, options: IconSvgOptions = {}): string {
  const markup = ICON_MARKUP[name]
  if (markup === undefined) {
    // Loud rather than silent: a blank space where an icon should be is the failure
    // mode that ships to production unnoticed.
    throw new Error(
      `getIconSvg: "${String(name)}" is not in the icon registry. ` +
        `Add it to themes/src/icons/sources.json and run \`pnpm run generate:icons\`.`
    )
  }
  const { size = '1em', className, title, strokeWidth = 2, family } = options
  const dim = typeof size === 'number' ? `${size}px` : size
  const cls = ['hdk-icon', family ? `hdk-icon--${family}` : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  const label = title
    ? `role="img" aria-label="${escapeHtml(title)}"`
    : 'aria-hidden="true" focusable="false"'

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(cls)}" ` +
    `width="${escapeHtml(dim)}" height="${escapeHtml(dim)}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="round" stroke-linejoin="round" ${label}>` +
    (title ? `<title>${escapeHtml(title)}</title>` : '') +
    markup +
    '</svg>'
  )
}

/** Class list for an accent tile, for the framework-free path. */
export function getIconTileClass(
  family: IconFamily = 'warning',
  variant: Exclude<IconVariant, 'bare'> = 'tint',
  round = false
): string {
  return (
    `hdk-icon-tile hdk-icon-tile--${variant} hdk-icon-tile--${family}` +
    (round ? ' hdk-icon-tile--round' : '')
  )
}

// Canonical emoji -> icon name. Generated into registry.generated.ts from
// emoji-map.json, so nothing loads JSON at runtime and there is one source.
import { EMOJI_TO_ICON } from './registry.generated'

export { EMOJI_TO_ICON } from './registry.generated'

/** Variation selectors and skin tones are presentation, not identity. */
function stripPresentation(s: string): string {
  return [...s]
    .filter(c => {
      const p = c.codePointAt(0)!
      return p !== 0xfe0f && p !== 0xfe0e && !(p >= 0x1f3fb && p <= 0x1f3ff)
    })
    .join('')
}

/**
 * The registry name a raw emoji should become, or undefined if it has no
 * canonical answer. `⚙` and `⚙️` resolve identically.
 */
export function emojiToIconName(emoji: string): IconName | undefined {
  return EMOJI_TO_ICON[stripPresentation(emoji)] ?? EMOJI_TO_ICON[emoji]
}
