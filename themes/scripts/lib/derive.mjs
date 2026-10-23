/**
 * Derives the canonical token set for a theme from its existing values.
 *
 * Every derived value is produced in OKLCH (THEME_SYSTEM_RULES §8 — an HSL
 * lightness shift that is safe for blue is catastrophic for yellow) and then
 * verified against the WCAG contracts in §1/§2 rather than trusted.
 */

import {
  parseColor,
  flatten,
  contrast,
  toHex,
  rgbToOklch,
  oklchToRgb,
  shiftLightness
} from './color.mjs'
import { FAMILIES } from './tokens.mjs'

/** Minimum WCAG ratio for text (§1, §2). Derived values aim slightly above. */
export const AA_TEXT = 4.5
const TARGET = 4.6 // headroom so rounding can't drop a value under the bar

/**
 * Median OKLCH ΔL between the existing `<f>` and `<f>-dark` values across all
 * themes is ≈ -0.07 (measured over primary/success/danger, n=54). New `-dark`
 * values use that so they sit in the same visual family as the hand-authored ones.
 */
const DARK_SHIFT = -0.07

/**
 * `-dark` is overwhelmingly consumed as the bottom stop of a filled button's
 * gradient (`linear-gradient(180deg, var(--color-f), var(--color-f-dark))`),
 * not as a separate hover swap. So `on-<f>` sits on the whole ramp and has to
 * clear 4.5:1 at BOTH ends. These bound how far the ramp may travel: far
 * enough to read as a gradient, never far enough to break the text.
 */
const MIN_DARK_SHIFT = 0.03
const MAX_DARK_SHIFT = 0.12

const fmt = (rgb, alpha) =>
  alpha >= 1
    ? toHex(rgb)
    : `rgba(${rgb
        .slice(0, 3)
        .map(v => Math.round(v))
        .join(', ')}, ${Math.round(alpha * 100) / 100})`

/**
 * Text/icon color ON a filled `<f>` surface.
 *
 * §7 warns that the usual luminance-threshold heuristic flips near its 0.179
 * cutoff, so this picks by measured WCAG ratio instead: whichever of black or
 * white scores higher.
 */
function deriveOn(base) {
  return contrast('black', base) >= contrast('white', base) ? 'black' : 'white'
}

/**
 * Pull a base colour out of the luminance dead zone.
 *
 * §7: "If neither white nor black achieves 4.5:1, the base color is unsuitable
 * for a filled button." Three of the 90 family bases sit just inside that band
 * — they clear 4.5:1 on their own but leave no room for the gradient's bottom
 * stop. Darkening is the safe direction: it monotonically *increases* white's
 * contrast, so the ramp can only improve from there. The nudge preserves hue
 * and chroma and is 0.015–0.045 L, below the just-noticeable threshold.
 */
function ensureFillable(base) {
  const headroom = c => Math.max(contrast('black', c), contrast('white', c))
  if (headroom(base) >= TARGET + 0.2) return { color: base, nudged: false }

  for (let s = 0.005; s <= 0.25; s += 0.005) {
    const candidate = toHex(shiftLightness(base, -s).rgb)
    if (contrast('white', candidate) >= 4.8) {
      return { color: candidate, nudged: true, shift: s }
    }
  }
  return { color: base, nudged: false }
}

/**
 * The gradient's bottom stop: as deep as possible without dropping `on` below
 * the AA floor, bounded so the ramp stays visible but never runaway.
 */
function deriveDark(base, on = deriveOn(base)) {
  let shift = 0
  for (let s = MIN_DARK_SHIFT; s <= MAX_DARK_SHIFT; s += 0.005) {
    if (contrast(on, toHex(shiftLightness(base, -s).rgb)) >= TARGET) shift = s
    else break
  }
  const { rgb, alpha } = shiftLightness(base, -(shift || MIN_DARK_SHIFT))
  return fmt(rgb, alpha)
}

/**
 * Text color ON the faint `<f>-bg` tint (Material's on-container role).
 *
 * Keeps the family's hue and chroma so a badge still reads as that family,
 * but walks OKLCH lightness away from the tint until the pair clears 4.5:1.
 *
 * The tint is usually translucent, so what it composites over changes the
 * result. A badge can sit on any app surface, so this solves for the WORST of
 * them — deriving against `bg-card` alone left 19 pairs under the bar once the
 * same badge was placed on `bg-alt`.
 */
function deriveOnBg(base, tint, surfaces) {
  const list = Array.isArray(surfaces) ? surfaces : [surfaces]
  const solidTints = list.map(s => flatten(tint, s))
  const holds = color => solidTints.every(t => contrast(color, toHex(t)) >= TARGET)

  const { L, C, H } = rgbToOklch(parseColor(base))
  // Move away from the tint's lightness: darker text on a light tint, lighter
  // on a dark one. Use the lightest composite to choose the direction.
  const tintL = Math.max(...solidTints.map(t => rgbToOklch(t).L))
  const direction = tintL > 0.5 ? -1 : 1

  for (let step = 0; step <= 100; step += 1) {
    const target = L + direction * step * 0.01
    if (target < 0 || target > 1) break
    const candidate = toHex(oklchToRgb({ L: target, C, H }))
    if (holds(candidate)) return candidate
  }

  // Hue-preserving text can't reach the bar (near-black or near-white tint) —
  // fall back to whichever neutral holds across every surface.
  for (const neutral of ['black', 'white']) {
    if (holds(neutral)) return neutral
  }
  const worst = toHex(solidTints[0])
  return contrast('black', worst) >= contrast('white', worst) ? 'black' : 'white'
}

/**
 * Minimum OKLCH ΔL between the surfaces a boundary has to be seen across.
 *
 * Measured, not picked: every dark theme steps page → card by 0.052–0.098 and
 * reads fine, while the light themes had drifted to 0.008–0.025 — white cards
 * on a near-white page, with the 1px border left to carry the whole edge
 * alone. Two of them (strawberry, lavender) even had the card DARKER than the
 * page. Nothing gated it, because these tokens used to pass through untouched.
 */
export const SURFACE_STEP = 0.05 // page (`bg`) → raised (`bg-card`), both modes
/**
 * `border` / `border-light` against `bg-card`. The dark floor sits where the
 * dark themes already were (0.104–0.215); only ocean-dark (0.007) and
 * lavender-dark fell under it. The light floor is set above where the light
 * themes were, because at those values the edges were reported unreadable.
 */
export const BORDER_STEP = { light: 0.13, dark: 0.1 }
export const BORDER_LIGHT_STEP = { light: 0.075, dark: 0.05 }

/** Aim this far past a floor so hex rounding can't land a value back under it. */
const STEP_HEADROOM = 0.004

/**
 * A page pulled down off white has to carry the theme's hue, or it reads as
 * dirty grey. Measured: the moved pages that looked right (ocean, coffee,
 * nature) all sat at C ≥ 0.012; the ones that went dingy (strawberry,
 * lavender, pink, cyberpunk) were at ≤ 0.005. Below this, a hue is noise.
 */
const PAGE_MIN_CHROMA = 0.012
const ACHROMATIC = 0.002

const L = c => rgbToOklch(parseColor(c)).L
const withL = (color, target) => {
  const { rgb, alpha } = shiftLightness(color, target - L(color))
  return fmt(rgb, alpha)
}

/**
 * Pull the surface ladder apart until each step clears its floor.
 *
 * Moves as little as possible and only the values that fail, keeping hue and
 * chroma, so a theme that already holds is left alone: every dark theme but
 * two borders, and izakaya-light but for a one-hex-step border nudge. A card
 * is the lighter surface in both modes (§5: higher = lighter), unless an
 * inverted ladder already clears the step. In a light theme the PAGE moves
 * down rather than the card up — the card is already at or near white, and
 * "too bright" was the complaint. `bg-alt` and `bg-hover` ride along with the
 * page so their offsets from it are preserved, and all three are lifted to
 * PAGE_MIN_CHROMA, in their own hue or, where they have none, the primary's.
 *
 * A darker page lowers the contrast of whatever text sits on it, so the body
 * text tokens are then walked away from the surfaces until they clear AA again.
 */
function separateSurfaces(tokens, notes) {
  const out = { ...tokens }
  const set = (name, value) => {
    if (value === out[name]) return
    notes.push({ token: name, from: out[name], to: value, reason: 'separation' })
    out[name] = value
  }

  const light = L(out['--color-bg']) > 0.5
  const step = L(out['--color-bg-card']) - L(out['--color-bg'])
  // An inverted ladder that still clears the step is a deliberate choice —
  // izakaya-light's pink paper card on a cream page — and stays as authored.
  if (Math.abs(step) < SURFACE_STEP) {
    if (light) {
      // Inverted (card darker than page): lift the card to the page first, so
      // the step is measured down from a real top.
      if (step < 0) set('--color-bg-card', withL(out['--color-bg-card'], L(out['--color-bg'])))
      const shift = L(out['--color-bg-card']) - SURFACE_STEP - STEP_HEADROOM - L(out['--color-bg'])
      const hueOf = c => rgbToOklch(parseColor(c))
      const pageHue = [out['--color-bg'], out['--color-primary']]
        .map(hueOf)
        .find(o => o.C > ACHROMATIC).H
      for (const n of ['--color-bg', '--color-bg-alt', '--color-bg-hover']) {
        const own = hueOf(out[n])
        const H = own.C > ACHROMATIC ? own.H : pageHue
        const C = Math.max(own.C, PAGE_MIN_CHROMA)
        set(n, toHex(oklchToRgb({ L: own.L + shift, C, H })))
      }
    } else {
      const target = L(out['--color-bg']) + SURFACE_STEP + STEP_HEADROOM
      set('--color-bg-card', withL(out['--color-bg-card'], target))
    }
  }

  // Borders step away from the card toward the text: darker in a light
  // theme, lighter in a dark one.
  const card = out['--color-bg-card']
  const away = light ? -1 : 1
  const mode = light ? 'light' : 'dark'
  for (const [name, floor] of [
    ['--color-border', BORDER_STEP[mode]],
    ['--color-border-light', BORDER_LIGHT_STEP[mode]]
  ]) {
    if (Math.abs(rgbToOklch(flatten(out[name], card)).L - L(card)) < floor) {
      set(name, withL(out[name], L(card) + away * (floor + STEP_HEADROOM)))
    }
  }

  const surfaces = ['--color-bg', '--color-bg-card', '--color-bg-alt'].map(n => out[n])
  for (const name of ['--color-text', '--color-text-secondary']) {
    for (let s = 0; s <= 0.3; s += 0.005) {
      const candidate = s ? withL(out[name], L(out[name]) + away * s) : out[name]
      if (surfaces.every(bg => contrast(candidate, bg, card) >= TARGET)) {
        set(name, candidate)
        break
      }
    }
  }
  return out
}

/**
 * Build the full canonical color token map for one theme from its current one.
 *
 * Renames carry values over verbatim (no visual change); only genuinely new
 * tokens are computed.
 */
export function deriveTheme(input, notes = []) {
  const out = {}
  // Separate first: every surface-relative value below is solved against these.
  const tokens = separateSurfaces(input, notes)
  // Every surface a translucent tint might composite over.
  const surfaces = ['--color-bg-card', '--color-bg', '--color-bg-alt']
    .map(n => tokens[n])
    .filter(Boolean)
  if (!surfaces.length) surfaces.push('#ffffff')

  // Renames — the value already exists under a legacy name.
  const RENAMED_BG = {
    danger: '--color-danger-light', // danger had no -bg; its tint was -light
    neutral: '--color-muted-bg' // orphan name that broke the <family>-bg pattern
  }

  for (const f of FAMILIES) {
    const { color: base, nudged, shift } = ensureFillable(tokens[`--color-${f}`])
    if (nudged) {
      notes.push({ token: `--color-${f}`, from: tokens[`--color-${f}`], to: base, shift })
    }
    const on = deriveOn(base)

    // Keep a hand-authored `-dark` when it already holds the contract — those
    // are deliberate design choices, and the goal here is structural symmetry,
    // not homogenising every value. Re-derive only the ones that break it.
    const authored = tokens[`--color-${f}-dark`]
    const dark = authored && contrast(on, authored) >= AA_TEXT ? authored : deriveDark(base, on)
    if (authored && dark !== authored) {
      notes.push({ token: `--color-${f}-dark`, from: authored, to: dark, reason: 'contrast' })
    }

    const tint = tokens[`--color-${f}-bg`] || tokens[RENAMED_BG[f]]
    out[`--color-${f}`] = base
    out[`--color-${f}-dark`] = dark
    out[`--color-${f}-bg`] = tint
    out[`--color-${f}-hover`] = tokens[`--color-${f}-hover`]
    out[`--color-on-${f}`] = on
    out[`--color-on-${f}-bg`] = deriveOnBg(base, tint, surfaces)
  }

  // Structural tokens pass through untouched.
  for (const name of [
    '--color-text',
    '--color-text-secondary',
    '--color-text-tertiary',
    '--color-text-muted',
    '--color-border',
    '--color-border-light',
    '--color-bg',
    '--color-bg-card',
    '--color-bg-alt',
    '--color-bg-hover',
    '--color-bg-overlay'
  ]) {
    out[name] = tokens[name]
  }

  return out
}

/** Tokens removed by the consolidation, with what replaces them. */
export const REMOVED_TOKENS = {
  '--color-primary-light': '--color-primary-bg',
  '--color-danger-light': '--color-danger-bg',
  '--color-danger-darker': '--color-danger-dark',
  '--color-neutral-light': '--color-neutral-bg',
  '--color-neutral-lighter': '--color-neutral-bg',
  '--color-muted-bg': '--color-neutral-bg'
}
