#!/usr/bin/env node
/**
 * Bundle + run worker/test/dev-server.ts — the real worker on :3001 (what vite
 * proxies /task/api to) plus a stub preset provider on :3002.
 *
 * Same esbuild-then-node shape as run-worker-verify.mjs: the worker imports
 * node-incompatible module graphs directly, so it needs bundling before node
 * can execute it.
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
const outfile = join(outDir, 'dev-server.mjs')

await build({
  entryPoints: [join(root, 'worker/test/dev-server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error'
})

const child = spawn(process.execPath, [outfile], { stdio: 'inherit', cwd: root })
const shutdown = () => {
  child.kill()
  rmSync(outDir, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
child.on('exit', code => {
  rmSync(outDir, { recursive: true, force: true })
  process.exit(code ?? 0)
})
