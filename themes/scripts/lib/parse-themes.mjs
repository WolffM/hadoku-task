/**
 * Node wrapper over tokens.mjs: the same parser, defaulting to the package's
 * own style.css on disk. Scripts import from here; anything that must also run
 * in a browser or a worker imports tokens.mjs / contract.mjs instead.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseThemes as parseThemeCss } from './tokens.mjs'

export * from './tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const STYLE_PATH = resolve(here, '../../src/style.css')

export function parseThemes(css = readFileSync(STYLE_PATH, 'utf8')) {
  return parseThemeCss(css)
}
