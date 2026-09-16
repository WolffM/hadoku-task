# autoland v3 — handoff from TenHands

Source design: tenhands repo, `docs/hadoku-task-automation/autoland-v3.md` (main, commit `2ff734d`).
Read that first — it is written to be read cold. This file is the summary and the ask.

**Status: all five items built.** What we shipped, where we pushed back, and our answer on the
open §10 question: [`autoland-v3-reply.md`](autoland-v3-reply.md).

## What's changing

Today: one board per repo, and the 8 lanes are pipeline state (planning, plan-review,
approved, working, landing, landed, stalled). schemaVersion 2.

v3: ONE board, and the lanes are REPOS — hadoku-conjure, hadoku-aggregator, tenhands,
etc., all `editableBy: user`. Pipeline state leaves the tag system entirely.

It has to leave rather than move to a second tag, because of our own rule: on an
automation board a task carries exactly one tag and it must be a lane.
`assertHumanLaneWrite` (`worker/src/routes/board-automation.ts:94`) rejects any whitespace
in the tag; `agentLaneTag` (`worker/src/routes/board-claims.ts:52`) normalises to a single
token. One axis, not two. Repo wins it.

The claim protocol does not change. claim → heartbeat → set-lane → release, the error
codes, the lease clamp, `ifCurrentLane`, `complete:true` — all still correct and all still
used.

## What they need, in priority order

### 1. Fire the wake when a notes write closes an open question

`tasks.ts:221` builds `laneOpts` from `'tag' in input`, so a notes-only update never
reaches `notifyLaneWrite`. That's invisible today because every human handoff in v2 is a
drag. In v3 the primary human action is answering in the notes, so without this it waits
on their backstop cron (~15 min median) instead of the `repository_dispatch` path (~18s).

Do NOT dispatch on every notes save — that's every autosave. Fire it when the write closes
an open question, which is a predicate we already own: `questionsAnswered` in
`src/domain/planNotes.ts`. No new vocabulary.

### 2. `ifNotesHash` on release — they call this blocking

`ifCurrentLane` exists because a human can retag out from under a live claim and a release
that overwrote it would silently lose their change. In v3 the same hazard moves to `notes`:
with no agent lanes, a human can edit the plan mid-claim. They want the identical guard on
identical terms — optional `ifNotesHash` on `POST /agent/release`, mismatch answers
`409 NOTES_CHANGED`, the release writes nothing. They already handle the `ifCurrentLane`
branch of that and would handle this the same way.

Without it they can only hash-compare-then-write, which is a race, not a guard, and the
failure mode is a human's reply gone with no recovery.

### 3. A `status` field on the task, and a chip that renders it

```
{ kind: "working"|"waiting"|"blocked"|"done", label: string, href?: string }
```

`kind` is a closed set we style; `label` is free text they write and nobody parses; `href`
makes the chip a link (usually the PR). Claim-gated exactly like notes — it slots into the
same UPDATE-builder in `releaseClaim` that already handles notes/metadata/complete. Worth
accepting on `set-lane` too so a long job can report progress without releasing.

Make it generic ("an agent reports status on a task"), NOT `metadata.autoland.status` —
that would work with no schema change and would couple a generic card renderer to one
pipeline's metadata key.

Style the chip from the vocabulary they publish at
`GET /tenhands/api/automation/presets` rather than hardcoding the strings — same reason
lane names are fetched and not pasted.

### 4. Checkbox rendering + an Approve control in the task item

Plan approval stops being "drag to the approved lane" and becomes a control inside the
item. Their plans will end `## Questions` with a task-list item:

```markdown
## Questions

- Should the TTL apply to negative lookups too?
- [ ] Approve this plan
```

Render `- [ ]` / `- [x]` as tappable checkboxes in `NotesPopout` / `PlanMarkdown`
(`planNotes.ts` already has `LIST_ITEM`), plus one primary Approve button when an unticked
approval item is present.

Important: tapping must write the same bytes a human typing `- [x]` would. No approvals
table, no `metadata.approved`, no second channel for the same fact — `questionsAnswered`
stays the single predicate on both sides. The button is a typing shortcut plus the wake
from (1).

### 5. Surface `claimed` on the card

The board read has carried a per-task `claimed` boolean since v1 and they lean on it for
selection, but nothing in the UI renders it — they grepped `src/components`, `src/hooks`
and `src/domain/types.ts` and the only hit is the `CLAIM_HELD` error string. With state
leaving the lanes, "the agent is on this one right now" has no representation at all.

### 6. Optional: bless a per-lane `repo`

Not required — `validateLaneSet` preserves unknown keys, so they can hang
`"repo": "WolffM/hadoku-conjure"` on each lane object today and it round-trips through
activate-automation and back out of `GET /boards/:ref`. First-class would just mean it's
checked rather than carried.

Knock-on worth knowing: `POST /boards/{ref}/repo` calls `grantRepoServiceKeyShare`, so
per-lane repos wouldn't get that auto-grant. It doesn't affect them (one
tenhands-service-key identity drives every board), but if per-repo agents ever read the
board, that grant needs a home.

## What they are NOT asking for

- No change to the claim protocol.
- No relaxation of the one-tag rule. They know `getTasksByTag` already splits multi-tag
  correctly and the UI would cope with two axes. They considered it and don't want it —
  one tag is load-bearing for `LANE_INVALID` being a real check.
- No per-repo boards, no board creation by them. Unchanged from `board-contract.md` §5.
- No new state machine on our side. Which `status.kind` means what, and when it changes,
  stays pipeline knowledge — same reasoning that keeps `isUserLaneWrite` structural rather
  than naming `approved`.

## One thing to decide together

`automation_presets.py` publishes a LANE VOCABULARY and strips `repo` because it's
per-board. In v3 the entire lane set is per-board, so there's no fixed list left to
publish — the preset becomes a shape: `schemaId`, `schemaVersion`, `laneKind: "repo"`, and
the `status.kind` vocabulary, with activation filling in lanes from an operator's repo
list.

Blocking that concretely: both our `validateLaneSet` and their port of it require a
NON-EMPTY `lanes` array, so a shape-preset with `lanes: []` fails both. Either the preset
carries an example lane set nobody activates verbatim, or `laneKind` becomes a recognised
alternative to `lanes` on both sides. This changes what an existing endpoint means, so
they want our view before either side writes code.

## What they'd like back

Push back on any of it — particularly (2) and (3), which are the ones that add surface
area to our API. Then the build order is **2, 1, 3, 4, 5**.

Two things they flagged that the doc records but we may want to overrule:

- **§9 is still open.** `Runner.turn()` takes the checkout lock before claiming,
  deliberately — lose that race and nothing is stranded. An unrouted Inbox task can't do
  that, because its repo isn't known until an agent has read it. Either claim-then-lock for
  routing only, or split routing into a job that touches no checkout. They lean the latter;
  it costs one extra turn of latency and doesn't weaken the invariant.

- **One board is cheaper, not more expensive.** `getChanges` already returns `tag` per row,
  so with lanes-as-repos the change feed tells them exactly which repos moved — better
  resolution than today's per-board. Their scheduler currently discards it
  (`{c.get("boardId") for c in changes}`). That plus hoisting the board read means N repos
  cost one board read per tick instead of N.
