/**
 * Verification harness for the task -> platform theme-prefs migration rules.
 *
 * This is a DATA migration: getting it wrong either loses someone's theme or
 * overwrites a choice they made in another app, and neither shows up as an
 * error — the app just quietly looks wrong. The rules are also easy to get
 * subtly backwards, so they are pinned here rather than trusted.
 */
import {
  planThemePrefsMigration,
  isEmptyPlan,
  type TaskThemeSource
} from '../prefs/themePrefsMigration'
import type { ThemePrefs } from '@wolffm/themes'

const DEFAULTS = {
  theme: 'light',
  themeMode: 'simple' as const,
  experimentalThemes: false
}

let failures = 0
let checks = 0

function check(name: string, actual: unknown, expected: unknown) {
  checks++
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`)
  }
}

function plan(shared: ThemePrefs, source: TaskThemeSource) {
  return planThemePrefsMigration(shared, source, DEFAULTS)
}

console.log('\n1. A real choice is carried across')
{
  const p = plan({}, { theme: 'coffee-dark', themeMode: 'advanced', experimentalThemes: true })
  check('theme + themeMode land on the device scope', p.device, {
    theme: 'coffee-dark',
    themeMode: 'advanced'
  })
  check('experimentalThemes lands on the user scope', p.user, { experimentalThemes: true })
}

console.log('\n2. The shared row always wins')
{
  const p = plan(
    { theme: 'ocean-light', themeMode: 'simple', experimentalThemes: false },
    { theme: 'coffee-dark', themeMode: 'advanced', experimentalThemes: true }
  )
  check('nothing is overwritten', isEmptyPlan(p), true)
}

console.log('\n3. Per-field, not all-or-nothing')
{
  const p = plan({ theme: 'ocean-light' }, { theme: 'coffee-dark', themeMode: 'advanced' })
  check('the absent field migrates', p.device, { themeMode: 'advanced' })
}

console.log('\n4. A default-valued field carries no information and is skipped')
{
  // read() applies defaults, so these are indistinguishable from "never set".
  const p = plan({}, { theme: 'light', themeMode: 'simple', experimentalThemes: false })
  check('nothing is written', isEmptyPlan(p), true)
}

console.log('\n5. A non-default value is migrated even when its siblings are default')
{
  const p = plan({}, { theme: 'light', themeMode: 'advanced', experimentalThemes: false })
  check('only themeMode moves', p.device, { themeMode: 'advanced' })
  check('user scope stays empty', p.user, {})
}

console.log('\n6. experimentalThemes=true is migrated (false is the default, true is a choice)')
{
  const p = plan({}, { experimentalThemes: true })
  check('true migrates', p.user, { experimentalThemes: true })
  const q = plan({ experimentalThemes: false }, { experimentalThemes: true })
  check('an explicit false in the shared row still wins', isEmptyPlan(q), true)
}

console.log('\n7. An empty source produces no writes')
{
  check('nothing to do', isEmptyPlan(plan({}, {})), true)
}

console.log('\n8. Idempotence: re-running against the migrated row is a no-op')
{
  const first = plan({}, { theme: 'coffee-dark', themeMode: 'advanced' })
  const migrated: ThemePrefs = { ...first.device }
  check(
    'second run writes nothing',
    isEmptyPlan(plan(migrated, { theme: 'coffee-dark', themeMode: 'advanced' })),
    true
  )
}

console.log(`\n${checks - failures} passed, ${failures} failed`)
// Throw rather than process.exit: the runner spawns this as a child process
// and asserts on the exit code, and an uncaught error gives a non-zero exit
// just the same — without needing @types/node, which this app does not carry
// and which would mean granting node globals to the whole app compilation.
if (failures > 0) throw new Error(`${failures} theme-prefs migration check(s) failed`)
