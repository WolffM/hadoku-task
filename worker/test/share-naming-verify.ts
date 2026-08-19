/**
 * The repo → service-key naming convention, pinned directly.
 *
 * `repoServiceKeyName` is the only link between a board's checkout mapping and
 * an identity: the registry row carries no `repo` field, so the NAME is the
 * whole mechanism. Its own doc comment says this derivation is "the single place
 * that has to change" if the convention moves — which makes it worth asserting
 * on its own rather than only through the auto-share path.
 *
 * automation-verify already drives the two cases that bit in production
 * (`hadoku_site` spells the separator with an underscore, and a repo can arrive
 * capitalised), but it reaches them over HTTP, where a null return is
 * indistinguishable from a grant that was skipped for some other reason. The
 * edges — no repo at all, a trailing slash, a bare `hadoku-` — are not reachable
 * that way at all.
 *
 * Called directly: these are pure functions.
 */
import { repoServiceKeyName, automationRunnerName } from '../src/routes/share-naming'

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

function main() {
  console.log('share naming convention')

  // -------------------------------------------------------------------
  section('1. The convention itself')
  // -------------------------------------------------------------------
  const cases: Array<[string, string | null]> = [
    // The owner segment is dropped — a key is named for the repo, not the host.
    ['WolffM/tenhands', 'tenhands-service-key'],
    // A leading `hadoku-` is trimmed.
    ['WolffM/hadoku-aggregator', 'aggregator-service-key'],
    // ...and so is `hadoku_`, because one real repo spells it that way. A
    // hyphen-only trim would leave `hadoku_site-service-key` and match nothing.
    ['WolffM/hadoku_site', 'site-service-key'],
    // The trim is case-insensitive.
    ['WolffM/HADOKU-Aggregator', 'Aggregator-service-key'],
    // A bare repo name, with no owner, still resolves.
    ['tenhands', 'tenhands-service-key']
  ]
  for (const [repo, expected] of cases) {
    const got = repoServiceKeyName(repo)
    check(`${repo} → ${expected}`, got === expected, `got ${JSON.stringify(got)}`)
  }

  // -------------------------------------------------------------------
  section('2. Nothing to derive from returns null, never a garbage name')
  // -------------------------------------------------------------------
  // The caller treats null as "not attempted" and skips the registry lookup, so
  // a bad name here would become a share silently granted to nobody.
  for (const empty of [null, undefined, '', '   ', '/', '//']) {
    const got = repoServiceKeyName(empty as string | null | undefined)
    check(`${JSON.stringify(empty)} → null`, got === null, `got ${JSON.stringify(got)}`)
  }
  check(
    'a repo named exactly "hadoku-" trims to nothing → null',
    repoServiceKeyName('WolffM/hadoku-') === null,
    JSON.stringify(repoServiceKeyName('WolffM/hadoku-'))
  )

  // -------------------------------------------------------------------
  section('3. Shapes a stored repo can actually arrive in')
  // -------------------------------------------------------------------
  check(
    'a trailing slash is tolerated',
    repoServiceKeyName('WolffM/tenhands/') === 'tenhands-service-key',
    JSON.stringify(repoServiceKeyName('WolffM/tenhands/'))
  )
  check(
    'surrounding whitespace is trimmed',
    repoServiceKeyName('  WolffM/tenhands  ') === 'tenhands-service-key',
    JSON.stringify(repoServiceKeyName('  WolffM/tenhands  '))
  )
  check(
    'a name that merely contains "hadoku" is left alone',
    repoServiceKeyName('WolffM/my-hadoku-thing') === 'my-hadoku-thing-service-key',
    JSON.stringify(repoServiceKeyName('WolffM/my-hadoku-thing'))
  )

  // -------------------------------------------------------------------
  section('4. The runner name, and what overrides it')
  // -------------------------------------------------------------------
  check(
    'defaults to the tenhands service key',
    automationRunnerName({} as Parameters<typeof automationRunnerName>[0]) ===
      'tenhands-service-key'
  )
  check(
    'an env binding overrides it',
    automationRunnerName({ AUTOMATION_RUNNER_KEY_NAME: 'other-key' } as Parameters<
      typeof automationRunnerName
    >[0]) === 'other-key'
  )
  check(
    'the binding is trimmed',
    automationRunnerName({ AUTOMATION_RUNNER_KEY_NAME: '  other-key  ' } as Parameters<
      typeof automationRunnerName
    >[0]) === 'other-key'
  )
  check(
    'a blank binding falls back rather than resolving an empty name',
    automationRunnerName({ AUTOMATION_RUNNER_KEY_NAME: '   ' } as Parameters<
      typeof automationRunnerName
    >[0]) === 'tenhands-service-key'
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
