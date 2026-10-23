/**
 * The theme contract, as pure functions over style.css TEXT.
 *
 * One implementation, three callers:
 *   - check-contrast.mjs (the CLI gate lint:css runs)
 *   - the hosted theme editor (@wolffm/task/editor), live as sliders move
 *   - the task worker's save route, which re-checks before it commits to main
 *
 * The editor's verdict is a preview; the worker's is the one that counts. They
 * agree because they are the same code, not because they were kept in sync.
 *
 * No node imports — this module is bundled into a browser page and a
 * Cloudflare Worker. Exposed as `@wolffm/themes/contract`.
 */

import { parseColor, flatten, contrast, luminance, ratio, toHex, rgbToOklch } from './color.mjs'
import { AA_TEXT, SURFACE_STEP, BORDER_STEP, BORDER_LIGHT_STEP } from './derive.mjs'
import {
  THEMES,
  FAMILIES,
  STRUCTURAL,
  isDarkTheme,
  parseThemes,
  readBlocks,
  blankComments,
  themesForSelector
} from './tokens.mjs'

export { THEMES, FAMILIES, STRUCTURAL, isDarkTheme, parseThemes, AA_TEXT }
export {
  parseColor,
  flatten,
  contrast,
  luminance,
  ratio,
  toHex,
  rgbToOklch,
  oklchToRgbInGamut
} from './color.mjs'

const VARIANTS = ['', '-dark', '-bg', '-hover']

/** Every app surface a component (and therefore a translucent tint) can sit on. */
const SURFACES = ['bg', 'bg-card', 'bg-alt']

/**
 * Every structural and WCAG problem in one theme's tokens, as human-readable
 * strings. Empty = the theme passes the gate.
 */
export function checkTheme(theme, tk) {
  const problems = []
  const surface =
    tk['--color-bg-card'] || tk['--color-bg'] || (isDarkTheme(theme) ? '#000' : '#fff')

  // 1. Structural symmetry — every family carries an identical token set.
  for (const f of FAMILIES) {
    for (const v of VARIANTS) {
      if (!tk[`--color-${f}${v}`]) problems.push(`${theme}: missing --color-${f}${v}`)
    }
    for (const on of [`--color-on-${f}`, `--color-on-${f}-bg`]) {
      if (!tk[on]) problems.push(`${theme}: missing ${on}`)
    }
  }
  for (const s of STRUCTURAL) {
    if (!tk[`--color-${s}`]) problems.push(`${theme}: missing --color-${s}`)
  }

  // 2. Contrast contracts. The `-bg` tints are translucent, so the pair is
  //    checked against every surface the badge could be placed on, not just
  //    the card — the same badge on `bg-alt` is a different composite.
  for (const f of FAMILIES) {
    const opaquePairs = [
      [`on-${f}`, tk[`--color-on-${f}`], f, tk[`--color-${f}`], 'filled button'],
      [
        `on-${f}`,
        tk[`--color-on-${f}`],
        `${f}-dark`,
        tk[`--color-${f}-dark`],
        'button gradient bottom'
      ]
    ]
    for (const [fgName, fg, bgName, bg, what] of opaquePairs) {
      if (!fg || !bg) continue
      const r = contrast(fg, bg, surface)
      if (r < AA_TEXT) {
        problems.push(
          `${theme}: ${what} — ${fgName} on ${bgName} is ${ratio(r)}:1 (needs ${AA_TEXT}:1)`
        )
      }
    }

    const fg = tk[`--color-on-${f}-bg`]
    const tint = tk[`--color-${f}-bg`]
    if (fg && tint) {
      for (const s of SURFACES) {
        const r = contrast(fg, tint, tk[`--color-${s}`])
        if (r < AA_TEXT) {
          problems.push(
            `${theme}: tint badge on ${s} — on-${f}-bg on ${f}-bg is ${ratio(r)}:1 (needs ${AA_TEXT}:1)`
          )
        }
      }
    }
  }

  // 3. Text must be readable on every surface it can land on. `-tertiary` and
  //    `-muted` are deliberately excluded: they are decorative-only and do not
  //    clear AA in every theme (documented in THEME_USAGE_GUIDE.md).
  for (const token of ['text', 'text-secondary']) {
    for (const s of SURFACES) {
      const r = contrast(tk[`--color-${token}`], tk[`--color-${s}`], surface)
      if (r < AA_TEXT) {
        problems.push(`${theme}: ${token} on ${s} is ${ratio(r)}:1 (needs ${AA_TEXT}:1)`)
      }
    }
  }

  // 4. Surface separation. WCAG says nothing about page vs card, which is how
  //    the light themes drifted to white-on-white with nobody noticing: every
  //    pair above passed while the cards were invisible. Floors and their
  //    measurement are documented beside SURFACE_STEP in derive.mjs.
  const L = c => rgbToOklch(flatten(c, surface)).L
  const mode = isDarkTheme(theme) ? 'dark' : 'light'
  const steps = [
    ['bg-card', 'bg', SURFACE_STEP],
    ['border', 'bg-card', BORDER_STEP[mode]],
    ['border-light', 'bg-card', BORDER_LIGHT_STEP[mode]]
  ]
  for (const [a, b, floor] of steps) {
    const fa = tk[`--color-${a}`]
    const fb = tk[`--color-${b}`]
    if (!fa || !fb) continue
    const d = Math.abs(L(fa) - L(fb))
    if (d < floor) {
      problems.push(`${theme}: ${a} vs ${b} is ΔL ${d.toFixed(3)} (needs ${floor} OKLCH)`)
    }
  }
  return problems
}

/** checkTheme over every shipped theme. */
export function checkThemes(themes) {
  return THEMES.flatMap(theme => checkTheme(theme, themes[theme] ?? {}))
}

/** Number of WCAG pairs checkTheme evaluates across all themes, for reporting. */
export const WCAG_PAIR_COUNT =
  THEMES.length * (FAMILIES.length * (2 + SURFACES.length) + 2 * SURFACES.length)

/**
 * Where each semantic family's hue is EXPECTED to sit, in OKLCH degrees. A
 * `success` that renders orange is not a contrast failure, but a reader who has
 * learned "green = done" will misread it — which is a comfort problem the AA
 * gate cannot see. Ranges are wide on purpose: they catch a family drifting to
 * another meaning, not a theme choosing its own shade.
 */
const SEMANTIC_HUES = {
  success: [100, 180],
  warning: [45, 110],
  danger: [0, 50, 330, 360]
}

function hueInRange(h, range) {
  for (let i = 0; i < range.length; i += 2) {
    if (h >= range[i] && h <= range[i + 1]) return true
  }
  return false
}

/**
 * Comfort metrics: the things that make a theme tiring to look at while every
 * AA pair still passes. ADVISORY — they guide the editor's meters and never
 * block a save; the contract above is the only gate.
 *
 * Measured 2026-10-23 when light themes were reported "painful": card-vs-page
 * separation was 1.03–1.07:1 in 8 of 9 light themes (cards invisible), borders
 * 1.25–1.55:1, and body text up to 17:1 on near-white.
 */
export function comfortMetrics(theme, tk) {
  const dark = isDarkTheme(theme)
  const bg = tk['--color-bg']
  const card = tk['--color-bg-card']
  const metrics = []
  const push = (id, label, value, ok, target, display) =>
    metrics.push({ id, label, value, ok, target, display: display ?? `${ratio(value)}:1` })

  try {
    const sep = contrast(card, bg, bg)
    push('surface-separation', 'Card vs page', sep, sep >= 1.1, '≥ 1.10:1')

    const border = contrast(tk['--color-border'], card, bg)
    push('border-visibility', 'Border vs card', border, border >= 1.6, '≥ 1.60:1')

    const text = contrast(tk['--color-text'], bg, bg)
    push('text-harshness', 'Text vs page', text, text >= 7 && text <= 15, '7–15:1')

    const lum = luminance(flatten(bg, dark ? '#000' : '#fff'))
    if (dark) {
      push('page-depth', 'Page darkness', lum, lum <= 0.02, '≤ 0.020', lum.toFixed(3))
    } else {
      push('page-glare', 'Page glare', lum, lum <= 0.9, '≤ 0.900', lum.toFixed(3))
    }

    for (const [family, range] of Object.entries(SEMANTIC_HUES)) {
      const [r, g, b] = parseColor(tk[`--color-${family}`])
      const { H, C } = rgbToOklch([r, g, b])
      // A near-grey has no meaningful hue; don't flag what nobody can see.
      const ok = C < 0.03 || hueInRange(H, range)
      push(
        `${family}-hue`,
        `${family} reads as ${family}`,
        H,
        ok,
        `hue ${range.slice(0, 2).join('–')}°`,
        `${Math.round(H)}°`
      )
    }
  } catch (e) {
    metrics.push({
      id: 'unparseable',
      label: 'Unparseable token',
      value: 0,
      ok: false,
      target: '',
      display: e instanceof Error ? e.message : String(e)
    })
  }
  return metrics
}

/**
 * Serialize [r,g,b,a] the way style.css writes colors: lowercase #rrggbb when
 * opaque, `rgba(r, g, b, a)` when translucent.
 */
export function formatColor([r, g, b, a = 1]) {
  if (a >= 1) return toHex([r, g, b])
  const c = v => Math.round(Math.min(255, Math.max(0, v)))
  const alpha = Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${alpha})`
}

const NUM = String.raw`\d+(?:\.\d+)?%?|\.\d+%?`
/** #hex, white/black, or rgb()/rgba() of plain numbers — nothing parseFloat could half-read. */
const STRICT_COLOR = new RegExp(
  String.raw`^(?:white|black|#[0-9a-f]{3,8}|rgba?\(\s*(?:${NUM})(?:\s*[,\s/]\s*(?:${NUM})){2,3}\s*\))$`,
  'i'
)

/**
 * Parse an untrusted color and re-serialize it. Throws unless every channel
 * is a finite number in range — parseColor alone does not guarantee that
 * (`rgba(1;},2,3)` parses to NaN rather than throwing).
 *
 * This is what makes a save safe: the text spliced into style.css is always
 * produced HERE, never copied from the request.
 */
export function normalizeColor(input) {
  if (typeof input !== 'string' || input.length > 64 || !STRICT_COLOR.test(input.trim())) {
    throw new Error(`Not a color: ${String(input).slice(0, 64)}`)
  }
  const rgba = parseColor(input)
  const ok =
    rgba.slice(0, 3).every(v => Number.isFinite(v) && v >= 0 && v <= 255) &&
    Number.isFinite(rgba[3]) &&
    rgba[3] >= 0 &&
    rgba[3] <= 1
  if (!ok) throw new Error(`Color out of range: ${input}`)
  return formatColor(rgba)
}

/**
 * Locate `name`'s value inside a block body. Returns offsets relative to the
 * body, or null. Scans the comment-blanked body so a commented-out
 * declaration never matches, while offsets stay valid for the original text.
 */
function findValue(body, name) {
  const scan = blankComments(body)
  const re = new RegExp(`(^|[\\s;{])${name.replace(/[-]/g, '\\-')}\\s*:`, 'g')
  let match
  let last = null
  while ((match = re.exec(scan)) !== null) {
    let i = re.lastIndex
    let depth = 0
    while (i < scan.length) {
      const c = scan[i]
      if (c === '(') depth += 1
      else if (c === ')') depth -= 1
      else if (c === ';' && depth === 0) break
      i += 1
    }
    let start = re.lastIndex
    let end = i
    while (start < end && /\s/.test(scan[start])) start += 1
    while (end > start && /\s/.test(scan[end - 1])) end -= 1
    // Last declaration wins, mirroring the cascade.
    last = { start, end }
  }
  return last
}

/**
 * Apply `{ [theme]: { [--color-token]: value } }` to style.css text.
 *
 * Returns `{ css, changes }`, where `changes` lists only the tokens whose value
 * actually moved. Throws on an unknown theme or token, a theme whose block is
 * shared with another theme (an edit would leak), or an invalid color.
 * Every byte outside the edited values — comments, CRLF line endings,
 * ordering — is preserved.
 */
export function applyTokenEdits(css, edits) {
  const blocks = readBlocks(css)
  const splices = []
  const changes = []

  for (const [theme, tokens] of Object.entries(edits)) {
    if (!THEMES.includes(theme)) throw new Error(`Unknown theme: ${theme}`)
    for (const [name, raw] of Object.entries(tokens)) {
      if (!/^--color-[a-z0-9-]+$/.test(name)) throw new Error(`Not a color token: ${name}`)
      const value = normalizeColor(raw)

      let target = null
      for (const block of blocks) {
        const names = themesForSelector(block.selector)
        if (!names.includes(theme)) continue
        const at = findValue(block.body, name)
        if (at) target = { block, at, names }
      }
      if (!target) throw new Error(`${theme} does not declare ${name}`)
      if (target.names.length > 1) {
        throw new Error(
          `${theme}'s ${name} lives in a block shared with ${target.names.join(', ')} — refusing to edit it from one theme`
        )
      }
      const start = target.block.start + target.at.start
      const end = target.block.start + target.at.end
      const from = css.slice(start, end)
      if (from === value) continue
      splices.push({ start, end, value })
      changes.push({ theme, token: name, from, to: value })
    }
  }

  let out = css
  for (const s of splices.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + s.value + out.slice(s.end)
  }
  return { css: out, changes }
}
