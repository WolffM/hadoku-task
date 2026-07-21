#!/usr/bin/env node
/**
 * Gate: the token set must be structurally symmetric and every WCAG pair in
 * docs/THEME_SYSTEM_RULES.md must hold, in all 18 themes.
 *
 * audit-tokens.mjs reports; this one fails the build. Run it after editing
 * style.css or authoring a theme — the theme editor's live HSL preview is an
 * approximation and is explicitly not the authority.
 */

import { parseThemes, THEMES, FAMILIES, STRUCTURAL, isDarkTheme } from './lib/parse-themes.mjs'
import { contrast, ratio } from './lib/color.mjs'
import { AA_TEXT } from './lib/derive.mjs'

const VARIANTS = ['', '-dark', '-bg', '-hover']
const themes = parseThemes()
const problems = []

/** Every app surface a component (and therefore a translucent tint) can sit on. */
const SURFACES = ['bg', 'bg-card', 'bg-alt']

for (const theme of THEMES) {
  const tk = themes[theme]
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
}

if (problems.length) {
  console.error(`check-contrast: FAILED — ${problems.length} problem(s)\n`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

const pairCount = THEMES.length * (FAMILIES.length * (2 + SURFACES.length) + 2 * SURFACES.length)
console.log(
  `check-contrast: OK — ${THEMES.length} themes, symmetric token set, ${pairCount} WCAG pairs pass.`
)
