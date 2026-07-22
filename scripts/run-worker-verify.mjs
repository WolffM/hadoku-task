#!/usr/bin/env node
/**
 * Bundle + run the worker runtime-verification harnesses in worker/test/.
 *
 * The harnesses boot the REAL worker (createTaskHandler) in-process against an
 * in-memory KV, so they need bundling before node can execute them. Each runs in
 * its own child process: they assert by exit code, and one harness's failure
 * must not mask another's. Usage:
 *
 *   node scripts/run-worker-verify.mjs prefs-identity-verify
 *   node scripts/run-worker-verify.mjs            # runs every *-verify.ts
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = join(root, 'worker/test')

const requested = process.argv[2]
const harnesses = requested
  ? [requested.endsWith('.ts') ? requested : `${requested}.ts`]
  : readdirSync(testDir)
      .filter(f => f.endsWith('-verify.ts'))
      .sort()

if (harnesses.length === 0) {
  console.error(`No harnesses found in ${testDir}`)
  process.exit(1)
}

const outDir = mkdtempSync(join(tmpdir(), 'worker-verify-'))
const failures = []

try {
  for (const harness of harnesses) {
    console.log(`\n=== ${harness} ===`)
    const outfile = join(outDir, harness.replace(/\.ts$/, '.mjs'))
    await build({
      entryPoints: [join(testDir, harness)],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'error'
    })

    const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
    if (result.status !== 0) failures.push(harness)
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nAll worker verification harnesses passed.')
