#!/usr/bin/env node
/**
 * Regenerate worker/src/route-manifest.ts from the live route groups.
 *
 * Run after adding, removing or reordering a route:
 *
 *   pnpm run gen:routes
 *
 * The groups are TypeScript that imports zod and @wolffm/task/api, so they are
 * bundled first (as run-worker-verify.mjs does) and evaluated in a child node.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'worker/src/route-manifest.ts')
const outDir = mkdtempSync(join(tmpdir(), 'route-manifest-'))

try {
  const outfile = join(outDir, 'collect.mjs')
  await build({
    stdin: {
      contents: `import { collectRouteManifest, renderManifest } from './worker/test/lib/route-manifest'
process.stdout.write(renderManifest(await collectRouteManifest()))`,
      resolveDir: root,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error'
  })
  const source = execFileSync(process.execPath, [outfile], { encoding: 'utf8' })
  const options = { ...(await resolveConfig(target)), filepath: target }
  writeFileSync(target, await format(source, options))
  console.log(`wrote ${target}`)
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
