/**
 * GET /task/api/themes/source + POST /task/api/themes/save — the hosted theme
 * editor's backend, which commits straight to main.
 *
 * A save skips the local pre-commit hook, so everything the hook would have
 * caught has to be caught here instead: the theme contract, the version bump,
 * and the bytes of the file (style.css is CRLF). Each is pinned below.
 *
 * GitHub is a stateful fake of the Git Data API — refs, commits, trees and the
 * raw contents endpoint — seeded with the REAL style.css and package.json files
 * from this checkout, so the assertions run against the actual bytes the
 * editor will be editing. `app.request()` does not route through global fetch,
 * so only api.github.com is intercepted.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTaskHandler } from '../src/index'
import { nextVersion } from '../src/routes/theme-editor'
import { checkThemes, parseThemes } from '@wolffm/themes/contract'
import { makeSqliteD1, type FakeD1 } from './lib/d1-sqlite'
import { FakeGitHub, type Files } from './lib/fake-github'

const EDGE_SECRET = 'test-edge-secret'
const MIGRATION = join(process.cwd(), 'worker/migrations')
const STYLE = 'themes/src/style.css'
const PKGS = ['themes/package.json', 'task-ui-components/package.json', 'package.json']

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}  ${detail}`)
  }
}
function section(t: string) {
  console.log(`\n${t}`)
}

/** A value the fixture guarantees; fail loudly, not with a TypeError, if it doesn't. */
function must<T>(v: T | undefined | null, what = 'fixture value'): T {
  if (v === undefined || v === null) throw new Error(`missing ${what}`)
  return v
}

function makeKV() {
  const store = new Map<string, string>()
  return {
    async get(key: string, type?: string) {
      const v = store.get(key)
      if (v === undefined) return null
      return type === 'json' ? JSON.parse(v) : v
    },
    async put(key: string, val: unknown) {
      store.set(key, typeof val === 'string' ? val : JSON.stringify(val))
    },
    async delete(key: string) {
      store.delete(key)
    }
  }
}

// ---------------------------------------------------------------------------
// Fake GitHub, seeded with this checkout's real files
// ---------------------------------------------------------------------------

const real: Files = new Map(
  [STYLE, ...PKGS].map(p => [p, readFileSync(join(process.cwd(), p), 'utf8')])
)
const gh = new FakeGitHub('WolffM/hadoku-task', real)
// The light theme's values as main has them. Fixtures that need "the value
// already there" read it here rather than restating a hex that goes stale the
// next time the theme is tuned.
const LIGHT = parseThemes(must(real.get(STYLE))).light
const resetRepo = () => gh.reset(real)

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (url.startsWith('https://api.github.com/')) {
    return gh.handle(url, init) ?? new Response('{}', { status: 404 })
  }
  return realFetch(input as string, init)
}) as typeof fetch

// ---------------------------------------------------------------------------
// Calling the worker
// ---------------------------------------------------------------------------

const d1: FakeD1 = makeSqliteD1(MIGRATION)
const app = createTaskHandler()

interface Json {
  [k: string]: unknown
  error?: string
  committed?: boolean
  commit?: string
  css?: string
  versions?: Record<string, string>
  changes?: { theme: string; token: string; from: string; to: string }[]
  problems?: string[]
  conflicts?: { theme: string; token: string }[]
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  opts: { tier?: string; token?: string | null; body?: unknown } = {}
): Promise<{ status: number; json: Json }> {
  const env: Record<string, unknown> = {
    TASKS_KV: makeKV(),
    DB: d1,
    EDGE_AUTH_SECRET: EDGE_SECRET,
    TASK_STORAGE: 'd1'
  }
  if (opts.token !== null) env.GITHUB_READ_TOKEN = opts.token ?? 'tok'
  const res = await app.request(
    `http://localhost/task/api${path}`,
    {
      method,
      headers: {
        'X-Edge-Auth': EDGE_SECRET,
        'X-Hadoku-Tier': opts.tier ?? 'service',
        'X-User-Key': 'svc-key',
        'X-User-Id': 'svc-uid',
        'X-User-Name': 'matt',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    },
    env
  )
  return { status: res.status, json: (await res.json()) as Json }
}

const save = (body: unknown, opts: { tier?: string; token?: string | null } = {}) =>
  call('POST', '/themes/save', { ...opts, body })

const version = (text: string) => (JSON.parse(text) as { version: string }).version
const filesAt = (c: string) => gh.commit(c).files

async function main_() {
  console.log('theme editor (GET /themes/source, POST /themes/save)')

  // -------------------------------------------------------------------
  section('1. Service tier and up — everyone else is refused before GitHub is asked')
  // -------------------------------------------------------------------
  resetRepo()
  const base = gh.main
  // The full ranked vocabulary, low to high — the gate is "rank ≥ service",
  // so a tier added here is tested on whichever side of it it ranks.
  const TIERS = ['public', 'friend', 'service', 'wife', 'admin'] as const
  for (const [rank, tier] of TIERS.entries()) {
    const allowed = rank >= TIERS.indexOf('service')
    gh.calls = []
    const src = await call('GET', '/themes/source', { tier })
    if (allowed) {
      check(`${tier}: source → 200`, src.status === 200, `status=${src.status}`)
      continue
    }
    check(`${tier}: source → 403`, src.status === 403, `status=${src.status}`)
    const sv = await save(
      { baseCommit: base, edits: { light: { '--color-bg': '#eeeeee' } } },
      { tier }
    )
    check(`${tier}: save → 403`, sv.status === 403, `status=${sv.status}`)
    check(`${tier}: GitHub never called`, gh.calls.length === 0, gh.calls.join(', '))
  }
  check('main untouched by refused saves', gh.main === base)

  // -------------------------------------------------------------------
  section('2. No GitHub credential bound → 503, not a crash')
  // -------------------------------------------------------------------
  let r = await call('GET', '/themes/source', { token: null })
  check('source → 503', r.status === 503, `status=${r.status}`)
  r = await save(
    { baseCommit: base, edits: { light: { '--color-bg': '#eeeeee' } } },
    { token: null }
  )
  check('save → 503', r.status === 503, `status=${r.status}`)

  // -------------------------------------------------------------------
  section('3. Source is the exact file on main')
  // -------------------------------------------------------------------
  r = await call('GET', '/themes/source')
  check('commit is the head of main', r.json.commit === gh.main, String(r.json.commit))
  check('css is byte-identical (CRLF kept)', r.json.css === real.get(STYLE))
  check(
    'versions are main’s',
    r.json.versions?.['@wolffm/themes'] === version(must(real.get('themes/package.json'))),
    JSON.stringify(r.json.versions)
  )

  // -------------------------------------------------------------------
  section('4. A good save commits to main under new versions')
  // -------------------------------------------------------------------
  resetRepo()
  const before = gh.main
  r = await save({
    baseCommit: before,
    edits: {
      light: { '--color-border': '#B8C2CF', '--color-success-bg': 'rgba(14, 165, 233, 0.08)' },
      'ocean-light': { '--color-border': '#9cc3dc' }
    },
    note: 'Visible borders'
  })
  check('200 committed', r.status === 200 && r.json.committed === true, JSON.stringify(r.json))
  check(
    'main moved to the returned commit',
    gh.main === r.json.commit,
    `${gh.main} vs ${r.json.commit}`
  )
  const made = gh.head()
  check('its parent is the old head', made.parent === before)
  const css = must(made.files.get(STYLE))
  const oldLines = must(real.get(STYLE)).split('\r\n')
  const newLines = css.split('\r\n')
  check('CRLF line endings preserved', css.includes('\r\n') && !/[^\r]\n/.test(css))
  check('same line count', oldLines.length === newLines.length)
  check(
    'exactly the 3 edited lines changed',
    oldLines.filter((l, i) => l !== newLines[i]).length === 3,
    String(oldLines.filter((l, i) => l !== newLines[i]).length)
  )
  const t = parseThemes(css)
  check(
    'light border written normalized',
    t.light['--color-border'] === '#b8c2cf',
    t.light['--color-border']
  )
  check('rgba kept translucent', t.light['--color-success-bg'] === 'rgba(14, 165, 233, 0.08)')
  check('other theme edited too', t['ocean-light']['--color-border'] === '#9cc3dc')
  check('the committed file passes the contract', checkThemes(t).length === 0)
  for (const p of PKGS) {
    const was = version(must(real.get(p)))
    const now = must(made.files.get(p))
    check(`${p}: ${was} → ${nextVersion(was)}`, version(now) === nextVersion(was), version(now))
    check(
      `${p}: nothing but the version changed`,
      now === must(real.get(p)).replace(`"version": "${was}"`, `"version": "${nextVersion(was)}"`)
    )
  }
  check(
    'response reports the new versions',
    r.json.versions?.['@wolffm/task'] === nextVersion(version(must(real.get('package.json')))),
    JSON.stringify(r.json.versions)
  )
  check(
    'commit message lists every change and who saved',
    /theme editor — light, ocean-light \(3 tokens\)/.test(made.message) &&
      made.message.includes(`light --color-border: ${LIGHT['--color-border']} → #b8c2cf`) &&
      made.message.includes('Visible borders') &&
      made.message.includes('by matt'),
    made.message
  )
  check(
    'not a feat: commit, so the version stays a patch bump',
    !/^feat/.test(made.message),
    made.message.split('\n')[0]
  )

  // -------------------------------------------------------------------
  section('5. Bad input is refused with a 400 before GitHub is asked')
  // -------------------------------------------------------------------
  for (const [what, edits] of [
    ['CSS smuggled in a value', { light: { '--color-bg': 'red; } body { display: none' } }],
    ['half-numeric rgba', { light: { '--color-bg': 'rgba(1;},2,3)' } }],
    ['out-of-range channel', { light: { '--color-bg': 'rgba(300, 0, 0, 1)' } }],
    ['unknown theme', { nope: { '--color-bg': '#ffffff' } }],
    ['non-color property', { light: { background: '#ffffff' } }]
  ] as const) {
    resetRepo()
    r = await save({ baseCommit: gh.main, edits })
    check(`${what} → 400`, r.status === 400, `status=${r.status} ${JSON.stringify(r.json)}`)
    check(`${what}: GitHub never called`, gh.calls.length === 0, gh.calls.join(', '))
  }
  resetRepo()
  const head0 = gh.main
  r = await save({ baseCommit: gh.main, edits: { light: { '--color-made-up': '#ffffff' } } })
  check('a token the theme does not declare → 400', r.status === 400, JSON.stringify(r.json))
  check('…and nothing committed', gh.main === head0)
  r = await save({ baseCommit: 'not-a-sha', edits: {} })
  check('malformed baseCommit → 400', r.status === 400, `status=${r.status}`)

  // -------------------------------------------------------------------
  section('6. The contract gates the commit')
  // -------------------------------------------------------------------
  resetRepo()
  const head1 = gh.main
  r = await save({ baseCommit: gh.main, edits: { light: { '--color-text': '#f8fafc' } } })
  check('unreadable text → 422', r.status === 422, `status=${r.status}`)
  check(
    'the problems name the failing pair',
    (r.json.problems ?? []).some(p => p.startsWith('light: text on bg')),
    JSON.stringify(r.json.problems)
  )
  check('nothing committed', gh.main === head1)
  check(
    'no commit object even created',
    !gh.calls.includes('POST /git/commits'),
    gh.calls.join(', ')
  )

  // Every AA pair still passes here — the page just goes back to near-white,
  // so the cards vanish into it. That drift is what the separation floor stops.
  resetRepo()
  const headWashed = gh.main
  r = await save({ baseCommit: gh.main, edits: { light: { '--color-bg': '#f8fafc' } } })
  check('cards washed into the page → 422', r.status === 422, `status=${r.status}`)
  check(
    'the problem names the surface step',
    (r.json.problems ?? []).some(p => p.startsWith('light: bg-card vs bg')),
    JSON.stringify(r.json.problems)
  )
  check('nothing committed for the washed-out page', gh.main === headWashed)

  // -------------------------------------------------------------------
  section('7. A save that changes nothing commits nothing')
  // -------------------------------------------------------------------
  resetRepo()
  const head2 = gh.main
  r = await save({
    baseCommit: gh.main,
    edits: { light: { '--color-bg': LIGHT['--color-bg'].toUpperCase() } }
  })
  check(
    '200, committed: false',
    r.status === 200 && r.json.committed === false,
    JSON.stringify(r.json)
  )
  check('main untouched', gh.main === head2)

  // -------------------------------------------------------------------
  section('8. main moved since the editor loaded')
  // -------------------------------------------------------------------
  resetRepo()
  let loaded = gh.main
  gh.pushOther(f =>
    f.set(
      STYLE,
      must(f.get(STYLE)).replace(
        `--color-border-light: ${LIGHT['--color-border-light']};`,
        '--color-border-light: #d9e0e8;'
      )
    )
  )
  const theirs = gh.main
  check(
    'their edit really landed (the fixture matches the file)',
    parseThemes(must(filesAt(theirs).get(STYLE))).light['--color-border-light'] === '#d9e0e8'
  )
  r = await save({ baseCommit: loaded, edits: { light: { '--color-border': '#b8c2cf' } } })
  check(
    'a DIFFERENT token changed → still saves',
    r.status === 200 && r.json.committed === true,
    JSON.stringify(r.json)
  )
  const merged = parseThemes(must(filesAt(gh.main).get(STYLE)))
  check(
    'their change survives',
    merged.light['--color-border-light'] === '#d9e0e8',
    merged.light['--color-border-light']
  )
  check('ours lands on top', merged.light['--color-border'] === '#b8c2cf')
  check('committed on top of their commit', gh.commit(gh.main).parent === theirs)

  resetRepo()
  loaded = gh.main
  gh.pushOther(f =>
    f.set(
      STYLE,
      must(f.get(STYLE)).replace(
        `--color-border: ${LIGHT['--color-border']};`,
        '--color-border: #c0c7ce;'
      )
    )
  )
  const theirs2 = gh.main
  check(
    'their edit really landed',
    parseThemes(must(filesAt(theirs2).get(STYLE))).light['--color-border'] === '#c0c7ce'
  )
  r = await save({ baseCommit: loaded, edits: { light: { '--color-border': '#b8c2cf' } } })
  check('the SAME token changed → 409', r.status === 409, `status=${r.status}`)
  check(
    'the conflict names it',
    r.json.conflicts?.[0]?.token === '--color-border' && r.json.conflicts?.[0]?.theme === 'light',
    JSON.stringify(r.json.conflicts)
  )
  check('their commit is left alone', gh.main === theirs2)

  // -------------------------------------------------------------------
  section('9. main moves DURING the save — retried from the new head')
  // -------------------------------------------------------------------
  resetRepo()
  gh.beforeMove = () =>
    gh.pushOther(f => f.set('README.md', 'a concurrent push'), 'concurrent push')
  r = await save({ baseCommit: gh.main, edits: { light: { '--color-border': '#b8c2cf' } } })
  check('still commits', r.status === 200 && r.json.committed === true, JSON.stringify(r.json))
  const final = gh.head()
  check(
    'on top of the concurrent push',
    gh.commit(must(final.parent ?? undefined)).message === 'concurrent push'
  )
  check('the concurrent push’s file survives', final.files.get('README.md') === 'a concurrent push')
  check(
    'versions still bumped exactly once',
    version(must(final.files.get('themes/package.json'))) ===
      nextVersion(version(must(real.get('themes/package.json'))))
  )

  resetRepo()
  gh.refuseNextMoves = 99
  const head3 = gh.main
  r = await save({ baseCommit: gh.main, edits: { light: { '--color-border': '#b8c2cf' } } })
  check('gives up after a bounded number of tries → 502', r.status === 502, `status=${r.status}`)
  check(
    'tried exactly 3 times',
    gh.calls.filter(c => c === 'PATCH /git/refs/heads/main').length === 3,
    String(gh.calls.filter(c => c === 'PATCH /git/refs/heads/main').length)
  )
  check('main untouched', gh.main === head3)

  // -------------------------------------------------------------------
  section('10. GitHub failing is a 502, not a 400')
  // -------------------------------------------------------------------
  resetRepo()
  gh.failHeadRead = true
  r = await save({ baseCommit: gh.main, edits: { light: { '--color-border': '#b8c2cf' } } })
  check('save → 502', r.status === 502, `status=${r.status}`)
  r = await call('GET', '/themes/source')
  check('source → 502', r.status === 502, `status=${r.status}`)

  // -------------------------------------------------------------------
  section('11. nextVersion matches scripts/version-bump.mjs')
  // -------------------------------------------------------------------
  // Run the hook's OWN nextVersion in a child process rather than importing it:
  // bundled into this harness, version-bump.mjs's "am I the CLI?" check sees
  // itself as argv[1] and runs main() — which exits the process mid-test.
  const samples = ['5.10.1', '5.10.19', '5.10.20', '1.0.0']
  const hook = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { nextVersion } from ${JSON.stringify(join(process.cwd(), 'scripts/version-bump.mjs'))}; console.log(JSON.stringify(${JSON.stringify(samples)}.map(nextVersion)))`
    ],
    { encoding: 'utf8' }
  )
  const hookNext = JSON.parse(hook.stdout) as string[]
  samples.forEach((v, i) =>
    check(`${v} → ${hookNext[i]}`, nextVersion(v) === hookNext[i], nextVersion(v))
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main_().catch(e => {
  console.error(e)
  process.exit(1)
})
