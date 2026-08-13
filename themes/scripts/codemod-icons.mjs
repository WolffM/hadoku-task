#!/usr/bin/env node
/**
 * Apply the mechanical half of the emoji -> icon migration.
 *
 *   node codemod-icons.mjs <path> [--write] [--quiet]
 *
 * Dry-run by default. `--write` edits in place.
 *
 * WHAT IT WILL TOUCH, and nothing else:
 *
 *   1. `"icon": "✅"` in JSON, and `icon: '✅'` in object literals — a pure string
 *      swap with no surrounding syntax to get wrong.
 *   2. A JSX text node that is ONLY an emoji  ->  <Icon name="check" />
 *   3. An emoji LEADING a JSX text run        ->  <Icon name="check" /> the rest
 *
 * WHAT IT DELIBERATELY LEAVES ALONE:
 *
 *   - `'🗑️ Delete Board'` — a string, not JSX. Turning it into an element changes
 *     the call site's type, and whether that call site even accepts a ReactNode is
 *     a question this script cannot answer. (In hadoku-task the equivalent change
 *     required widening ContextMenu's `label` from string to ReactNode first.)
 *   - String literals that are only an emoji, for the same reason: whether the
 *     value is rendered, logged, or compared is not knowable from the literal.
 *   - Any emoji with no entry in emoji-map.json.
 *
 * Those are reported, not guessed at. A codemod that is wrong 5% of the time
 * across twelve repos costs more review than it saves.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative, resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const roots = args.filter(a => !a.startsWith('--'))
const write = args.includes('--write')
const quiet = args.includes('--quiet')
if (!roots.length) {
  console.error('usage: codemod-icons.mjs <path> [--write]')
  process.exit(1)
}

const MAP = JSON.parse(readFileSync(resolve(here, '../src/icons/emoji-map.json'), 'utf8'))
const stripVs = s =>
  [...s]
    .filter(c => {
      const p = c.codePointAt(0)
      return p !== 0xfe0f && p !== 0xfe0e && !(p >= 0x1f3fb && p <= 0x1f3ff)
    })
    .join('')
const EMOJI_TO_ICON = new Map()
for (const [e, n] of Object.entries(MAP)) {
  if (!e.startsWith('$') && typeof n === 'string') EMOJI_TO_ICON.set(stripVs(e), n)
}
const nameFor = e => EMOJI_TO_ICON.get(stripVs(e))

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.astro', '.claude',
  'playwright-report', 'test-results', '.profiler', '.wrangler', 'coverage',
  'vendor', 'third_party', '__pycache__', '.venv'
])
const GENERATED_PATH =
  /(^|\/)(public\/(mf|v\d+)|\.output|\.vercel|storybook-static|bundle)(\/|$)|\.(min|bundle|generated)\.[a-z]+$/
const NON_UI_CODE_DIR =
  /(^|\/)(workers?|services?|server|scripts?|functions|cli|bin|migrations|e2e|tests?|__tests__)(\/|$)/
const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/
const MARKUP_EXT = new Set(['.tsx', '.jsx', '.astro', '.vue', '.svelte', '.html'])
const SCRIPT_EXT = new Set(['.ts', '.js', '.mjs', '.cjs'])

const EMOJI_RE =
  /(?:\p{RI}\p{RI}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*)*)/gu
const isEmoji = s => /\p{Extended_Pictographic}|\p{RI}\p{RI}|⃣/u.test(s)

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) yield* walk(full)
    else yield full
  }
}

const changed = []
const skipped = []
let filesTouched = 0

for (const root of roots) {
  const abs = resolve(root)
  if (!existsSync(abs)) {
    console.error(`codemod-icons: no such path: ${root}`)
    process.exit(1)
  }
  for (const file of walk(abs)) {
    const ext = extname(file)
    const isMarkup = MARKUP_EXT.has(ext)
    const isJson = ext === '.json'
    const isScript = SCRIPT_EXT.has(ext)
    if (!isMarkup && !isJson && !isScript) continue
    const posix = file.split(sep).join('/')
    if (GENERATED_PATH.test(posix) || TEST_FILE.test(posix)) continue
    if (!isMarkup && NON_UI_CODE_DIR.test(posix)) continue

    let st
    try {
      st = statSync(file)
    } catch {
      continue
    }
    if (st.size > 2 * 1024 * 1024) continue

    const original = readFileSync(file, 'utf8')
    if (!EMOJI_RE.test(original)) continue
    EMOJI_RE.lastIndex = 0

    const rel = relative(process.cwd(), file)
    const lines = original.split('\n')
    let jsxEdits = 0
    let fileEdits = 0

    const isNonUi = l =>
      /^(\/\/|\/\*|\*|#|<!--)/.test(l.trim()) ||
      /\b(console|logger|log)\s*\.\s*(log|warn|error|info|debug|table|trace|group)\b/.test(l) ||
      /process\.stdout|\bprint\(/.test(l)

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      if (isNonUi(line)) continue
      const before = line

      // (1) icon/glyph/emoji field values — pure string swap.
      line = line.replace(
        /((?:"(?:icon|glyph|emoji)"|(?<![\w$])(?:icon|glyph|emoji))\s*[:=]\s*)(['"])([^'"]*)\2/g,
        (m, head, q, val) => {
          const hits = [...val.matchAll(EMOJI_RE)].map(x => x[0]).filter(isEmoji)
          if (!hits.length || hits.join('') !== val.trim()) return m
          const name = nameFor(hits[0])
          if (!name) {
            skipped.push(`${rel}:${i + 1}  no mapping for ${val}`)
            return m
          }
          fileEdits++
          return `${head}${q}${name}${q}`
        }
      )

      // Only JSX files get an <Icon> element. An .astro/.vue/.svelte/.html file
      // has no such component in scope and the import block below cannot give it
      // one — emitting <Icon> there produces markup that does not compile. Astro
      // wants `set:html={getIconSvg('name')}` with a frontmatter import, which is
      // a different edit in a different part of the file, so it is reported
      // instead of guessed at.
      const canEmitJsx = ext === '.tsx' || ext === '.jsx'
      if (isMarkup && !canEmitJsx) {
        for (const m of line.matchAll(/(^|>|\{' '\}|\{" "\})(\s*)([^\s<>{}'"`]+)/g)) {
          const tok = m[3]
          const hits = [...tok.matchAll(EMOJI_RE)].map(x => x[0]).filter(isEmoji)
          if (hits.length && hits.join('') === tok && nameFor(tok)) {
            skipped.push(
              `${rel}:${i + 1}  ${tok} -> ${nameFor(tok)} (${ext} needs getIconSvg + a frontmatter import, by hand)`
            )
          }
        }
      }
      if (canEmitJsx) {
        // (2)/(3) an emoji opening a JSX text run: alone, or leading a label.
        line = line.replace(
          // `{` in the lookahead: `<div>👤 {value}</div>` is the commonest shape.
          /(^|>|\{' '\}|\{" "\})(\s*)([^\s<>{}'"`]+)(\s*)(?=$|<|[A-Za-z({])/g,
          (m, pre, ws, tok, post) => {
            const hits = [...tok.matchAll(EMOJI_RE)].map(x => x[0]).filter(isEmoji)
            if (!hits.length || hits.join('') !== tok) return m
            const name = nameFor(tok)
            if (!name) {
              skipped.push(`${rel}:${i + 1}  no mapping for ${tok}`)
              return m
            }
            jsxEdits++
            fileEdits++
            return `${pre}${ws}<Icon name="${name}" />${post}`
          }
        )
      }

      if (line !== before) {
        lines[i] = line
        changed.push(`${rel}:${i + 1}`)
      }
    }

    if (!fileEdits) continue
    let out = lines.join('\n')

    // Add the import only when JSX was actually produced.
    if (jsxEdits && (ext === '.tsx' || ext === '.jsx') && !/from '@wolffm\/themes'/.test(out)) {
      // Insert after the line that CLOSES the last import, not after the last
      // line that merely starts with `import`. A multi-line
      //     import {
      //       a, b
      //     } from 'x'
      // matches the naive test on its first line, and inserting there lands the
      // new import INSIDE the braces — which is exactly what it did to
      // pygmalion's BakeoffReview.tsx, and the build caught it.
      const src = out.split('\n')
      let lastImport = -1
      let inImport = false
      for (let idx = 0; idx < src.length; idx++) {
        const l = src[idx]
        if (!inImport && /^\s*import\b/.test(l)) {
          // Single-line import, or the head of a multi-line one.
          if (/\bfrom\s*['"][^'"]+['"]\s*;?\s*$/.test(l) || /^\s*import\s*['"]/.test(l)) lastImport = idx
          else inImport = true
        } else if (inImport && /\bfrom\s*['"][^'"]+['"]\s*;?\s*$/.test(l)) {
          lastImport = idx
          inImport = false
        }
      }
      if (lastImport >= 0) {
        src.splice(lastImport + 1, 0, "import { Icon } from '@wolffm/themes'")
        out = src.join('\n')
      } else {
        skipped.push(`${rel}  produced JSX but has no import block — add Icon import by hand`)
      }
    }

    filesTouched++
    if (write) writeFileSync(file, out)
  }
}

if (!quiet) {
  for (const c of changed) console.log(`  edit  ${c}`)
  if (skipped.length) {
    console.log('\n  left for a human:')
    for (const s of [...new Set(skipped)]) console.log(`    ${s}`)
  }
}
console.log(
  `\ncodemod-icons: ${changed.length} replacement(s) in ${filesTouched} file(s)` +
    `${skipped.length ? `, ${new Set(skipped).size} left for a human` : ''}` +
    `${write ? '' : '  [dry run — pass --write to apply]'}`
)
