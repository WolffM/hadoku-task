/**
 * Verification harness for the "Automate open items" rules (§5.6).
 *
 * Two rules carry the whole feature and neither fails loudly when it's wrong:
 *
 *   - DEDUP decides what the button offers. Too strict and a person can never
 *     automate an item; too loose and every board load creates duplicate tasks
 *     of work already in flight. It is also the ONLY thing making the click
 *     idempotent — there is no lock, no lane, no metadata to fall back on.
 *   - NOTES are the entire brief the runner acts on. A PR whose branch is
 *     missing from the instruction is a run that checks out nothing.
 *
 * The parser bug this guards against is worth naming: task titles here contain
 * `#42`, and the app's own typed-input parser reads a trailing `#word` as a tag.
 * Anything that routes these titles through it files "Address" under a lane
 * called "42" — so `parseTaskInput` is asserted to be the wrong tool here.
 */
import {
  actionableKey,
  actionableNotes,
  automateLabel,
  newActionableItems,
  taskAddressKey
} from '../domain/utils/actionable'
import { parseTaskInput } from '../domain/utils/tags'
import type { ActionableItem, Task } from '../domain/types'

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

function issue(number: number, extra: Partial<ActionableItem> = {}): ActionableItem {
  return {
    kind: 'issue',
    number,
    title: `Issue ${number}`,
    url: `https://github.com/o/r/issues/${number}`,
    suggestedTitle: `Address #${number}`,
    bodySnippet: `Something is wrong in ${number}.`,
    ...extra
  }
}

function pr(number: number, extra: Partial<ActionableItem> = {}): ActionableItem {
  return {
    kind: 'pr',
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    suggestedTitle: `Address PR #${number}`,
    headRef: `feature-${number}`,
    ...extra
  }
}

function task(title: string, extra: Partial<Task> = {}): Task {
  return {
    id: `t-${title}`,
    title,
    createdAt: '2026-08-13T00:00:00.000Z',
    state: 'Active',
    ...extra
  } as Task
}

const titles = (items: ActionableItem[]) => items.map(i => i.suggestedTitle)

console.log('\n1. An item with a task is never offered again')
{
  const items = [issue(42), pr(17), issue(51)]
  check('nothing on the board → everything is new', titles(newActionableItems(items, [])), [
    'Address #42',
    'Address PR #17',
    'Address #51'
  ])
  check(
    'the covered ones drop out',
    titles(newActionableItems(items, [task('Address #42'), task('Address PR #17')])),
    ['Address #51']
  )
  check(
    'an issue and a PR of the SAME number are distinct',
    titles(newActionableItems([issue(17), pr(17)], [task('Address #17')])),
    ['Address PR #17']
  )
}

console.log('\n2. Dedup survives the ways a title drifts')
{
  const items = [issue(42), pr(17)]
  check(
    'case and padding are ignored',
    titles(newActionableItems(items, [task('  address #42  '), task('ADDRESS PR #17')])),
    []
  )
  check(
    'a task someone annotated still covers its item',
    titles(newActionableItems(items, [task('Address #42 (blocked on infra)')])),
    ['Address PR #17']
  )
  check(
    'a COMPLETED task still covers it — the work is done, not pending',
    titles(newActionableItems(items, [task('Address #42', { state: 'Completed' })])),
    ['Address PR #17']
  )
  check(
    'a provider-suggested title that is not "Address #N" still dedups by exact title',
    titles(
      newActionableItems(
        [issue(42, { suggestedTitle: 'Fix the board-switch filter bug' })],
        [task('Fix the board-switch filter bug')]
      )
    ),
    []
  )
}

console.log('\n3. Dedup does not swallow unrelated work')
{
  const items = [issue(42)]
  check(
    'a different number does not cover it',
    titles(newActionableItems(items, [task('Address #4'), task('Address #420')])),
    ['Address #42']
  )
  check(
    'a task that merely mentions the issue does not cover it',
    titles(newActionableItems(items, [task('Follow up on Address #42 later')])),
    ['Address #42']
  )
  check(
    'untitled tasks are ignored, not matched',
    titles(newActionableItems(items, [task('  ')])),
    ['Address #42']
  )
}

console.log('\n4. Title keys')
{
  check('issue key', taskAddressKey('Address #42'), 'issue:42')
  check('PR key', taskAddressKey('Address PR #17'), 'pr:17')
  check('not one of ours', taskAddressKey('Buy milk'), null)
  check('a bare hash is not an address', taskAddressKey('#42'), null)
  check('item key matches the title key', actionableKey(issue(42)), taskAddressKey('Address #42'))
}

console.log('\n5. Notes are the runner’s whole brief')
{
  const n = actionableNotes(issue(42))
  check('links the item', n.includes('https://github.com/o/r/issues/42'), true)
  check('names it', n.includes('Issue 42'), true)
  check('carries the snippet', n.includes('Something is wrong in 42.'), true)
  check(
    'an issue says reproduce-fix-PR',
    n.endsWith('Reproduce if needed, fix it, and open a PR.'),
    true
  )

  const p = actionableNotes(pr(17))
  check(
    'a PR says check out the branch',
    p.endsWith('Check out branch feature-17 and address the outstanding review/CI feedback.'),
    true
  )
  check(
    'a PR with no head ref never says "branch undefined"',
    actionableNotes(pr(17, { headRef: undefined })).endsWith(
      'Check out the branch for PR #17 and address the outstanding review/CI feedback.'
    ),
    true
  )
  check(
    'a missing snippet leaves no gaping blank block',
    actionableNotes(issue(9, { bodySnippet: undefined })).includes('\n\n\n'),
    false
  )
}

console.log('\n6. These titles MUST NOT go through the typed-input parser')
{
  // Not a hypothetical: `addTask` runs this, which is why the button creates
  // tasks through addTasksVerbatim instead.
  check('the parser mangles an issue title', parseTaskInput('Address #42'), {
    title: 'Address',
    tag: '42'
  })
  check('…and a PR title', parseTaskInput('Address PR #17'), { title: 'Address PR', tag: '17' })
}

console.log('\n7. The label counts honestly')
{
  check('one', automateLabel(1), 'Automate 1 open item')
  check('several', automateLabel(3), 'Automate 3 open items')
}

console.log(`\n${checks - failures}/${checks} checks passed`)
// Throw rather than process.exit: the runner spawns this as a child process and
// asserts on the exit code, and an uncaught error is non-zero just the same —
// without @types/node, which this app doesn't carry.
if (failures > 0) throw new Error(`${failures} actionable rule check(s) failed`)
