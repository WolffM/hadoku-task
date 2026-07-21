#!/usr/bin/env node
/**
 * Gate: THEME_USAGE_GUIDE.md must list exactly the tokens that exist.
 *
 * A usage guide that drifts from the stylesheet is worse than none — it is a
 * confident, wrong answer, and it is what agents read first. This fails the
 * build in both directions: a token missing from the guide, or a token named
 * in the guide that no longer exists.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseThemes, allTokenNames, THEMES } from './lib/parse-themes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const GUIDE = resolve(here, '../THEME_USAGE_GUIDE.md')

const themes = parseThemes()
const actual = new Set(allTokenNames(themes).filter(n => THEMES.every(t => themes[t][n])))

const text = readFileSync(GUIDE, 'utf8')
// Only count tokens inside the "Complete token list" section's tables — the
// anti-pattern table deliberately names removed tokens.
const listStart = text.indexOf('## Complete token list')
const listEnd = text.indexOf('## Anti-patterns')
if (listStart < 0 || listEnd < 0) {
  console.error(
    'check-docs: FAILED — could not locate the token-list section in THEME_USAGE_GUIDE.md'
  )
  process.exit(1)
}
const documented = new Set(
  [...text.slice(listStart, listEnd).matchAll(/`(--color-[a-z0-9-]+)`/g)].map(m => m[1])
)

const undocumented = [...actual].filter(t => !documented.has(t)).sort()
const stale = [...documented].filter(t => !actual.has(t)).sort()

if (undocumented.length || stale.length) {
  console.error('check-docs: FAILED — THEME_USAGE_GUIDE.md is out of sync with style.css\n')
  if (undocumented.length) {
    console.error(`  Tokens missing from the guide (${undocumented.length}):`)
    for (const t of undocumented) console.error(`    ${t}`)
  }
  if (stale.length) {
    console.error(`  Tokens in the guide that no longer exist (${stale.length}):`)
    for (const t of stale) console.error(`    ${t}`)
  }
  process.exit(1)
}

console.log(`check-docs: OK — THEME_USAGE_GUIDE.md documents all ${actual.size} tokens.`)
