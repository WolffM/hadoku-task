#!/usr/bin/env node
// Bundles the editor's ES modules into a single IIFE for file:// compatibility.
// Run: node themes/dev/build.js
// Output: themes/dev/editor.bundle.js

import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function read(file) {
  return readFileSync(join(__dirname, file), 'utf-8')
}

// Strip import/export statements and collect raw code
function stripModuleSyntax(code) {
  return (
    code
      // Remove multi-line imports: import { ... } from '...'
      .replace(/^import\s+\{[\s\S]*?\}\s+from\s+['"].*?['"]\s*;?\s*$/gm, '')
      // Remove single-line imports
      .replace(/^import\s+.*$/gm, '')
      // Remove "export " prefix from declarations
      .replace(/^export\s+(function|const|let|var|class)\b/gm, '$1')
  )
}

const colorUtils = stripModuleSyntax(read('color-utils.js'))
const config = stripModuleSyntax(read('config.js'))
const editor = stripModuleSyntax(read('editor.js'))

const bundle = `// Auto-generated bundle — do not edit directly.
// Source: color-utils.js, config.js, editor.js
// Rebuild: node themes/dev/build.js
;(function() {
'use strict';

// ===== color-utils.js =====
${colorUtils}

// ===== config.js =====
${config}

// ===== editor.js =====
${editor}

})();
`

writeFileSync(join(__dirname, 'editor.bundle.js'), bundle, 'utf-8')
console.log('✓ Built themes/dev/editor.bundle.js')
