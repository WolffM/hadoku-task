#!/usr/bin/env node
/**
 * Regenerate the worker's build-time artifacts from the live route groups:
 *
 *   worker/src/route-manifest.ts  — the (method, path) → group table root routes by
 *   worker/src/openapi-spec.ts    — /task/api/openapi.json, served as static bytes
 *
 * Run after adding, removing or reordering a route, or changing any schema:
 *
 *   pnpm run gen:worker
 *
 * Both come from one run because a route change moves both. Their drift checks
 * (route-manifest-verify.ts, openapi-spec-verify.ts) fail until this is re-run.
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
const targets = {
  manifest: join(root, 'worker/src/route-manifest.ts'),
  spec: join(root, 'worker/src/openapi-spec.ts')
}
const outDir = mkdtempSync(join(tmpdir(), 'gen-worker-'))

try {
  const outfile = join(outDir, 'collect.mjs')
  await build({
    stdin: {
      contents: `import { collectRouteManifest, renderManifest } from './worker/test/lib/route-manifest'
import { renderSpec } from './worker/test/lib/openapi-spec'
import { buildOpenAPISpec } from './worker/src/openapi-builder'
process.stdout.write(JSON.stringify({
  manifest: renderManifest(await collectRouteManifest()),
  spec: renderSpec(await buildOpenAPISpec())
}))`,
      resolveDir: root,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error'
  })
  // The worker logs to stdout too; the payload is the last line.
  const out = execFileSync(process.execPath, [outfile], { encoding: 'utf8' })
  const sources = JSON.parse(out.trim().split('\n').pop())
  for (const [name, target] of Object.entries(targets)) {
    const options = { ...(await resolveConfig(target)), filepath: target }
    writeFileSync(target, await format(sources[name], options))
    console.log(`wrote ${target}`)
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
