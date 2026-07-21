#!/usr/bin/env node
/**
 * Reports the current state of the token matrix: which tokens each theme
 * defines, where families are asymmetric, and which WCAG pairs pass.
 *
 * Read-only. Run before and after a normalization to see exactly what moved.
 */

import { parseThemes, allTokenNames, THEMES, FAMILIES, isDarkTheme } from './lib/parse-themes.mjs'
import { contrast, ratio } from './lib/color.mjs'

const themes = parseThemes()
const names = allTokenNames(themes)

/* ---- 1. Presence matrix: which themes define which token ---- */
const missing = []
for (const name of names) {
  const absent = THEMES.filter(t => !themes[t][name])
  if (absent.length) missing.push({ name, absent })
}

console.log(`# Token audit\n`)
console.log(`Themes: ${THEMES.length}   Distinct --color-* tokens: ${names.length}\n`)

console.log(`## Per-theme drift (token defined in some themes but not others)`)
if (!missing.length) {
  console.log('None — every token is defined in all 18 themes.\n')
} else {
  for (const { name, absent } of missing) {
    console.log(`- ${name} — missing in ${absent.length}: ${absent.join(', ')}`)
  }
  console.log('')
}

/* ---- 2. Family symmetry ---- */
const suffixes = new Set()
for (const name of names) {
  for (const f of FAMILIES) {
    if (name === `--color-${f}`) suffixes.add('')
    else if (name.startsWith(`--color-${f}-`)) suffixes.add(name.slice(`--color-${f}`.length))
  }
}
const sortedSuffixes = [...suffixes].sort()

console.log(`## Family symmetry (✓ = defined in all 18 themes)`)
console.log(`| family | ${sortedSuffixes.map(s => `\`${s || 'base'}\``).join(' | ')} | on-<f> |`)
console.log(`|---|${sortedSuffixes.map(() => ':-:').join('|')}|:-:|`)
for (const f of FAMILIES) {
  const cells = sortedSuffixes.map(s => {
    const name = `--color-${f}${s}`
    const count = THEMES.filter(t => themes[t][name]).length
    return count === THEMES.length ? '✓' : count === 0 ? '✗' : `${count}/18`
  })
  const onCount = THEMES.filter(t => themes[t][`--color-on-${f}`]).length
  console.log(
    `| ${f} | ${cells.join(' | ')} | ${onCount === THEMES.length ? '✓' : `${onCount}/18`} |`
  )
}
console.log('')

/* ---- 3. WCAG pairs ---- */
/* Three contracts from docs/THEME_SYSTEM_RULES.md:
   §1 on-<f>    vs <f>        — text on a filled button
   §1 on-<f>    vs <f>-dark   — same button in its hover/active state
   §2 on-<f>-bg vs <f>-bg     — badge text on its tint (the pair §2 flags P1) */
const failures = { filled: [], hover: [], badge: [] }

for (const theme of THEMES) {
  const tk = themes[theme]
  // Translucent -bg tints composite over the card surface they sit on.
  const surface =
    tk['--color-bg-card'] || tk['--color-bg'] || (isDarkTheme(theme) ? '#000' : '#fff')

  for (const f of FAMILIES) {
    const base = tk[`--color-${f}`]
    const on = tk[`--color-on-${f}`]
    const dark = tk[`--color-${f}-dark`]
    const tint = tk[`--color-${f}-bg`]
    const onTint = tk[`--color-on-${f}-bg`]

    const check = (bucket, fg, bg) => {
      if (!fg || !bg) return
      const r = contrast(fg, bg, surface)
      if (r < 4.5) failures[bucket].push({ theme, f, fg, bg, r: ratio(r) })
    }

    check('filled', on, base)
    check('hover', on, dark)
    check('badge', onTint, tint)
  }
}

const report = (title, rows, contract) => {
  console.log(`## ${title}`)
  console.log(`_${contract}_\n`)
  if (!rows.length) {
    console.log('All pairs pass.\n')
    return
  }
  console.log(`**${rows.length} failing pairs**\n`)
  console.log('| theme | family | fg | bg | ratio |')
  console.log('|---|---|---|---|--:|')
  for (const r of rows)
    console.log(`| ${r.theme} | ${r.f} | \`${r.fg}\` | \`${r.bg}\` | ${r.r}:1 |`)
  console.log('')
}

report(
  'Filled-button contrast — `on-<f>` on `<f>`',
  failures.filled,
  'THEME_SYSTEM_RULES §1: must be ≥ 4.5:1'
)
report(
  'Button hover contrast — `on-<f>` on `<f>-dark`',
  failures.hover,
  'THEME_SYSTEM_RULES §1 + §6: the hover state carries the same text, so it must clear 4.5:1 too'
)
report(
  'Badge contrast — `on-<f>-bg` on `<f>-bg`',
  failures.badge,
  'THEME_SYSTEM_RULES §2: must be ≥ 4.5:1 (closes the P1 unvalidated-pair item)'
)

const total = failures.filled.length + failures.hover.length + failures.badge.length
console.log(`---\n**Total WCAG failures: ${total}**`)
process.exitCode = 0 // audit is informational; check-contrast.mjs is the gate
