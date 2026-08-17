/**
 * Parses themes/src/style.css into a per-theme token map.
 *
 * The file is a flat sequence of `[data-theme='x'] { ... }` blocks (plus the
 * `:root, [data-theme='light']` opener). A theme can appear in more than one
 * block — the advanced-gradient contract is declared separately — so tokens
 * are merged in source order, last write winning, which mirrors the cascade.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const STYLE_PATH = resolve(here, '../../src/style.css')

/** Every theme shipped by the package, in source order. */
export const THEMES = [
  'light',
  'dark',
  'strawberry-light',
  'strawberry-dark',
  'ocean-light',
  'ocean-dark',
  'cyberpunk-light',
  'cyberpunk-dark',
  'coffee-light',
  'coffee-dark',
  'lavender-light',
  'lavender-dark',
  'pink-light',
  'pink-dark',
  'nature-light',
  'nature-dark',
  'izakaya-light',
  'izakaya-dark'
]

export const isDarkTheme = name => name.endsWith('dark')

/** The five semantic color families that must share an identical token set. */
export const FAMILIES = ['primary', 'success', 'warning', 'danger', 'neutral']

/** Structural (non-family) color tokens. */
export const STRUCTURAL = [
  'text',
  'text-secondary',
  'text-tertiary',
  'text-muted',
  'border',
  'border-light',
  'bg',
  'bg-card',
  'bg-alt',
  'bg-hover',
  'bg-overlay'
]

/**
 * Replace every comment with same-length spaces. Blanking rather than
 * deleting keeps all offsets valid, so callers can splice the original file
 * using the ranges this module reports.
 */
export function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n\r]/g, ' '))
}

/**
 * Split the stylesheet into `{ selector, body, start, end }` records.
 * Depth counting keeps nested at-rules (none today, but @media is likely
 * later) from terminating a block early.
 *
 * Offsets index into the ORIGINAL `css` string, not the blanked copy.
 */
export function readBlocks(css) {
  const blocks = []
  const scan = blankComments(css)
  const selectorRe = /(^|\})\s*([^{}@]+?)\s*\{/g
  let match

  while ((match = selectorRe.exec(scan)) !== null) {
    const selector = match[2].trim()
    if (!selector) continue

    const bodyStart = match.index + match[0].length
    let depth = 1
    let i = bodyStart
    while (i < scan.length && depth > 0) {
      if (scan[i] === '{') depth += 1
      else if (scan[i] === '}') depth -= 1
      i += 1
    }
    blocks.push({ selector, body: css.slice(bodyStart, i - 1), start: bodyStart, end: i - 1 })
    selectorRe.lastIndex = i - 1
  }
  return blocks
}

/** Which theme names a selector applies to. */
export function themesForSelector(selector) {
  const names = []
  for (const part of selector.split(',')) {
    const s = part.trim()
    if (s === ':root') names.push('light')
    const m = s.match(/^\[data-theme=['"]([^'"]+)['"]\]$/)
    if (m) names.push(m[1])
  }
  return [...new Set(names)]
}

/** Declarations in a block body, in source order, comments stripped. */
export function readDeclarations(body) {
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '')
  const decls = []
  // Custom-property values can contain commas/parens, so scan to the
  // top-level semicolon rather than splitting naively.
  const re = /(--[a-z0-9-]+)\s*:/gi
  let m
  while ((m = re.exec(clean)) !== null) {
    let i = re.lastIndex
    let depth = 0
    while (i < clean.length) {
      const c = clean[i]
      if (c === '(') depth += 1
      else if (c === ')') depth -= 1
      else if (c === ';' && depth === 0) break
      i += 1
    }
    decls.push({ name: m[1], value: clean.slice(re.lastIndex, i).trim() })
    re.lastIndex = i
  }
  return decls
}

/**
 * Build `{ [theme]: { [tokenName]: value } }` for every color token.
 * Only `--color-*` is returned; spacing/shadow/advanced tokens are ignored.
 */
export function parseThemes(css = readFileSync(STYLE_PATH, 'utf8')) {
  const out = Object.fromEntries(THEMES.map(t => [t, {}]))

  for (const block of readBlocks(css)) {
    const names = themesForSelector(block.selector)
    if (!names.length) continue
    for (const { name, value } of readDeclarations(block.body)) {
      if (!name.startsWith('--color-')) continue
      for (const theme of names) {
        if (out[theme]) out[theme][name] = value
      }
    }
  }
  return out
}

/** All distinct `--color-*` names across all themes, sorted. */
export function allTokenNames(themes) {
  const set = new Set()
  for (const tokens of Object.values(themes)) {
    for (const name of Object.keys(tokens)) set.add(name)
  }
  return [...set].sort()
}
