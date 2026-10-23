/**
 * Mutation test for themes/scripts/check-usage.mjs — the gate consumers run as
 * `lint:css`. Each case writes one markup file to a temp dir and runs the REAL
 * script over it, so what is pinned is the exit code and the finding a
 * consumer's CI would see.
 *
 * The markup cases exist because rule (5), accent-as-text, used to scan CSS
 * rule bodies only. `text-success` on a card is the same unvalidated pair as
 * `color: var(--color-success)` on a card, and hadoku_site had 49 of them while
 * `lint:css` reported OK (#97).
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(process.cwd(), 'themes/scripts/check-usage.mjs')

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

/** Run the gate over a single .tsx holding `source`. */
function lint(source: string) {
  const dir = mkdtempSync(join(tmpdir(), 'check-usage-'))
  try {
    writeFileSync(join(dir, 'fixture.tsx'), source)
    const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
    return { status: r.status, out: `${r.stdout}${r.stderr}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const fails = (name: string, source: string, kind: string, needle: string) => {
  const r = lint(source)
  check(`${name} → fails`, r.status === 1, `status=${r.status}\n${r.out}`)
  check(`${name} → reported as ${kind}`, r.out.includes(kind) && r.out.includes(needle), r.out)
}
const passes = (name: string, source: string) => {
  const r = lint(source)
  check(`${name} → passes`, r.status === 0, `status=${r.status}\n${r.out}`)
}

section('1. Accent as bare text in markup is flagged')
fails(
  'text-sm text-danger',
  `export const A = () => <p className="text-sm text-danger">x</p>`,
  'unvalidated pair',
  'text-danger is a fill colour'
)
fails(
  'hover:text-primary',
  `export const A = () => <a className="underline hover:text-primary">x</a>`,
  'unvalidated pair',
  'text-primary is a fill colour'
)
fails(
  'text-warning-dark',
  `export const A = () => <b className="text-warning-dark">x</b>`,
  'unvalidated pair',
  'text-warning-dark is a fill colour'
)
fails(
  'text-success on a card surface',
  `export const A = () => <td className="bg-bg-card text-success">x</td>`,
  'unvalidated pair',
  'text-success is a fill colour'
)
fails(
  'a fill in a separate clsx() argument does not excuse the unfilled case',
  `export const A = () => <b className={clsx('text-danger', on && 'bg-danger')}>x</b>`,
  'unvalidated pair',
  'text-danger is a fill colour'
)

section('2. The tint pair in markup is flagged')
fails(
  'bg-success-bg text-success',
  `export const A = () => <span className="bg-success-bg text-success">x</span>`,
  'its own tint',
  'use text-on-success-bg'
)

section('3. Sanctioned pairs pass')
passes(
  'bg-danger text-on-danger',
  `export const A = () => <b className="bg-danger text-on-danger">x</b>`
)
passes(
  'bg-success-bg text-on-success-bg',
  `export const A = () => <b className="bg-success-bg text-on-success-bg">x</b>`
)
passes('text-text', `export const A = () => <p className="text-sm text-text">x</p>`)

section('4. A waiver covers the next line only')
passes(
  'waived demo',
  `{/* check-usage-disable-next-line */}\nexport const A = () => <b className="text-warning">x</b>`
)
fails(
  'waiver does not reach two lines down',
  `{/* check-usage-disable-next-line */}\nconst x = 1\nexport const A = () => <b className="text-warning">x</b>`,
  'unvalidated pair',
  'text-warning is a fill colour'
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
