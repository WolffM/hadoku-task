/**
 * The editor's state model, kept free of React so it reads as the rules it is.
 *
 * A theme's DRAFT is two layers over the values on main:
 *   - group adjustments: hue shift / chroma scale / lightness shift applied to
 *     every token in a group, relative to main's values (a slider position,
 *     not a running total — dragging back to 0 restores main exactly)
 *   - token overrides: an absolute value for one token, which wins over its
 *     group's adjustment
 *
 * All colour maths is OKLCH via @wolffm/themes/contract, the space
 * THEME_SYSTEM_RULES §8 requires: an HSL lightness step that is fine for blue
 * wrecks yellow, and a "brightness" slider should move every hue evenly.
 */
import {
  FAMILIES,
  STRUCTURAL,
  formatColor,
  normalizeColor,
  oklchToRgbInGamut,
  parseColor,
  rgbToOklch,
  type ThemeTokens,
  type TokenEdits
} from '@wolffm/themes/contract'

export interface Lch {
  L: number
  C: number
  H: number
  A: number
}

export interface GroupAdjust {
  /** Degrees added to hue. */
  dh: number
  /** Multiplier on chroma (saturation). */
  cs: number
  /** Added to OKLCH lightness (0–1 scale). */
  dl: number
}

export const NEUTRAL_ADJUST: GroupAdjust = { dh: 0, cs: 1, dl: 0 }

export interface ThemeDraft {
  groups: Record<string, GroupAdjust>
  tokens: Record<string, string>
}

export const emptyDraft = (): ThemeDraft => ({ groups: {}, tokens: {} })

export interface TokenGroup {
  id: string
  label: string
  tokens: string[]
}

const v = (name: string) => `--color-${name}`

/**
 * Surfaces / Text / one group per semantic family. `on-<f>` (the text ON a
 * filled button — black or white) is left out of its family's group: a hue
 * shift meant for the fill would tint that text, and contrast is what decides
 * it, not the family colour.
 */
export const GROUPS: TokenGroup[] = [
  {
    id: 'surfaces',
    label: 'Surfaces',
    tokens: STRUCTURAL.filter(s => s.startsWith('bg') || s.startsWith('border')).map(v)
  },
  { id: 'text', label: 'Text', tokens: STRUCTURAL.filter(s => s.startsWith('text')).map(v) },
  ...FAMILIES.map(f => ({
    id: f,
    label: f[0].toUpperCase() + f.slice(1),
    tokens: [v(f), v(`${f}-dark`), v(`${f}-bg`), v(`${f}-hover`), v(`on-${f}-bg`)]
  }))
]

/** Every token the editor shows, grouped; `on-<f>` sits with its family for display. */
export const DISPLAY_GROUPS: TokenGroup[] = GROUPS.map(g =>
  FAMILIES.includes(g.id) ? { ...g, tokens: [...g.tokens, v(`on-${g.id}`)] } : g
)

const groupOf = new Map<string, string>()
for (const g of GROUPS) for (const t of g.tokens) groupOf.set(t, g.id)

export function toLch(value: string): Lch {
  const [r, g, b, a] = parseColor(value)
  const { L, C, H } = rgbToOklch([r, g, b])
  return { L, C, H: Number.isFinite(H) ? H : 0, A: a }
}

export function fromLch({ L, C, H, A }: Lch): string {
  const rgb = oklchToRgbInGamut({ L, C, H: ((H % 360) + 360) % 360 })
  return formatColor([...rgb, A])
}

function adjust(value: string, a: GroupAdjust): string {
  if (a.dh === 0 && a.cs === 1 && a.dl === 0) return value
  const lch = toLch(value)
  return fromLch({ L: lch.L + a.dl, C: lch.C * a.cs, H: lch.H + a.dh, A: lch.A })
}

/** The value every token renders with under this draft. */
export function effectiveTokens(original: ThemeTokens, draft: ThemeDraft): ThemeTokens {
  const out: ThemeTokens = {}
  for (const [name, value] of Object.entries(original)) {
    const override = draft.tokens[name]
    if (override !== undefined) {
      out[name] = override
      continue
    }
    const group = groupOf.get(name)
    const a = group ? draft.groups[group] : undefined
    out[name] = a ? adjust(value, a) : value
  }
  return out
}

/** Same colour, whatever the spelling (`white` vs `#ffffff`, case, spacing). */
export function sameColor(a: string, b: string): boolean {
  try {
    return normalizeColor(a) === normalizeColor(b)
  } catch {
    return a === b
  }
}

/** Only the tokens whose colour actually differs from main. */
export function changedTokens(original: ThemeTokens, effective: ThemeTokens): ThemeTokens {
  const out: ThemeTokens = {}
  for (const [name, value] of Object.entries(effective)) {
    if (!sameColor(value, original[name])) out[name] = value
  }
  return out
}

export function editsFor(
  originals: Record<string, ThemeTokens>,
  drafts: Record<string, ThemeDraft>
): TokenEdits {
  const edits: TokenEdits = {}
  for (const [theme, draft] of Object.entries(drafts)) {
    const changed = changedTokens(originals[theme], effectiveTokens(originals[theme], draft))
    if (Object.keys(changed).length) edits[theme] = changed
  }
  return edits
}
