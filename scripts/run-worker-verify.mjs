#!/usr/bin/env node
/**
 * Bundle + run the runtime-verification harnesses.
 *
 * Two directories, one runner:
 *   worker/test/  — boot the REAL worker (createTaskHandler) in-process
 *                   against an in-memory KV.
 *   src/test/     — app-side logic that is pure enough to assert directly
 *                   (currently the theme-prefs migration rules). This app has
 *                   no frontend unit-test harness, and standing one up for a
 *                   handful of pure functions would be more machinery than the
 *                   thing it tests; the bundling here already works for them.
 *
 * Both need bundling before node can execute them. Each runs in its own child
 * process: they assert by exit code, and one harness's failure must not mask
 * another's. Usage:
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
const testDirs = [join(root, 'worker/test'), join(root, 'src/test')]

/** Harnesses as {dir, file} so the two trees can hold same-named files. */
function discover() {
  return testDirs.flatMap(dir => {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return [] // directory may not exist yet
    }
    return entries
      .filter(f => f.endsWith('-verify.ts'))
      .sort()
      .map(file => ({ dir, file }))
  })
}

const requested = process.argv[2]
const harnesses = requested
  ? (() => {
      const want = requested.endsWith('.ts') ? requested : `${requested}.ts`
      const hit = discover().find(h => h.file === want)
      if (!hit) {
        console.error(`No harness named ${want} in ${testDirs.join(' or ')}`)
        process.exit(1)
      }
      return [hit]
    })()
  : discover()

if (harnesses.length === 0) {
  console.error(`No harnesses found in ${testDirs.join(' or ')}`)
  process.exit(1)
}

const outDir = mkdtempSync(join(tmpdir(), 'worker-verify-'))
const failures = []

try {
  for (const harness of harnesses) {
    console.log(`\n=== ${harness.file} ===`)
    const outfile = join(outDir, harness.file.replace(/\.ts$/, '.mjs'))
    await build({
      entryPoints: [join(harness.dir, harness.file)],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'error'
    })

    const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
    if (result.status !== 0) failures.push(harness.file)
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nAll verification harnesses passed.')
