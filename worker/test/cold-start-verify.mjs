/**
 * Cold-start verification (issue #101): a cold request evaluates only the
 * modules it needs.
 *
 * Production runs `export default createTaskHandler()`, so every fresh isolate
 * pays for whatever root imports before it answers anything. When every group
 * was mounted eagerly that was all ~650 zod schemas — tens of ms of CPU on the
 * quiet-hour requests that are most of task-api's traffic. Root now loads each
 * route group on first use (route-groups.ts); this pins that it stays that way:
 *
 *   - /health evaluates no route group and no schema file
 *   - a core UI route never evaluates schemas-agent.ts
 *   - an agent route does (the positive control: the tagging below works)
 *
 * The worker is bundled the way hadoku_site's wrangler bundles it (one ESM
 * file, workerd conditions, unsplit), with an esbuild plugin that tags each
 * worker/src module so it records itself when evaluated — no marker lives in
 * the source. Each scenario runs in a FRESH node process, which is what makes
 * it cold. Timings are printed for comparison, not asserted: CI runners are
 * too noisy for a threshold to mean anything.
 *
 * Plain node (not bundled by the runner) because it drives esbuild itself.
 * Run: pnpm run test:worker
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const srcDir = join(root, 'worker/src')
const outDir = mkdtempSync(join(tmpdir(), 'cold-start-'))
const SAMPLES = 5

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}  ${detail}`)
  }
}

/** Prepend a self-report to every worker/src module. ESM hoists the imports,
 * so it runs once the module's dependencies are in — i.e. when it evaluates. */
const tagModules = {
  name: 'tag-modules',
  setup(b) {
    b.onLoad({ filter: /\/worker\/src\/.*\.ts$/ }, args => {
      const rel = relative(srcDir, args.path)
      const tag = `globalThis.__evaluated?.push(${JSON.stringify(rel)});\n`
      return { contents: tag + readFileSync(args.path, 'utf8'), loader: 'ts' }
    })
  }
}

const EDGE_SECRET = 'test-edge-secret'
const friend = {
  'X-Edge-Auth': EDGE_SECRET,
  'X-Hadoku-Tier': 'friend',
  'X-User-Key': 'key-for-friend',
  'X-User-Id': 'uuid-friend',
  'Content-Type': 'application/json'
}

// [label, group it should load, method, path, body?]
const CORE = [
  ['validate-key', 'routes/misc.ts', 'POST', '/task/api/validate-key'],
  ['preferences', 'routes/preferences.ts', 'GET', '/task/api/preferences'],
  ['boards', 'routes/boards.ts', 'GET', '/task/api/boards'],
  ['tasks', 'routes/tasks.ts', 'GET', '/task/api/tasks'],
  ['shares', 'routes/shares.ts', 'GET', '/task/api/boards/main/shares'],
  ['calendar', 'routes/calendar.ts', 'GET', '/task/api/boards/main/calendar'],
  ['tags-batch', 'routes/tags-batch.ts', 'PATCH', '/task/api/batch-tag', {}]
]

try {
  const worker = join(outDir, 'worker.mjs')
  await build({
    stdin: {
      contents: `export { createTaskHandler } from './worker/src/index'`,
      resolveDir: root,
      loader: 'ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['browser', 'module', 'main'],
    external: ['cloudflare:*', 'node:*'],
    minify: true,
    plugins: [tagModules],
    outfile: worker,
    logLevel: 'error'
  })

  // The bindings a real request needs, built OUTSIDE the timed import.
  const fixtures = join(outDir, 'fixtures.mjs')
  await build({
    stdin: {
      contents: `import { makeSqliteD1 } from './worker/test/lib/d1-sqlite'
export function makeEnv() {
  const store = new Map()
  const kv = {
    async get(k, type) { const v = store.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v },
    async put(k, v) { store.set(k, typeof v === 'string' ? v : JSON.stringify(v)) },
    async delete(k) { store.delete(k) }
  }
  return { TASKS_KV: kv, DB: makeSqliteD1(${JSON.stringify(join(root, 'worker/migrations'))}), EDGE_AUTH_SECRET: ${JSON.stringify(EDGE_SECRET)} }
}`,
      resolveDir: root,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: fixtures,
    logLevel: 'error'
  })

  const probe = join(outDir, 'probe.mjs')
  writeFileSync(
    probe,
    `const [method, path, headers, body] = JSON.parse(process.argv[2])
const { makeEnv } = await import(${JSON.stringify(pathToFileURL(fixtures).href)})
const env = makeEnv()
// Node builds its fetch globals (undici) on first touch — ~25 ms that workerd,
// where they are native, never pays. Take it outside the timed region.
await new Response(new Request('http://localhost', { method: 'POST', body: '{}' }).body).text()
globalThis.__evaluated = []
const t0 = performance.now()
const { createTaskHandler } = await import(${JSON.stringify(pathToFileURL(worker).href)})
const app = createTaskHandler()
const t1 = performance.now()
const init = { method, headers }
if (body != null) init.body = JSON.stringify(body)
const res = await app.request('http://localhost' + path, init, env)
await res.arrayBuffer()
const t2 = performance.now()
process.stdout.write(JSON.stringify({ status: res.status, evaluated: globalThis.__evaluated, loadMs: t1 - t0, requestMs: t2 - t1 }))
`
  )

  const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  /** SAMPLES fresh processes; module set from the first, timings as medians. */
  function cold(method, path, headers = {}, body) {
    const runs = []
    for (let i = 0; i < SAMPLES; i++) {
      const r = spawnSync(
        process.execPath,
        [probe, JSON.stringify([method, path, headers, body])],
        {
          encoding: 'utf8'
        }
      )
      if (r.status !== 0) throw new Error(`probe failed for ${method} ${path}:\n${r.stderr}`)
      // The worker logs to stdout too; the probe's report is the last line.
      runs.push(JSON.parse(r.stdout.trim().split('\n').pop()))
    }
    const load = median(runs.map(r => r.loadMs))
    const total = median(runs.map(r => r.loadMs + r.requestMs))
    return { ...runs[0], load, total }
  }
  const fmt = r => `load ${r.load.toFixed(1)} ms, load+first request ${r.total.toFixed(1)} ms`
  const groupsIn = ev => ev.filter(m => m.startsWith('routes/') && m !== 'routes/health.ts')
  const schemasIn = ev => ev.filter(m => /^schemas/.test(m))

  console.log('\n1. A cold /health loads no route group and no schema')
  {
    const r = cold('GET', '/task/api/health')
    console.log(`    ${fmt(r)}`)
    check('/health is 200', r.status === 200, `status=${r.status}`)
    check(
      'no route group evaluated',
      groupsIn(r.evaluated).length === 0,
      groupsIn(r.evaluated).join(', ')
    )
    check(
      'no schema file evaluated',
      schemasIn(r.evaluated).length === 0,
      schemasIn(r.evaluated).join(', ')
    )
    check('MCP handler not evaluated', !r.evaluated.some(m => m.startsWith('mcp/')))
  }

  console.log('\n2. A cold core UI route never loads schemas-agent.ts')
  for (const [label, group, method, path, body] of CORE) {
    const r = cold(method, path, friend, body)
    console.log(`    ${label}: ${r.status}, ${fmt(r)}`)
    check(`${label}: loads ${group}`, r.evaluated.includes(group), groupsIn(r.evaluated).join(', '))
    check(
      `${label}: schemas-agent.ts not evaluated`,
      !r.evaluated.includes('schemas-agent.ts'),
      `via: ${groupsIn(r.evaluated).join(', ')}`
    )
    check(
      `${label}: no other group evaluated`,
      groupsIn(r.evaluated).every(m => m === group || !CORE.some(c => c[1] === m)),
      groupsIn(r.evaluated).join(', ')
    )
  }

  console.log('\n3. Positive control: an agent route does load it')
  {
    const r = cold('GET', '/task/api/changes', friend)
    console.log(`    changes: ${r.status}, ${fmt(r)}`)
    check('agent route loads routes/agent.ts', r.evaluated.includes('routes/agent.ts'))
    check('agent route loads schemas-agent.ts', r.evaluated.includes('schemas-agent.ts'))
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
