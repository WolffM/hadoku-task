#!/usr/bin/env node
/**
 * Build `@wolffm/themes/theme-bootstrap`: src/theme-bootstrap.js as a string.
 *
 *   dist/theme-bootstrap.js    export const THEME_BOOTSTRAP = "…"
 *   dist/theme-bootstrap.d.ts  export declare const THEME_BOOTSTRAP: string
 *
 * The raw file is also exported (`@wolffm/themes/theme-bootstrap.js`) for sync
 * scripts that read text. This module is for build tools that want an import
 * instead — Astro inlines it with `<script is:inline set:html={THEME_BOOTSTRAP} />`.
 * Generated at build time from the one source, so the two cannot differ.
 *
 * Run by `pnpm run build`, after tsc.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(pkg, 'src/theme-bootstrap.js'), 'utf8')
const dist = resolve(pkg, 'dist')

const doc =
  '/**\n' +
  ' * The hadoku pre-paint theme script, as text: @wolffm/themes/theme-bootstrap.js\n' +
  ' * verbatim. Inline it in <head> before anything paints; never load it as a\n' +
  ' * module or a bundled script, which runs after first paint.\n' +
  ' */\n'

mkdirSync(dist, { recursive: true })
writeFileSync(
  resolve(dist, 'theme-bootstrap.js'),
  `${doc}export const THEME_BOOTSTRAP = ${JSON.stringify(source)}\n`
)
writeFileSync(
  resolve(dist, 'theme-bootstrap.d.ts'),
  `${doc}export declare const THEME_BOOTSTRAP: string\n`
)
console.log('[build-theme-bootstrap] dist/theme-bootstrap.js')
