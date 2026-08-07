#!/usr/bin/env node
/**
 * Bundle + run the local stack:
 *   :3001  the real task worker (what vite proxies /task/api to)
 *   :3002  a stub automation-preset provider
 *   :3003  the real prefs-api worker, when ../hadoku_site is checked out
 *
 * Same esbuild-then-node shape as run-worker-verify.mjs: the workers import
 * node-incompatible module graphs directly, so they need bundling before node
 * can execute them.
 *
 * :3003 is CONDITIONAL. prefs-api lives in the sibling hadoku_site repo and is
 * imported across the repo boundary on purpose — a copy vendored here would be
 * a mock that drifts, and drift is what we are removing. When the sibling is
 * absent (CI, a fresh clone) the prefs server is skipped with a clear message
 * and the specs that need it skip themselves, exactly like the ones that need
 * :3001.
 *
 *   node scripts/dev-api.mjs        # foreground
 */
import { build } from 'esbuild'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'dev-api-'))

/**
 * hadoku_site sits NEXT TO the main checkout. `root` is not a reliable base for
 * that: inside a git worktree it is `<main>/.claude/worktrees/<name>`, three
 * levels too deep, so a relative hop would silently miss the sibling and every
 * prefs spec would skip with the repo sitting right there. --git-common-dir
 * always points at the main checkout's .git, from any worktree.
 */
function mainCheckoutRoot() {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    return dirname(commonDir)
  } catch {
    return root
  }
}

const siblingRoot = resolve(mainCheckoutRoot(), '..', 'hadoku_site')
const PREFS_API_ENTRY = join(siblingRoot, 'workers/prefs-api/src/index.ts')
const PREFS_MIGRATIONS = join(siblingRoot, 'workers/prefs-api/migrations')
const prefsAvailable = existsSync(PREFS_API_ENTRY) && existsSync(PREFS_MIGRATIONS)

const entries = [{ name: 'dev-server', src: join(root, 'worker/test/dev-server.ts') }]
if (prefsAvailable) {
  entries.push({ name: 'prefs-dev-server', src: join(root, 'worker/test/prefs-dev-server.ts') })
} else {
  console.warn(
    `[prefs]    SKIPPED — no prefs-api at ${PREFS_API_ENTRY}\n` +
      '           Prefs-backed specs will skip. Clone WolffM/hadoku_site alongside\n' +
      '           this repo to run them against the real prefs worker.'
  )
}

const built = []
for (const entry of entries) {
  const outfile = join(outDir, `${entry.name}.mjs`)
  await build({
    entryPoints: [entry.src],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    // The cross-repo seam, resolved here rather than written into the source as
    // a relative path that only holds for a non-worktree checkout.
    alias: { 'hadoku-site-prefs-api': PREFS_API_ENTRY },
    logLevel: 'error'
  })
  built.push(outfile)
}

const children = built.map(outfile =>
  spawn(process.execPath, [outfile], {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, DEV_PREFS_MIGRATIONS: PREFS_MIGRATIONS }
  })
)

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
