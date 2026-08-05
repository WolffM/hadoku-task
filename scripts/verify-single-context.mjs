#!/usr/bin/env node
/**
 * Assert that HadokuThemeContext is created in exactly ONE place.
 *
 * WHY THIS EXISTS
 * ---------------
 * `createContext()` returns an object, and provider/consumer match on that
 * object's identity. Two copies of the defining module means two contexts: the
 * provider fills one, the consumer reads the other and gets null. On
 * 2026-08-05 that took down @wolffm/task, hadoku-aggregator and
 * hadoku-printtool, all with the same misleading error — "No <HadokuThemeRoot>
 * above this component" — while the provider was plainly mounted.
 *
 * The context now lives in @wolffm/themes alongside the provider that fills it,
 * which removes the cross-package split that made this reachable. But it does
 * not make it impossible: if task-ui-components ever bundles themes instead of
 * externalizing it, its dist gains a second createContext() and the bug is back
 * one level down. That regression is invisible — everything typechecks, builds
 * and passes tests; it only shows up in a browser, for every user at once.
 *
 * So this checks the built output, which is the only place the answer is real.
 *
 *   node scripts/verify-single-context.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Every .js file under a directory. */
function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : []
  })
}

/** Strip comments before matching. Both packages DISCUSS createContext() in
 *  their doc blocks — this file's own header does — and a checker that counts
 *  prose as a call site reports a failure that cannot be fixed. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

const CALL = /createContext\s*\(/

const problems = []

const themesFiles = walk(join(root, 'themes/dist'))
const uiFiles = walk(join(root, 'task-ui-components/dist'))

if (themesFiles.length === 0 || uiFiles.length === 0) {
  console.error('✗ dist not built — run `pnpm run build:packages` first')
  process.exit(1)
}

const themesSites = themesFiles.filter((f) => CALL.test(stripComments(readFileSync(f, 'utf8'))))
const uiSites = uiFiles.filter((f) => CALL.test(stripComments(readFileSync(f, 'utf8'))))

if (themesSites.length !== 1) {
  problems.push(
    `@wolffm/themes should create the context exactly once, found ${themesSites.length}: ` +
      themesSites.map((f) => relative(root, f)).join(', ')
  )
}

if (uiSites.length > 0) {
  problems.push(
    'task-ui-components must not create a React context — it consumes the one from ' +
      '@wolffm/themes. A createContext() here means themes got BUNDLED instead of ' +
      'externalized (see its vite.config.ts). Found in: ' +
      uiSites.map((f) => relative(root, f)).join(', ')
  )
}

// The consumer must reach themes by BARE specifier. A relative path means the
// bundler resolved through the workspace symlink and inlined a private copy.
const leaked = uiFiles.filter((f) =>
  /from\s*["'][^"']*themes\/dist\//.test(stripComments(readFileSync(f, 'utf8')))
)
if (leaked.length > 0) {
  problems.push(
    'task-ui-components imports themes by RELATIVE path, so a private copy is ' +
      'bundled rather than shared at runtime: ' +
      leaked.map((f) => relative(root, f)).join(', ')
  )
}

if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`)
  process.exit(1)
}

console.log(
  `verify-single-context: OK — one createContext() in themes, none in task-ui-components.`
)
