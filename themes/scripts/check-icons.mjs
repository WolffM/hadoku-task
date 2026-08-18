#!/usr/bin/env node
/**
 * Gate: icons come from the registry, and only from the registry.
 *
 * Two checks, mirroring the two ways the enforced set gets bypassed:
 *
 *   1. An icon name that is not in the registry. TS consumers get this from the
 *      `IconName` union, but the frontpage POCs are Astro and one is Qwik, and the
 *      catalogue itself is JSON — none of which typecheck against our union. A name
 *      typo'd in categories.json renders nothing, silently.
 *   2. A raw emoji used AS AN ICON. This is the rule the module exists to retire:
 *      platform emoji fonts render the same codepoint differently per OS, and there
 *      is no CSS fix. Only genuinely UI-facing positions are flagged — an emoji in a
 *      console.log, a code comment or a markdown doc is not an icon and is ignored,
 *      because a gate that fires on prose gets switched off.
 *
 *   node themes/scripts/check-icons.mjs [paths...]   (default: cwd)
 *     --emoji-only / --names-only   run just one of the checks
 *     --list                        print the registry and exit
 *
 * Exits non-zero on any finding.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative, resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadIconRegistry, MISSING_REGISTRY_MESSAGE } from './lib/icon-registry.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// Prefer the authored .ts (no build needed in this workspace), fall back to the built
// registry (the only tree a consumer install is guaranteed to carry). See lib/icon-registry.mjs.
const {
  iconNames: ICON_NAMES,
  emojiMap: EMOJI_MAP_RAW,
  ambiguous: AMBIGUOUS_RAW,
} = await loadIconRegistry()

if (!ICON_NAMES.size) {
  console.error(`check-icons: ${MISSING_REGISTRY_MESSAGE}`)
  process.exit(1)
}
if (process.argv.includes('--list')) {
  console.log([...ICON_NAMES].sort().join('\n'))
  process.exit(0)
}

const args = process.argv.slice(2)
const roots = args.filter(a => !a.startsWith('--'))
const targets = roots.length ? roots : [process.cwd()]
const emojiOnly = args.includes('--emoji-only')
const namesOnly = args.includes('--names-only')

// `.claude` holds git worktrees — separate checkouts that lint themselves.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.astro', '.claude',
  'playwright-report', 'test-results', '.profiler', '.wrangler', 'coverage',
  'vendor', 'third_party', '__pycache__', '.venv', 'venv',
  // Vendored third-party trees. hadoku-conjure carries ComfyUI extensions under
  // backend/custom_nodes and a Python env with site-packages; 14 of its findings
  // were somebody else's emoji in somebody else's code, which we neither can nor
  // should edit. `.venv` alone did not cover it — that env is `.venv-torch2110-backup`.
  'custom_nodes', 'site-packages', 'bower_components', 'Pods', '.tox', '.gradle',
  // Scraped/generated payload dumps. ArchiveBot writes Discord archives to
  // Output/<guild>/<channel>/archive_*.json, and every reaction in them is an
  // `"emoji":` field — 320 findings that are somebody's chat history, not icons.
  // A directory literally named Output holds output, never authored UI.
  'Output', 'output', 'outputs'
])

/** Virtualenv directories are named freely (`.venv-torch2110-backup`, `env39`). */
const VENV_DIR = /^\.?(venv|virtualenv|env)[-_.0-9a-z]*$/i

/**
 * Generated output. An emoji here is a copy of one in some source file, and
 * "fixing" it is worse than useless: the edit is erased by the next build while
 * the real occurrence stays put. hadoku_site alone carries ~76 of these in
 * `public/mf/*` (bundled micro-frontends) and `public/v3` — a quarter of the
 * ecosystem's raw findings, all of them phantoms.
 */
const GENERATED_PATH =
  /(^|\/)(public\/(mf|v\d+)|\.output|\.vercel|storybook-static|bundle)(\/|$)|\.(min|bundle|generated)\.[a-z]+$/

/**
 * Path segments that hold code with no DOM to render into. Applies to SCRIPT
 * files only — never to markup — because the distinction is "can this string
 * ever become an icon", and in a worker it cannot.
 *
 * This is what stops the gate demanding SVGs inside Discord webhook payloads.
 * monitoring-api posts `🚨 **runners** on …` to a channel; Discord renders emoji
 * and cannot render an inline SVG, so the emoji there is not a stand-in for an
 * icon, it IS the correct output. Same for CLI banners under `scripts/`.
 *
 * Deliberately NOT extension-blind: `personal-dataplatform/server/.../static/
 * index.html` is real UI that happens to live under `server/`, and it must keep
 * being checked. A `.html` file is a UI file wherever it sits.
 */
const NON_UI_CODE_DIR =
  /(^|\/)(workers?|services?|server|scripts?|functions|cli|bin|migrations|e2e|tests?|__tests__|output|outputs|formatters?)(\/|$)/

/**
 * Test files, matched by NAME rather than by folder. `spec` is deliberately NOT a
 * skipped directory: hadoku_site keeps its icon CATALOGUE in `spec/categories.json`,
 * the single most important file in this whole migration, and a `spec/` rule
 * silently excused all three copies of it.
 */
const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/

const MARKUP_EXT = new Set(['.tsx', '.jsx', '.astro', '.vue', '.svelte', '.html'])
const CONFIG_EXT = new Set(['.json'])
const SCRIPT_EXT = new Set(['.ts', '.js', '.mjs', '.cjs'])

// A pictographic run, including ZWJ sequences, skin tones and keycaps.
const EMOJI = /(?:\p{RI}\p{RI}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*)*)/gu

/**
 * In an ICON POSITION, any pictograph is an icon — emoji presentation or not.
 *
 * Requiring `\p{Emoji_Presentation}` (or a VS16) here was wrong and let real icons
 * through: `⚙` U+2699, `▶` U+25B6, `✏` U+270F and `⚠` U+26A0 are all
 * Extended_Pictographic with TEXT presentation by default, and this repo shipped a
 * bare `⚙` as its board-settings button. They render from the platform emoji font
 * just the same, which is the whole problem.
 *
 * This stays safe from false positives because it is only ever applied to icon
 * positions, and because the symbols that legitimately appear as bare text glyphs
 * — `✓` U+2713, `×` U+00D7, `↺` U+21BA, `→` U+2192 — are not Extended_Pictographic
 * at all, so they never reach this predicate.
 */
const isEmoji = seq => /\p{Extended_Pictographic}|\p{RI}\p{RI}|⃣/u.test(seq)

/**
 * CANONICAL emoji -> icon name, so a finding carries its own answer.
 *
 * A gate that says "use a name from the registry" leaves 217 decisions on the
 * floor, and twelve repos migrating independently would make them twelve
 * different ways. With the map, each finding is an edit rather than a decision —
 * and the mapping is settled once, here.
 */
const EMOJI_MAP = new Map()
if (EMOJI_MAP_RAW) {
  const unknown = []
  for (const [emoji, name] of Object.entries(EMOJI_MAP_RAW)) {
    if (emoji.startsWith('$')) continue
    if (!ICON_NAMES.has(name)) unknown.push(`${emoji} -> ${name}`)
    EMOJI_MAP.set(stripVs(emoji), name)
  }
  if (unknown.length) {
    console.error('check-icons: emoji-map.json points at icons that do not exist:')
    for (const u of unknown) console.error(`  ${u}`)
    process.exit(1)
  }
}

/** Variation selectors and skin tones are presentation, not identity. */
function stripVs(s) {
  return [...s].filter(c => {
    const p = c.codePointAt(0)
    return p !== 0xfe0f && p !== 0xfe0e && !(p >= 0x1f3fb && p <= 0x1f3ff)
  }).join('')
}

/**
 * Glyphs whose single mapping is only right in one context — see `$comment_ambiguous`
 * in emoji-map.json. Printing the suggestion bare presents one arm of a mirrored pair
 * as settled, which is how `◀ Pick A` / `Pick B ▶` shipped as a chevron facing a
 * filled triangle. The caveat rides along with the answer instead.
 */
const AMBIGUOUS = new Map(
  Object.entries(AMBIGUOUS_RAW ?? {}).map(([e, note]) => [stripVs(e), note])
)

/** The suggestion appended to a finding, when we know the answer. */
function suggest(raw) {
  const first = [...raw.matchAll(EMOJI)].map(m => m[0]).filter(isEmoji)[0]
  if (!first) return ''
  const key = stripVs(first)
  const name = EMOJI_MAP.get(key)
  if (!name) return ''
  const caveat = AMBIGUOUS.get(key)
  return `\n    → <Icon name="${name}" />   (getIconSvg('${name}'))` +
    (caveat ? `\n    ⚠ ${first} needs judgement: ${caveat}` : '')
}


function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue
    if (e.isDirectory() && VENV_DIR.test(e.name)) continue
    const full = join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) yield* walk(full)
    else yield full
  }
}

/**
 * Opt out one line at a time, same convention as check-usage:
 *
 *   {/* check-icons-disable-next-line *\/}
 *   <span>🎉</span>
 *
 * The case this exists for is an emoji that is genuinely emoji — an emoji picker,
 * a reaction the user chose, a Discord message composed in the browser. Those are
 * content, not iconography, and no registry entry can stand in for them.
 */
const DISABLE_NEXT = /(?:\/\*|\/\/|<!--|\{\s*\/\*)\s*check-icons-disable-next-line/

const findings = []
const seen = new Set()
/** One finding per file:line — the rules deliberately overlap, the report should not. */
const add = (file, line, rule, message) => {
  const key = `${file}:${line}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ file, line, rule, message })
}

/** An emoji here is decoration or data, not an icon. */
const isNonUiLine = line => {
  const l = line.trim()
  return (
    /^(\/\/|\/\*|\*|#|<!--)/.test(l) ||
    // `logger.*` matters as much as `console.*`: the hadoku ecosystem routes all
    // logging through @wolffm/logger, so console calls are the exception, not the rule.
    /\b(console|logger|log)\s*\.\s*(log|warn|error|info|debug|table|trace|group)\b/.test(l) ||
    /process\.stdout|\bprint\(/.test(l)
  )
}

/**
 * Where a `//` line comment starts, or the line length. `isNonUiLine` only catches
 * lines that BEGIN with a marker, so a TRAILING comment is still "code" to it —
 * and pygmalion's icons.tsx annotates its whole registry that way
 * (`export const WarnIcon = TriangleAlert // ⚠`). Prose about an icon is not an icon.
 * Quote-aware, so a `//` inside a string is not mistaken for a comment.
 */
const codeEndOf = line => {
  let quote = null
  for (let k = 0; k < line.length; k++) {
    const c = line[k]
    if (quote) {
      if (c === '\\') k++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '/' && line[k + 1] === '/') return k
  }
  return line.length
}

/** JSON keys whose value is rendered as an icon. */
const ICON_KEY = /"(icon|emoji|glyph|symbol)"\s*:\s*"([^"]*)"/g
/** The same idea in JS/TS object literals and JSX props. */
const ICON_PROP = /\b(icon|glyph|emoji)\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|\{?\s*['"]([^'"]*)['"])/g
/** Registry lookups whose name we can validate. */
const ICON_USE = /(?:getIconSvg\(\s*['"]([a-z0-9-]+)['"]|<Icon\b[^>]*?\bname\s*=\s*['"]([a-z0-9-]+)['"])/g

let scanned = 0
for (const target of targets) {
  const root = resolve(target)
  if (!existsSync(root)) {
    console.error(`check-icons: no such path: ${target}`)
    process.exit(1)
  }
  for (const file of walk(root)) {
    const ext = extname(file)
    const isMarkup = MARKUP_EXT.has(ext)
    const isConfig = CONFIG_EXT.has(ext)
    const isScript = SCRIPT_EXT.has(ext)
    const isCode = isMarkup || isScript
    if (!isMarkup && !isConfig && !isCode) continue

    const posix = file.split(sep).join('/')
    if (GENERATED_PATH.test(posix)) continue
    // Server/CLI code renders no DOM, so nothing in it is an icon. Markup is
    // exempt from this rule — a .html under server/ is still a page.
    if (!isMarkup && NON_UI_CODE_DIR.test(posix)) continue
    if (TEST_FILE.test(posix)) continue

    let st
    try {
      st = statSync(file)
    } catch {
      continue
    }
    if (st.size > 2 * 1024 * 1024) continue

    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    scanned++
    const rel = relative(process.cwd(), file)
    const lines = text.split('\n')
    const waived = new Set()
    lines.forEach((line, i) => {
      if (DISABLE_NEXT.test(line)) waived.add(i + 2)
    })

    // Track BLOCK comments across lines. `isNonUiLine` only sees a line that
    // STARTS with a marker, so the middle of a `{/* … */}` block reads as code —
    // and personal-dataplatform's VodBrowser has a comment explaining that it
    // used to render "👎 -3", which the gate then reported as an icon. Prose
    // about an emoji is not an emoji.
    let inBlockComment = false

    for (let i = 0; i < lines.length; i++) {
      if (waived.has(i + 1)) continue
      const opens = (lines[i].match(/\/\*/g) || []).length
      const closes = (lines[i].match(/\*\//g) || []).length
      const startedInside = inBlockComment
      if (opens > closes) inBlockComment = true
      else if (closes > opens) inBlockComment = false
      if (startedInside) continue
      const line = lines[i]
      const no = i + 1

      // ── check 2: raw emoji in an icon position ──────────────────────────────
      if (!namesOnly && !isNonUiLine(line)) {
        for (const re of [ICON_KEY, ICON_PROP]) {
          re.lastIndex = 0
          let m
          while ((m = re.exec(line)) !== null) {
            const value = m[2] ?? m[3] ?? m[4] ?? ''
            const hit = [...value.matchAll(EMOJI)].map(x => x[0]).filter(isEmoji)
            if (hit.length) {
              add(
                rel, no, 'raw-emoji-icon',
                `${m[1]}: "${value}" is a raw emoji. Platform emoji fonts render it ` +
                  `differently per OS. Use a name from the @wolffm/themes registry.` +
                  suggest(value)
              )
            }
          }
        }
        if (isMarkup || isCode) {
          // A string literal that is ONLY emoji — `'⏳'`, `icon={'📋'}`, ternary arms.
          // Nothing but an icon is ever written this way.
          // Cap raised from 24 to 200 for MARKUP only. At 24, tenhands'
          // `🔄 Refresh Workflows (${repos.length})` slipped through — a template
          // literal with interpolation is still a label with an icon on the front.
          // Scoped to markup on purpose: vibecop's src/output/*.ts formatters build
          // GitHub issue markdown, where an emoji is the correct output and an SVG
          // is impossible, exactly like the Discord payloads in monitoring-api.
          const maxLen = isMarkup ? 200 : 24
          const STR = new RegExp(`(['\"\`])([^'\"\`\\n]{1,${maxLen}})\\1`, 'g')
          for (const m of line.matchAll(STR)) {
            const raw = m[2].trim()
            if (!raw) continue
            const hit = [...raw.matchAll(EMOJI)].map(x => x[0]).filter(isEmoji)
            if (!hit.length) continue
            if (hit.join('') === raw) {
              add(
                rel, no, 'raw-emoji-icon',
                `"${raw}" is a bare emoji glyph. Use <Icon name="..."/> or getIconSvg().` + suggest(raw)
              )
            } else if (raw.startsWith(hit[0]) && /^\s/.test(raw.slice(hit[0].length))) {
              // `'🗑️ Delete Board'` — an emoji prefixing a label is an icon plus text.
              add(
                rel, no, 'raw-emoji-icon',
                `"${raw}" prefixes a label with a raw emoji. Render <Icon name="..."/> ` +
                  `beside the text instead.` + suggest(raw)
              )
            }
          }
        }
        // An emoji LEADING a text run — `📅 Scheduled on Discord:` — reads as an
        // icon with a label, and is how most of these are actually written. The
        // only-emoji rules below miss it entirely, which is why hadoku-meet
        // reported clean while shipping two of them.
        if (isMarkup) {
          // The lookahead includes `{`: `<div>👤 {pr.author}</div>` is the single
          // most common shape of "icon then value" in this codebase, and without
          // it the rule only fired when the label happened to start with a
          // letter. tenhands shipped four that way (👤 💬 📝 🕐) with the gate
          // reporting the repo clean.
          for (const m of line.matchAll(/(^|>|\{' '\}|\{" "\})(\s*)([^\s<>{}]+)\s+(?=[A-Za-z({])/g)) {
            const lead = m[3]
            const hit = [...lead.matchAll(EMOJI)].map(x => x[0]).filter(isEmoji)
            if (hit.length && hit.join('') === lead) {
              add(
                rel, no, 'raw-emoji-icon',
                `"${lead}" leads a text run as an icon. Render <Icon name="..."/> ` +
                  `beside the text instead.` + suggest(lead)
              )
            }
          }
        }

        // An emoji CLOSING a text run — `<b>{name}</b> wins ▶`. Every rule above
        // anchors on what comes BEFORE the glyph, so one sitting AFTER its label was
        // invisible: pygmalion reported clean across 268 files while shipping a raw
        // `▶` in BakeoffReview, and the codemod could not see it either.
        //
        // Anchored on whitespace before and `<` or end-of-line after, and stopped at
        // a trailing comment, which together keep it out of strings, attributes and
        // annotations.
        if (isMarkup) {
          const end = codeEndOf(line)
          for (const m of line.matchAll(/(\s)([^\s<>{}'"`]+)(\s*)(?=<|$)/g)) {
            if (m.index + m[1].length >= end) continue
            const tail = m[2]
            const hit = [...tail.matchAll(EMOJI)].map(x => x[0]).filter(isEmoji)
            if (hit.length && hit.join('') === tail) {
              add(
                rel, no, 'raw-emoji-icon',
                `"${tail}" closes a text run as an icon. Render <Icon name="..."/> ` +
                  `beside the text instead.` + suggest(tail)
              )
            }
          }
        }
        // Emoji standing alone as a JSX text node, on its own line or inline.
        if (isMarkup) {
          const bare = line.trim()
          const inline = [...line.matchAll(/>\s*([^<>{}\s]{1,24})\s*</g)].map(m => m[1].trim())
          for (const candidate of [bare, ...inline]) {
            if (!candidate) continue
            const hit = [...candidate.matchAll(EMOJI)].map(x => x[0]).filter(isEmoji)
            if (hit.length && hit.join('') === candidate) {
              add(
                rel, no, 'raw-emoji-icon',
                `"${candidate}" is rendered as a bare emoji glyph. Use <Icon name="..."/> ` +
                  `or getIconSvg() from @wolffm/themes.` + suggest(candidate)
              )
            }
          }
        }
      }

      // ── check 1: a name that is not in the registry ─────────────────────────
      if (!emojiOnly) {
        ICON_USE.lastIndex = 0
        let m
        while ((m = ICON_USE.exec(line)) !== null) {
          const name = m[1] ?? m[2]
          if (!ICON_NAMES.has(name)) {
            add(
              rel, no, 'unknown-icon',
              `"${name}" is not in the icon registry. Add it to ` +
                `themes/src/icons/sources.json and run \`pnpm run generate:icons\`.`
            )
          }
        }
      }
    }
  }
}

if (findings.length) {
  const byRule = findings.reduce((a, f) => ((a[f.rule] = (a[f.rule] || 0) + 1), a), {})
  console.error(`check-icons: FAILED — ${findings.length} finding(s) in ${scanned} files\n`)
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`)
    console.error(`    [${f.rule}] ${f.message}`)
  }
  console.error(
    `\n  ${Object.entries(byRule).map(([k, v]) => `${k}: ${v}`).join(', ')}` +
      `\n  Registry has ${ICON_NAMES.size} icons — list them with \`--list\`.`
  )
  process.exit(1)
}

console.log(`check-icons: OK — ${scanned} files, ${ICON_NAMES.size} icons in the registry`)
