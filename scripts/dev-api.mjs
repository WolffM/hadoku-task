#!/usr/bin/env node
/**
 * Bundle + run the local stack:
 *   :3001  the real task worker (what vite proxies /task/api to)
 *   :3002  a stub automation-preset provider
 *   :3003  the real prefs-api worker (@wolffm/e2e-harness/prefs-api)
 *
 * Same esbuild-then-node shape as run-worker-verify.mjs: the workers import
 * node-incompatible module graphs directly, so they need bundling before node
 * can execute them.
 *
 * prefs-api is hadoku_site's worker, published bundled in @wolffm/e2e-harness
 * from the same commit. It used to be imported from a sibling ../hadoku_site
 * checkout, which CI cannot have — hadoku_site is private and this repo holds
 * no token for it — so the whole stack now comes from this repo's own
 * node_modules, here and on the nightly e2e runner alike.
 *
 *   node scripts/dev-api.mjs        # foreground
 */
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'dev-api-'))

const entries = [
  { name: 'dev-server', src: join(root, 'worker/test/dev-server.ts') },
  { name: 'prefs-dev-server', src: join(root, 'worker/test/prefs-dev-server.ts') }
]

const built = []
for (const entry of entries) {
  const outfile = join(outDir, `${entry.name}.mjs`)
  await build({
    entryPoints: [entry.src],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error'
  })
  built.push(outfile)
}

const children = built.map(outfile => spawn(process.execPath, [outfile], { stdio: 'inherit', cwd: root }))

let shuttingDown = false
const cleanup = code => {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) c.kill()
  rmSync(outDir, { recursive: true, force: true })
  process.exit(code ?? 0)
}
process.on('SIGINT', () => cleanup(0))
process.on('SIGTERM', () => cleanup(0))
// Any server dying takes the stack down: a half-up stack is worse than none,
// because specs would silently test against whichever half survived.
for (const c of children) c.on('exit', code => cleanup(code))
