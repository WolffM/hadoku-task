#!/usr/bin/env node
/**
 * Gate: theme tokens must exist, and must be paired correctly.
 *
 * Five checks, because each covers a blind spot the others miss:
 *
 *   1. `var(--color-*)` in stylesheets  — catches renamed/typo'd tokens.
 *   2. Tailwind colour classes in markup — stylelint only lints .css and never
 *      sees `bg-success-bg` inside a .tsx, which is how hadoku_site shipped
 *      white buttons.
 *   3. `var(--x, fallback)` fallbacks   — a fallback renders the hardcoded
 *      value, so a wrong token looks correct in the default light theme and
 *      breaks in the other 17. This is the silent-failure vector, and the
 *      stylelint rule everyone reaches for ignores it by design.
 *   4. Layered `style.css` imports      — putting it in a cascade layer makes
 *      every colour resolve to nothing.
 *   5. The tint anti-pattern            — `--color-<f>` as text on
 *      `--color-<f>-bg`. Both tokens exist, so nothing else flags it, but the
 *      pair fails AA in 62 of 90 theme/family combinations.
 *
 *   node themes/scripts/check-usage.mjs [paths...]   (default: cwd)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { parseThemes, allTokenNames, THEMES } from './lib/parse-themes.mjs'

const roots = process.argv.slice(2).filter(a => !a.startsWith('--'))
const targets = roots.length ? roots : [process.cwd()]

const themes = parseThemes()
// Only tokens defined in EVERY theme count as usable.
const known = new Set(allTokenNames(themes).filter(n => THEMES.every(t => themes[t][n])))

// `.claude` holds git worktrees — separate checkouts that lint themselves.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.claude',
  'playwright-report',
  'test-results',
  '.profiler',
  'calendar-mockups'
])
const STYLE_EXT = new Set(['.css'])
const MARKUP_EXT = new Set(['.tsx', '.jsx', '.astro', '.html', '.vue', '.svelte'])

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walk(full)
    else yield full
  }
}

const problems = []
const add = (file, line, kind, detail) => problems.push({ file, line, kind, detail })

/** Tokens a file is allowed to define locally (app-scoped, not theme tokens). */
const localDefinitions = new Set()

for (const target of targets) {
  const base = statSync(target).isDirectory() ? target : null
  const files = base ? [...walk(base)] : [target]

  // Pass 1: collect locally-defined custom properties so app-level vars
  // (e.g. --skeleton-shimmer) don't read as unknown theme tokens.
  for (const file of files) {
    if (!STYLE_EXT.has(extname(file))) continue
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) localDefinitions.add(m[1])
  }

  for (const file of files) {
    const ext = extname(file)
    const isStyle = STYLE_EXT.has(ext)
    const isMarkup = MARKUP_EXT.has(ext)
    if (!isStyle && !isMarkup) continue
    // The package's own sources define the tokens; don't lint them against themselves.
    if (file.includes(join('themes', 'src')) || file.includes(join('themes', 'dev'))) continue

    const rel = relative(process.cwd(), file)
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)

    lines.forEach((line, i) => {
      const n = i + 1

      // (3) fallbacks — banned outright, they mask every other failure.
      // Covers every package-owned prefix, not just colours: --hdk-* fails the
      // same silent way (a stale --hdk-space-md renders the hardcoded px).
      for (const m of line.matchAll(/var\(\s*(--(?:color|hdk)-[a-z0-9-]+)\s*,/gi)) {
        add(rel, n, 'fallback', `var(${m[1]}, …) — fallbacks hide broken tokens; drop the fallback`)
      }

      // (1) unknown custom properties in var()
      for (const m of line.matchAll(/var\(\s*(--color-[a-z0-9-]+)\s*[,)]/gi)) {
        const name = m[1]
        if (!known.has(name) && !localDefinitions.has(name)) {
          add(rel, n, 'unknown-token', `var(${name}) is not defined by @wolffm/themes`)
        }
      }

      // (2) Tailwind colour classes in markup
      if (isMarkup) {
        for (const m of line.matchAll(
          /(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|accent|caret|divide|shadow)-((?:on-)?(?:primary|success|warning|danger|neutral|text|border|bg)(?:-[a-z0-9]+)*)(?![\w-])/g
        )) {
          const token = `--color-${m[1]}`
          if (!known.has(token)) {
            add(rel, n, 'unknown-class', `${m[0]} → ${token} is not mapped by @wolffm/themes`)
          }
        }
      }
    })

    if (isStyle) {
      const text = lines.join('\n')

      // The cascade-layer constraint that makes the whole mapping work.
      if (text.match(/@import\s+["'][^"']*@wolffm\/themes\/style\.css["']\s+layer\(/)) {
        add(
          rel,
          1,
          'layered-import',
          'style.css must be imported UNLAYERED or every colour resolves to nothing'
        )
      }

      // (4) The tint anti-pattern: `<f>` as text on the `<f>-bg` surface.
      // This is the exact pair that failed AA in 62 of 90 theme/family
      // combinations, and no amount of token checking catches it — both
      // tokens exist, they just must not be used together.
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      for (const rule of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = rule[2]
        const bg = body.match(/background(?:-color)?\s*:\s*var\(--color-([a-z]+)-bg\)/)
        const fg = body.match(/(?<!-)color\s*:\s*var\(--color-([a-z]+)\)\s*;/)
        if (bg && fg && bg[1] === fg[1]) {
          const line = stripped.slice(0, rule.index).split('\n').length
          add(
            rel,
            line,
            'tint-pair',
            `--color-${fg[1]} on --color-${bg[1]}-bg fails AA in most themes; use --color-on-${fg[1]}-bg`
          )
        }
      }
    }
  }
}

const BY_KIND = {
  'unknown-token': 'Unknown theme tokens',
  'unknown-class': 'Tailwind classes with no matching token',
  fallback: 'var() fallbacks (banned — they hide broken tokens)',
  'layered-import': 'style.css imported into a cascade layer',
  'tint-pair': 'Family colour used as text on its own tint (fails AA in most themes)'
}

if (!problems.length) {
  console.log(`check-usage: OK — every token reference resolves (${known.size} tokens known).`)
  process.exit(0)
}

for (const [kind, label] of Object.entries(BY_KIND)) {
  const rows = problems.filter(p => p.kind === kind)
  if (!rows.length) continue
  console.error(`\n${label} (${rows.length}):`)
  for (const p of rows) console.error(`  ${p.file}:${p.line}  ${p.detail}`)
}
console.error(`\ncheck-usage: FAILED — ${problems.length} problem(s).`)
process.exit(1)
