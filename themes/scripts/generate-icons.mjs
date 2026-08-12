#!/usr/bin/env node
/**
 * Vendor the icon artwork: src/icons/sources.json -> src/icons/registry.generated.ts
 *
 * We copy lucide's path data in rather than depending on `lucide-react`, for three
 * reasons that all matter here:
 *
 *   1. @wolffm/themes has ZERO runtime dependencies and must keep it that way — React
 *      is an optional peer, and the Astro/Qwik consumers on the frontpage have no React
 *      at all. A registry of plain strings serves every framework; a React icon library
 *      serves one.
 *   2. The set has to be ENFORCED. A dependency on lucide lets any consumer import any
 *      of its 2007 icons; a generated union of the names in sources.json does not.
 *   3. Strict CSP on the frontpage rules out fetching artwork at runtime, so it has to
 *      be in the bundle either way.
 *
 * Only the inner markup is stored. The wrapping <svg> and its attributes are applied by
 * getIconSvg()/<Icon>, so all 78 glyphs are guaranteed to share one set of attributes
 * and one sizing rule instead of drifting per-icon.
 *
 *   node scripts/generate-icons.mjs [--check]
 *
 * --check verifies the committed file is current (used by `pnpm validate` and CI) and
 * exits non-zero on drift, so a hand-edit of the generated file cannot survive.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCES = resolve(here, '../src/icons/sources.json')
const OUT = resolve(here, '../src/icons/registry.generated.ts')
const check = process.argv.includes('--check')

const require = createRequire(import.meta.url)
let lucideDir
let lucideVersion
try {
  const pkgPath = require.resolve('lucide-static/package.json')
  lucideDir = resolve(dirname(pkgPath), 'icons')
  lucideVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version
} catch {
  console.error(
    'generate-icons: lucide-static is not installed. It is a devDependency of this\n' +
      'package — run `pnpm install` in themes/ before regenerating.'
  )
  process.exit(1)
}

const raw = JSON.parse(readFileSync(SOURCES, 'utf8'))
// `$`-prefixed keys are the documentation blocks inside sources.json, not icons.
const entries = Object.entries(raw).filter(([k]) => !k.startsWith('$'))

if (!entries.length) {
  console.error('generate-icons: sources.json declares no icons')
  process.exit(1)
}

/** Pull the drawable children out of a lucide SVG, dropping the wrapper and its attrs. */
function innerMarkup(svg) {
  const open = svg.indexOf('>', svg.indexOf('<svg'))
  const close = svg.lastIndexOf('</svg>')
  return svg
    .slice(open + 1, close)
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('')
}

const missing = []
const icons = []
for (const [name, slug] of entries) {
  if (typeof slug !== 'string') {
    missing.push(`${name}: source must be a lucide slug string`)
    continue
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    missing.push(`${name}: icon names must be kebab-case`)
    continue
  }
  const file = resolve(lucideDir, `${slug}.svg`)
  if (!existsSync(file)) {
    missing.push(`${name} -> "${slug}" does not exist in lucide-static@${lucideVersion}`)
    continue
  }
  const body = innerMarkup(readFileSync(file, 'utf8'))
  if (!body) {
    missing.push(`${name} -> "${slug}" produced empty markup`)
    continue
  }
  icons.push({ name, slug, body })
}

if (missing.length) {
  console.error(`generate-icons: FAILED — ${missing.length} bad entr${missing.length === 1 ? 'y' : 'ies'}:`)
  for (const m of missing) console.error(`  ${m}`)
  process.exit(1)
}

icons.sort((a, b) => a.name.localeCompare(b.name))

const body = icons
  .map(i => `  ${/^[a-z][a-zA-Z0-9]*$/.test(i.name) ? i.name : `'${i.name}'`}: ${JSON.stringify(i.body)}`)
  .join(',\n')

const out = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source: src/icons/sources.json + lucide-static@${lucideVersion} (ISC, see LICENSE-lucide).
 * Regenerate with \`pnpm run generate:icons\`; \`pnpm run check:icons\` fails on drift.
 *
 * Values are the INNER markup of each glyph. The wrapping <svg> element and its
 * attributes come from getIconSvg()/<Icon> so every icon shares one set.
 */

export const ICON_MARKUP = {
${body}
} as const

/** Every icon name in the enforced set. An icon outside this union does not exist. */
export type IconName = keyof typeof ICON_MARKUP

export const ICON_NAMES = Object.keys(ICON_MARKUP) as IconName[]

/** The lucide slug each glyph was vendored from — provenance for regeneration. */
export const ICON_SOURCE_SLUGS: Record<IconName, string> = {
${icons.map(i => `  ${/^[a-z][a-zA-Z0-9]*$/.test(i.name) ? i.name : `'${i.name}'`}: '${i.slug}'`).join(',\n')}
}

export const LUCIDE_VERSION = '${lucideVersion}'
`

if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== out) {
    console.error(
      'check:icons: FAILED — registry.generated.ts is stale or hand-edited.\n' +
        'Run `pnpm run generate:icons` in themes/ and commit the result.'
    )
    process.exit(1)
  }
  console.log(`check:icons: OK — ${icons.length} icons match sources.json (lucide ${lucideVersion})`)
} else {
  writeFileSync(OUT, out)
  console.log(`generate-icons: wrote ${icons.length} icons -> src/icons/registry.generated.ts (lucide ${lucideVersion})`)
}
