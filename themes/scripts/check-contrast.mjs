#!/usr/bin/env node
/**
 * Gate: the token set must be structurally symmetric and every WCAG pair in
 * docs/THEME_SYSTEM_RULES.md must hold, in all 18 themes.
 *
 * audit-tokens.mjs reports; this one fails the build. The rules themselves live
 * in lib/contract.mjs, which the hosted theme editor and the worker's save route
 * run too — so an editor save cannot pass a gate this script would fail.
 */

import { parseThemes } from './lib/parse-themes.mjs'
import { checkThemes, THEMES, WCAG_PAIR_COUNT } from './lib/contract.mjs'

const problems = checkThemes(parseThemes())

if (problems.length) {
  console.error(`check-contrast: FAILED — ${problems.length} problem(s)\n`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

console.log(
  `check-contrast: OK — ${THEMES.length} themes, symmetric token set, ${WCAG_PAIR_COUNT} WCAG pairs pass.`
)
