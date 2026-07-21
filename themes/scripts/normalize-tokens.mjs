#!/usr/bin/env node
/**
 * Rewrites themes/src/style.css to the canonical symmetric token set.
 *
 * Every theme block currently opens with exactly 38 contiguous `--color-*`
 * declarations followed by shadow/spacing/advanced tokens. This replaces that
 * leading span with the generated canonical set and leaves everything after
 * it byte-identical.
 *
 * Idempotent: running it twice produces the same file.
 *
 *   node themes/scripts/normalize-tokens.mjs [--dry]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import {
  STYLE_PATH,
  readBlocks,
  themesForSelector,
  readDeclarations,
  FAMILIES
} from './lib/parse-themes.mjs'
import { deriveTheme } from './lib/derive.mjs'

const dry = process.argv.includes('--dry')
const css = readFileSync(STYLE_PATH, 'utf8')
const eol = css.includes('\r\n') ? '\r\n' : '\n'

const FAMILY_LABEL = {
  primary: 'Primary',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
  neutral: 'Neutral'
}

/** Render the canonical color declarations for one theme, with section comments. */
function renderColors(tokens, indent) {
  const lines = []
  const push = s => lines.push(s ? indent + s : '')

  for (const f of FAMILIES) {
    push(`/* ${FAMILY_LABEL[f]} */`)
    push(`--color-${f}: ${tokens[`--color-${f}`]};`)
    push(`--color-${f}-dark: ${tokens[`--color-${f}-dark`]};`)
    push(`--color-${f}-bg: ${tokens[`--color-${f}-bg`]};`)
    push(`--color-${f}-hover: ${tokens[`--color-${f}-hover`]};`)
    push(`--color-on-${f}: ${tokens[`--color-on-${f}`]};`)
    push(`--color-on-${f}-bg: ${tokens[`--color-on-${f}-bg`]};`)
    push('')
  }

  push('/* Text */')
  for (const n of [
    '--color-text',
    '--color-text-secondary',
    '--color-text-tertiary',
    '--color-text-muted'
  ]) {
    push(`${n}: ${tokens[n]};`)
  }
  push('')
  push('/* Borders */')
  for (const n of ['--color-border', '--color-border-light']) push(`${n}: ${tokens[n]};`)
  push('')
  push('/* Backgrounds */')
  for (const n of [
    '--color-bg',
    '--color-bg-card',
    '--color-bg-alt',
    '--color-bg-hover',
    '--color-bg-overlay'
  ]) {
    push(`${n}: ${tokens[n]};`)
  }

  return lines.join(eol)
}

/* Collect edits first, apply back-to-front so earlier offsets stay valid. */
const edits = []
/* Values that changed for a reason other than a verbatim rename. */
const changed = []

for (const block of readBlocks(css)) {
  const names = themesForSelector(block.selector)
  if (!names.length) continue

  const decls = readDeclarations(block.body)
  const colorDecls = decls.filter(d => d.name.startsWith('--color-'))
  if (!colorDecls.length) continue

  const tokens = Object.fromEntries(decls.map(d => [d.name, d.value]))
  const notes = []
  const canonical = deriveTheme(tokens, notes)
  for (const n of notes) changed.push({ theme: names[0], ...n })

  // The color span covers whole lines: from the line holding the first
  // `--color-` declaration through the line closing the last one.
  const body = block.body
  const firstAt = body.indexOf('--color-')
  const lastName = colorDecls[colorDecls.length - 1].name
  const endInBody = body.indexOf(';', body.lastIndexOf(lastName)) + 1

  const lines = body.split(/\r?\n/)
  const offsetOfLine = []
  for (let i = 0, at = 0; i < lines.length; i += 1) {
    offsetOfLine.push(at)
    at += lines[i].length + eol.length
  }
  const lineOf = offset => {
    let n = 0
    while (n + 1 < offsetOfLine.length && offsetOfLine[n + 1] <= offset) n += 1
    return n
  }

  let firstLine = lineOf(firstAt)
  const lastLine = lineOf(endInBody - 1)

  // Section comments inside the span get regenerated, but the first one sits
  // on the line above it — pull it in so it isn't left orphaned.
  if (firstLine > 0 && /^\s*\/\*[^*]*\*\/\s*$/.test(lines[firstLine - 1])) firstLine -= 1

  const indent = lines[lineOf(firstAt)].match(/^[ \t]*/)[0]

  edits.push({
    start: block.start + offsetOfLine[firstLine],
    end: block.start + endInBody,
    text: renderColors(canonical, indent),
    theme: names.join('+')
  })
}

let out = css
for (const e of edits.sort((a, b) => b.start - a.start)) {
  out = out.slice(0, e.start) + e.text + out.slice(e.end)
}

console.log(`Rewrote ${edits.length} theme blocks.`)

if (changed.length) {
  console.log(
    `\n${changed.length} value(s) adjusted for contrast (everything else carried over verbatim):`
  )
  for (const c of changed) {
    const why =
      c.reason === 'contrast'
        ? 'authored value broke the on-<f> contract'
        : `dead-zone nudge, ΔL -${c.shift.toFixed(3)}`
    console.log(`  ${c.theme.padEnd(17)} ${c.token.padEnd(24)} ${c.from} → ${c.to}   (${why})`)
  }
}

if (dry) {
  console.log('--dry: not writing.')
} else {
  writeFileSync(STYLE_PATH, out)
  console.log(`Wrote ${STYLE_PATH}`)
}
