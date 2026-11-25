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
 * Both need bundling before node can execute them. A `*-verify.mjs` harness is
 * plain node and runs as-is — for one that drives esbuild itself, which a
 * bundle of it could not (cold-start-verify.mjs). Each runs in its own child
 * process: they assert by exit code, and one harness's failure must not mask
 * another's.
 *
 * Every harness prints one `  ✓ name` or `  ✗ name  detail` line per check.
 * This reads those lines as the harness runs and writes them, one testcase per
 * check under one testsuite per harness, to reports/worker-verify.xml (JUnit),
 * which CI's report-tests step posts to the fleet test store. A harness that
 * exits non-zero also gets a failed `exits 0` testcase, so a crash before its
 * first ✗ is a red test rather than a missing one. A check's time is the time
 * since the harness's previous line of output (its first line excluded, so
 * process start and bundle load land on no check). Usage:
 *
 *   node scripts/run-worker-verify.mjs prefs-identity-verify
 *   node scripts/run-worker-verify.mjs            # runs every *-verify.ts
 */
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDirs = [join(root, 'worker/test'), join(root, 'src/test')]
/** Refuses every non-loopback fetch in a harness (verify-no-network.mjs). */
const NO_NETWORK = pathToFileURL(join(root, 'scripts/verify-no-network.mjs')).href

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
      .filter(f => f.endsWith('-verify.ts') || f.endsWith('-verify.mjs'))
      .sort()
      .map(file => ({ dir, file }))
  })
}

const requested = process.argv[2]
const harnesses = requested
  ? (() => {
      const want = /\.m?[jt]s$/.test(requested)
        ? [requested]
        : [`${requested}.ts`, `${requested}.mjs`]
      const hit = discover().find(h => want.includes(h.file))
      if (!hit) {
        console.error(`No harness named ${want.join(' or ')} in ${testDirs.join(' or ')}`)
        process.exit(1)
      }
      return [hit]
    })()
  : discover()

if (harnesses.length === 0) {
  console.error(`No harnesses found in ${testDirs.join(' or ')}`)
  process.exit(1)
}

const JUNIT = join(root, 'reports/worker-verify.xml')
const CHECK_LINE = /^  ([✓✗]) (.*?)(?:  (.*))?$/

/**
 * Run one bundled harness, forwarding its output as it arrives, and return its
 * exit status and the checks it printed.
 */
function runHarness(outfile) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--import', NO_NETWORK, outfile], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const checks = []
    let last
    const readLines = (stream, sink) => {
      let pending = ''
      const onLine = line => {
        const now = performance.now()
        const m = CHECK_LINE.exec(line)
        if (m) {
          checks.push({
            ok: m[1] === '✓',
            name: m[2],
            detail: m[3] ?? '',
            ms: last === undefined ? 0 : now - last
          })
        } else if (checks.length > 0 && !checks.at(-1).ok && /^ {4,}\S/.test(line)) {
          // A failed check's detail on the lines below it (expected/actual).
          checks.at(-1).detail += `${checks.at(-1).detail ? '\n' : ''}${line.trim()}`
        }
        last = now
      }
      stream.on('data', chunk => {
        sink.write(chunk)
        const lines = (pending + chunk).split('\n')
        pending = lines.pop()
        lines.forEach(onLine)
      })
      stream.on('end', () => pending && onLine(pending))
    }
    readLines(child.stdout, process.stdout)
    readLines(child.stderr, process.stderr)
    child.on('error', reject)
    child.on('close', (code, signal) => resolvePromise({ status: code ?? signal, checks }))
  })
}

const xml = s =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** One <testsuite> per harness; repeated check names get a ` (2)` suffix. */
function writeJunit(results) {
  const suites = results.map(({ file, status, checks, ms }) => {
    const seen = new Map()
    const cases = checks.map(c => {
      const n = (seen.get(c.name) ?? 0) + 1
      seen.set(c.name, n)
      return { ...c, name: n > 1 ? `${c.name} (${n})` : c.name }
    })
    if (status !== 0) {
      cases.push({ ok: false, name: 'exits 0', detail: `exited ${status}`, ms: 0 })
    }
    const failed = cases.filter(c => !c.ok).length
    const body = cases
      .map(c => {
        const open = `    <testcase classname="${xml(file)}" name="${xml(c.name)}" time="${(c.ms / 1000).toFixed(3)}"`
        return c.ok
          ? `${open}/>`
          : `${open}>\n      <failure message="${xml(c.detail.split('\n')[0] || 'check failed')}">${xml(c.detail)}</failure>\n    </testcase>`
      })
      .join('\n')
    return `  <testsuite name="${xml(file)}" tests="${cases.length}" failures="${failed}" time="${(ms / 1000).toFixed(3)}">\n${body}\n  </testsuite>`
  })
  mkdirSync(dirname(JUNIT), { recursive: true })
  writeFileSync(
    JUNIT,
    `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`
  )
}

const outDir = mkdtempSync(join(tmpdir(), 'worker-verify-'))
const failures = []
const results = []

try {
  for (const harness of harnesses) {
    console.log(`\n=== ${harness.file} ===`)
    let outfile = join(harness.dir, harness.file)
    if (harness.file.endsWith('.ts')) {
      outfile = join(outDir, harness.file.replace(/\.ts$/, '.mjs'))
      await build({
        entryPoints: [join(harness.dir, harness.file)],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile,
        logLevel: 'error'
      })
    }
    const started = performance.now()
    const { status, checks } = await runHarness(outfile)
    results.push({ file: harness.file, status, checks, ms: performance.now() - started })
    if (status !== 0) failures.push(harness.file)
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
  writeJunit(results)
}

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nAll verification harnesses passed.')
