#!/usr/bin/env node
/**
 * Assert that task-ui-components' entry never STATICALLY reaches the code a
 * person only opens now and then.
 *
 * WHY THIS EXISTS
 * ---------------
 * hadoku_site bundles this package's whole entry into one vendor module that
 * every page of every app modulepreloads. Between 4.11 and 4.23 that module
 * grew 4.2x (6.9 -> 29.2 KB gz, #111): the avatar builder, the cosmetics
 * catalogue, linked accounts and the settings tab bodies were all static
 * imports. They are behind `import()` now, so the site's esbuild splitting
 * makes each its own chunk, fetched when opened. One static import anywhere on
 * the path from the entry puts it all back on every page, and nothing else
 * would notice: it builds, typechecks and passes every test.
 *
 * So this walks the BUILT output's static import graph from dist/index.js.
 *
 *   node scripts/verify-eager-graph.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'task-ui-components/dist')

/** Modules that must only ever be reached through import(). */
const LAZY = [
  'components/SettingsSiteTabs.js',
  'components/AvatarDialog.js',
  'components/AvatarBuilder.js',
  'components/AvatarPicker.js',
  'components/LinkedAccounts.js',
  'components/ServiceAccess.js',
  'components/Authenticator.js',
  'vendor/uqr/index.js',
  'vendor/wolffm/prefs-client/cosmetics.js',
  'vendor/wolffm/prefs-client/avatar.js'
]

/** Relative static imports and re-exports; `import(` is excluded by the shape. */
const STATIC = /(?:^|[\s;])(?:import|export)\s*(?:[\w*{}\s,$]+\s*from\s*)?["'](\.{1,2}\/[^"']+)["']/g

const entry = join(dist, 'index.js')
if (!existsSync(entry)) {
  console.error(`verify-eager-graph: ${relative(root, entry)} missing — build task-ui-components first.`)
  process.exit(1)
}

/** file -> the file that first imported it, for the failure's path. */
const via = new Map([[entry, null]])
const queue = [entry]
while (queue.length) {
  const file = queue.shift()
  for (const [, spec] of readFileSync(file, 'utf8').matchAll(STATIC)) {
    if (!spec.endsWith('.js')) continue
    const dep = join(dirname(file), spec)
    if (via.has(dep)) continue
    via.set(dep, file)
    queue.push(dep)
  }
}

const leaked = LAZY.map(f => join(dist, f)).filter(f => via.has(f))
if (leaked.length) {
  for (const f of leaked) {
    const chain = []
    for (let at = f; at; at = via.get(at)) chain.unshift(relative(dist, at))
    console.error(`verify-eager-graph: ${relative(dist, f)} is statically reachable: ${chain.join(' -> ')}`)
  }
  console.error('Load it with import() / React.lazy instead (#111).')
  process.exit(1)
}
console.log(
  `verify-eager-graph: OK — ${via.size} modules on the entry's static graph, none of the ${LAZY.length} lazy ones.`
)
