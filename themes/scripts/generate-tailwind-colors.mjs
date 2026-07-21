#!/usr/bin/env node
/**
 * Generates themes/src/tailwind-colors.css from style.css.
 *
 * Root cause #2 of the recurring colour bugs was that every consumer
 * hand-maintained its own `@theme` colour subset, which drifted from the
 * source. Generating the mapping means it cannot drift: `--check` re-runs this
 * and fails if the committed file disagrees with the tokens.
 *
 *   node themes/scripts/generate-tailwind-colors.mjs [--check]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseThemes, allTokenNames, THEMES } from './lib/parse-themes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = resolve(here, '../src/tailwind-colors.css')

const themes = parseThemes()
const names = allTokenNames(themes)

// Only map tokens every theme defines — a partially-defined token would
// generate a utility that works in some themes and silently dies in others.
const complete = names.filter(n => THEMES.every(t => themes[t][n]))
const partial = names.filter(n => !complete.includes(n))
if (partial.length) {
  console.error(`Refusing to map partially-defined tokens: ${partial.join(', ')}`)
  process.exit(1)
}

const GROUPS = [
  ['Primary', n => n.includes('primary')],
  ['Success', n => n.includes('success')],
  ['Warning', n => n.includes('warning')],
  ['Danger', n => n.includes('danger')],
  ['Neutral', n => n.includes('neutral')],
  ['Text', n => n === '--color-text' || n.startsWith('--color-text-')],
  ['Borders', n => n === '--color-border' || n.startsWith('--color-border-')],
  ['Surfaces', n => n === '--color-bg' || n.startsWith('--color-bg-')]
]

const lines = []
const seen = new Set()
for (const [label, match] of GROUPS) {
  const group = complete.filter(n => !seen.has(n) && match(n))
  if (!group.length) continue
  group.forEach(n => seen.add(n))
  lines.push(`  /* ${label} */`)
  for (const n of group) lines.push(`  ${n}: var(${n});`)
  lines.push('')
}
const leftover = complete.filter(n => !seen.has(n))
if (leftover.length) {
  lines.push('  /* Other */')
  for (const n of leftover) lines.push(`  ${n}: var(${n});`)
  lines.push('')
}
while (lines.at(-1) === '') lines.pop()

const output = `/**
 * Tailwind v4 colour mapping for @wolffm/themes — GENERATED, DO NOT EDIT.
 *
 * Regenerate with: node themes/scripts/generate-tailwind-colors.mjs
 * Source of truth:  themes/src/style.css
 *
 * Mapping every theme token into Tailwind's \`--color-*\` namespace makes the
 * whole token set available as utilities — \`bg-primary\`, \`text-on-primary\`,
 * \`bg-success-bg\`, \`text-on-success-bg\`, \`border-border\`, \`bg-bg-card\` — with
 * no hand-written \`@theme\` block in any consumer.
 *
 * USAGE — import order matters:
 *
 *   @import "@wolffm/themes/style.css";          // 1. token values (UNLAYERED)
 *   @import "tailwindcss";                        // 2. Tailwind
 *   @import "@wolffm/themes/tailwind-colors.css"; // 3. this mapping
 *
 * WHY style.css MUST STAY UNLAYERED
 * =================================
 * Tailwind emits every \`@theme\` entry into \`@layer theme\` as \`:root { --x: var(--x) }\`
 * — a self-reference that is invalid on its own. It resolves correctly only
 * because style.css declares the same properties OUTSIDE any cascade layer,
 * and unlayered declarations beat layered ones. Importing style.css with
 * \`layer(...)\` puts both declarations in layers, the self-reference can win,
 * and EVERY colour silently resolves to nothing.
 *
 * So: never \`@import "@wolffm/themes/style.css" layer(base)\`.
 * \`themes/scripts/check-usage.mjs\` enforces this.
 */

@theme {
${lines.join('\n')}
}
`

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT_PATH, 'utf8')
  if (current.replace(/\r\n/g, '\n') !== output) {
    console.error(
      `${OUT_PATH} is out of date — run: node themes/scripts/generate-tailwind-colors.mjs`
    )
    process.exit(1)
  }
  console.log(`tailwind-colors.css is in sync (${complete.length} tokens mapped).`)
} else {
  writeFileSync(OUT_PATH, output)
  console.log(`Wrote ${OUT_PATH} — ${complete.length} tokens mapped.`)
}
