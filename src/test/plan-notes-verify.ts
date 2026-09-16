/**
 * Verification harness for the plan-notes predicates (autoland v3 §4, §5.1).
 *
 * These four functions decide, between them, whether a human is ever asked for
 * anything and whether the pipeline ever finds out they answered:
 *
 *   - `openQuestionCount` is the badge. It is the ONE signal that says "you are
 *     needed here", so a count that lies in the direction of nagging erodes
 *     trust in it and a count that lies the other way loses the handoff.
 *   - `questionsAnswered` is now load-bearing on BOTH sides: the "Answered"
 *     badge here, and the runner wake (`notesWriteClosesQuestions`) in the
 *     worker. If ticking `- [x] Approve this plan` doesn't satisfy it, the
 *     Approve button silently does nothing but wait out a 15-minute cron.
 *   - `toggleChecklistItem` has to write the bytes a human typing `- [x]` would.
 *     That is the entire reason there is no approvals table: one format, one
 *     predicate, both repos parsing the same text. A toggle that normalised
 *     whitespace or re-emitted the line would break the "same bytes" claim
 *     invisibly, because the RESULT still looks right.
 *   - `pendingApproval` decides whether the Approve button exists at all.
 *
 * The regression that matters most is backward compatibility: a plan with no
 * task-list items must count and answer EXACTLY as it did before checkboxes
 * existed, because every plan TenHands has written so far is that shape.
 */
import {
  appendAnswerToNotes,
  checklistItems,
  openQuestionCount,
  parsePlanNotes,
  pendingApproval,
  questionsAnswered,
  toggleChecklistItem
} from '../domain/planNotes'
import { notesWriteClosesQuestions } from '../../worker/src/routes/board-automation'

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

const count = (notes: string) => openQuestionCount(parsePlanNotes(notes))
const answered = (notes: string) => questionsAnswered(parsePlanNotes(notes))

console.log('\n1. Plans with no checkboxes behave exactly as before')
{
  const asked = `## Questions\n\n- Should the TTL apply to negative lookups too?\n- Which branch?\n`
  check('two questions with `?` count two', count(asked), 2)
  check('…and are not answered', answered(asked), false)

  const replied = `${asked}\nYes to both, use main.\n`
  check('a trailing reply takes the count to 0', count(replied), 0)
  check('…and reads as answered', answered(replied), true)

  const imperative = `## Questions\n\n- Confirm the repo.\n- Name the branch.\n`
  check('no `?` anywhere ⇒ every item counts', count(imperative), 2)

  const sentinel = `## Questions\n\n_No open questions._\n`
  check('the sentinel is 0', count(sentinel), 0)
  check('…and is not "answered"', answered(sentinel), false)

  check('no Questions section at all is 0', count('## Plan\n\nDo the thing.\n'), 0)
  check('…and not answered', answered('## Plan\n\nDo the thing.\n'), false)
}

console.log('\n2. An unticked box is an open ask; a ticked one is its own answer')
{
  const only = `## Questions\n\n- [ ] Approve this plan\n`
  check('a lone unticked box counts 1', count(only), 1)
  check('…and is not answered', answered(only), false)

  const ticked = `## Questions\n\n- [x] Approve this plan\n`
  check('ticking it takes the count to 0', count(ticked), 0)
  check('…and THAT is what fires the wake', answered(ticked), true)

  // The shape §4 of the design specifies: prose questions, then the approval.
  const mixed = `## Questions\n\n- Should the TTL apply to negative lookups too?\n- [ ] Approve this plan\n`
  check('a `?` question plus an unticked box counts both', count(mixed), 2)
  check('…neither answered', answered(mixed), false)

  const repliedOnly = `${mixed}\nYes, negative lookups too.\n`
  check('replying leaves the box outstanding', count(repliedOnly), 1)
  check('…so it is NOT answered — this is "send it back"', answered(repliedOnly), false)

  const both = `## Questions\n\n- Should the TTL apply to negative lookups too?\n- [x] Approve this plan\n\nYes, negative lookups too.\n`
  check('reply + tick clears the count', count(both), 0)
  check('…and answers', answered(both), true)

  const tickedNoReply = `## Questions\n\n- Should the TTL apply to negative lookups too?\n- [x] Approve this plan\n`
  check('ticking with a question still open does not answer', answered(tickedNoReply), false)
}

console.log('\n3. Checkbox discovery is fence-aware and document-ordered')
{
  const doc = [
    '## Plan',
    '',
    '- [x] Already done',
    '',
    '```markdown',
    '- [ ] this is an EXAMPLE, not a control',
    '```',
    '',
    '## Questions',
    '',
    '- [ ] Approve this plan'
  ].join('\n')

  check(
    'a box inside a fence is text',
    checklistItems(doc).map(i => i.text),
    ['Already done', 'Approve this plan']
  )
  check(
    'ordinals run in document order',
    checklistItems(doc).map(i => [i.ordinal, i.checked]),
    [
      [0, true],
      [1, false]
    ]
  )
  check('pendingApproval finds the unticked one', pendingApproval(doc)?.ordinal, 1)
  check('…and skips a ticked one', pendingApproval('- [x] Approve this plan'), undefined)
  check('…and a non-approval box', pendingApproval('- [ ] Write the tests'), undefined)
}

console.log('\n4. A toggle writes the bytes a human typing would')
{
  // Deliberately awkward: a `*` marker, four-space indent, two spaces after the
  // bracket, CRLF-free but with no trailing newline. Every one of those is a
  // byte a re-emitting implementation would silently normalise.
  const original = '## Questions\n\n*    [ ]  Approve this plan'
  const typed = '## Questions\n\n*    [x]  Approve this plan'
  check('only the box character changes', toggleChecklistItem(original, 0, true), typed)
  check('…and it round-trips back', toggleChecklistItem(typed, 0, false), original)

  const two = '- [ ] first\n- [ ] second\n'
  check(
    'the ordinal picks the right row',
    toggleChecklistItem(two, 1, true),
    '- [ ] first\n- [x] second\n'
  )

  check('an out-of-range ordinal changes nothing', toggleChecklistItem(two, 9, true), two)
  check('empty notes stay empty', toggleChecklistItem('', 0, true), '')
  check('null notes stay empty', toggleChecklistItem(null, 0, true), '')

  const fenced = '```\n- [ ] example\n```\n- [ ] real\n'
  check(
    'a fenced box is not addressable',
    toggleChecklistItem(fenced, 0, true),
    '```\n- [ ] example\n```\n- [x] real\n'
  )

  // The end-to-end claim of §4: tapping the box produces a document the
  // predicate reads as answered, with no other channel involved.
  const plan = '## Questions\n\n- [ ] Approve this plan\n'
  const approved = toggleChecklistItem(plan, 0, true)
  check('tapping approve answers the plan', answered(approved), true)
  check('…by writing exactly `- [x]`', approved, '## Questions\n\n- [x] Approve this plan\n')
}

console.log("\n5. TenHands' `— pass N` footer is bookkeeping, not a human's reply")
{
  // The exact bytes TenHands renders as the last line of every plan document:
  // U+2014 EM DASH, and U+00B7 MIDDLE DOT in the confidence variant. Spelled as
  // escapes because the codepoints ARE what is under test — an editor or a
  // transcription that quietly swapped in a hyphen would make these pass while
  // the real document still failed.
  const FOOTER = '— pass 1'
  const CONFIDENCE = '— pass 2 · confidence 0.8'

  // `## Questions` is the LAST section of any plan proposing no acceptance
  // criteria, so the footer lands in its body — an item, a blank line, prose,
  // which is byte-for-byte the shape of a human's trailing reply.
  const footed = `## Questions\n\n- Which branch?\n\n${FOOTER}\n`
  check('our footer is not a reply', count(footed), 1)
  check('…and does not answer', answered(footed), false)

  const confidence = `## Questions\n\n- Which branch?\n\n${CONFIDENCE}\n`
  check('the confidence variant is not a reply either', count(confidence), 1)
  check('…and does not answer', answered(confidence), false)

  // Permissive on the values on purpose: a strict pattern that failed to match
  // on a junk confidence would silently restore the whole bug. This is the
  // lesson TenHands learned on their own side, where it reset the pass counter.
  const junk = `## Questions\n\n- Which branch?\n\n— pass 2 · confidence n/a\n`
  check('a junk confidence value still reads as a footer', answered(junk), false)

  // The sentinel asks nothing. With the footer glued under it, it was reading as
  // "answered" instead — the opposite meaning.
  const sentinel = `## Questions\n\n_No open questions._\n\n${FOOTER}\n`
  check('a footed sentinel still asks nothing', answered(sentinel), false)
  check('…and counts 0', count(sentinel), 0)

  // The footer suppressed the prose half of a mixed section too, so the badge
  // under-reported: two open asks showed as one.
  const mixed = `## Questions\n\n- Which branch?\n- [ ] Approve this plan\n\n${FOOTER}\n`
  check('a footer hides neither open ask', count(mixed), 2)

  // The damage, end to end. `notesWriteClosesQuestions` needs false → true; a
  // footer that made it true at write time meant the human's actual answer was
  // no transition at all, and no dispatch — the ~15 min cron tail §5.1 exists to
  // remove. Routed through the REAL append path, which (when Questions is the
  // last section) puts the reply AFTER the footer.
  const replied = appendAnswerToNotes(footed, 'Use main.')
  check('the human is the one who answers', answered(replied), true)
  check('…and their reply wakes the runner', notesWriteClosesQuestions(footed, replied), true)
  check('…once, not on every later autosave', notesWriteClosesQuestions(replied, replied), false)

  // The approval path was never broken — an unticked box short-circuits before
  // the reply check — but it is the primary path, so it is pinned here too.
  const approval = `## Questions\n\n- [ ] Approve this plan\n\n${FOOTER}\n`
  check('a footed approval is still outstanding', count(approval), 1)
  check(
    'ticking it still wakes the runner',
    notesWriteClosesQuestions(approval, toggleChecklistItem(approval, 0, true)),
    true
  )

  // Stripping is fence-aware like every other line rule in the parser, so a plan
  // DOCUMENTING the footer format keeps it. Nothing here rewrites the stored
  // notes — the toggle and the editor both work from the raw string — so
  // TenHands' pass counter survives a round trip through the UI.
  const quoting = `## Plan\n\nWe emit:\n\n\`\`\`\n${FOOTER}\n\`\`\`\n\n## Questions\n\n- Which branch?\n`
  const sections = parsePlanNotes(quoting)
  check('a fenced footer is content, not bookkeeping', sections[0].body.includes(FOOTER), true)
  check('…and the questions still count', openQuestionCount(sections), 1)

  // The structure stays tight enough that a human's own line survives.
  const human = `## Questions\n\n- Which branch?\n\n— pass the buck to legal\n`
  check('a human sentence opening with a dash is their reply', answered(human), true)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
// Throw rather than process.exit: the runner spawns this as a child process and
// asserts on the exit code.
if (failures > 0) throw new Error(`${failures} plan-notes check(s) failed`)
