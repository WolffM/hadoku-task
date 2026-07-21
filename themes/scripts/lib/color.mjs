/**
 * Color math for theme token validation.
 *
 * Handles the three value formats that appear in style.css: #rrggbb,
 * rgba(r, g, b, a), and the CSS keywords black/white. Alpha matters — the
 * `-bg` and `-hover` tokens are translucent, so contrast has to be computed
 * against the composited result over a real surface, not the raw value.
 */

const NAMED = {
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
  transparent: [0, 0, 0, 0]
}

/**
 * Parse a CSS color into [r, g, b, a]. Throws on anything unrecognized.
 * Already-parsed [r,g,b,a] tuples pass straight through, so the output of
 * flatten() can be fed back in as a backdrop without a round-trip to string.
 */
export function parseColor(input) {
  if (Array.isArray(input)) {
    const [r, g, b, a = 1] = input
    return [r, g, b, a]
  }
  const value = String(input).trim().toLowerCase()

  if (NAMED[value]) return [...NAMED[value]]

  const hex = value.match(/^#([0-9a-f]{3,8})$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) {
      h = h
        .split('')
        .map(c => c + c)
        .join('')
    }
    if (h.length !== 6 && h.length !== 8) {
      throw new Error(`Unsupported hex color: ${input}`)
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    ]
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean)
    if (parts.length < 3) throw new Error(`Unsupported rgb color: ${input}`)
    const channel = p => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p))
    const alpha =
      parts[3] === undefined
        ? 1
        : parts[3].endsWith('%')
          ? parseFloat(parts[3]) / 100
          : parseFloat(parts[3])
    return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha]
  }

  throw new Error(`Cannot parse color: ${input}`)
}

/** Composite a possibly-translucent foreground over an opaque backdrop. */
export function flatten(color, backdrop) {
  const [r, g, b, a] = parseColor(color)
  if (a >= 1) return [r, g, b, 1]
  const [br, bg, bb] = parseColor(backdrop)
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1]
}

/** WCAG 2.2 relative luminance. */
export function luminance(rgb) {
  const [r, g, b] = rgb.slice(0, 3).map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * WCAG 2.2 contrast ratio between two colors, each flattened over `backdrop`
 * first so translucent tokens are measured as they actually render.
 */
export function contrast(fg, bg, backdrop = '#ffffff') {
  const f = luminance(flatten(fg, flatten(bg, backdrop)))
  const b = luminance(flatten(bg, backdrop))
  const [hi, lo] = f > b ? [f, b] : [b, f]
  return (hi + 0.05) / (lo + 0.05)
}

/** Round a ratio the way the docs report it. */
export const ratio = n => Math.round(n * 100) / 100

export function toHex([r, g, b]) {
  const c = v =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/* ---------- OKLCH, for perceptually-even shade derivation ---------- */
/* THEME_SYSTEM_RULES.md §8: derive variants in OKLCH, not HSL — an HSL
   lightness shift that is fine for blue is catastrophic for yellow. */

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

export function rgbToOklch([r, g, b]) {
  const lr = srgbToLinear(r / 255)
  const lg = srgbToLinear(g / 255)
  const lb = srgbToLinear(b / 255)

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  const C = Math.sqrt(a * a + bb * bb)
  let H = (Math.atan2(bb, a) * 180) / Math.PI
  if (H < 0) H += 360
  return { L, C, H }
}

export function oklchToRgb({ L, C, H }) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return [linearToSrgb(lr) * 255, linearToSrgb(lg) * 255, linearToSrgb(lb) * 255].map(v =>
    Math.min(255, Math.max(0, v))
  )
}

/**
 * Shift a color's OKLCH lightness by `delta` (positive = lighter), clamping
 * chroma so the result stays in sRGB gamut.
 */
export function shiftLightness(color, delta) {
  const [r, g, b, alpha] = parseColor(color)
  const { L, C, H } = rgbToOklch([r, g, b])
  const target = Math.min(1, Math.max(0, L + delta))

  // Binary-search chroma down until the result round-trips inside sRGB.
  let lo = 0
  let hi = C
  let best = oklchToRgb({ L: target, C: 0, H })
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2
    const candidate = oklchToRgb({ L: target, C: mid, H })
    const inGamut = candidate.every(v => v >= -0.5 && v <= 255.5)
    if (inGamut) {
      best = candidate
      lo = mid
    } else {
      hi = mid
    }
  }
  return { rgb: best, alpha }
}
