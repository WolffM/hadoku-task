# autoland v3 — what hadoku-task built, and where we push back

**Reply to:** `docs/hadoku-task-automation/autoland-v3.md` (tenhands @ `2ff734d`).
**Companion:** [`autoland-v3-handoff.md`](autoland-v3-handoff.md) is the ask as received.
**Status:** all five items built and verified. Two decisions want your sign-off (§10 below,
and the pushback in item 3).

Built in your order — **2, 1, 3, 4, 5**.

---

## 1. `ifNotesHash` on release (your §5.2 — blocking)

Shipped, on identical terms to `ifCurrentLane`.

`POST /agent/release` and MCP `release_claim` take an optional `ifNotesHash`. A mismatch answers
**`409 NOTES_CHANGED`**, writes nothing, and **keeps your claim** so you can re-read and retry on
the same token. The body carries `currentNotesHash` — the digest as it now stands — so you can
re-guard without a second read racing you too.

Checked after the claim is confirmed yours and before a single statement is queued, so a refusal
costs you nothing and leaves the human's edit exactly as they left it.

### The digest, precisely

Your half is written in Python, so this is the part worth being pedantic about:

> **lowercase hex SHA-256 of the UTF-8 encoding of the notes, with null/absent notes hashed as the
> EMPTY STRING.**

```python
hashlib.sha256((notes or "").encode("utf-8")).hexdigest()
```

No canonicalisation, no trimming, no newline normalisation — the bytes as stored are the bytes
hashed, because anything else is a second format both sides have to agree on and drift apart over.
The empty-string rule is the one convention, and it is what lets you guard "this task had no plan
when I claimed it" without a nullable hash. `notesHash()` is exported from `@wolffm/task/api` if
you ever want to cross-check against ours.

SHA-256 rather than the FNV-1a we use for the activation digest: this one decides whether a
human's text survives, and a 32-bit fingerprint collides at a rate that turns "guarded" back into
"usually guarded".

Both guards compose — send both and the lane one is evaluated first.

## 2. The wake on a notes write (your §5.1)

Shipped, and the predicate is exactly `questionsAnswered` as you asked — no new vocabulary.

It fires on the **transition** false → true, not on the state. That distinction is the whole
feature: the popout autosaves, so "questions are answered" is true on every keystroke after the
first reply, and firing on the state would be the dispatch storm you asked us not to build. A
further save while still answered fires nothing; a replan that re-asks and is answered again
fires again.

Reaches you from `PATCH /task/api/:id`, MCP `update_task`, and MCP `set_task_notes`.

**One addition to the payload, additive and ignorable:** the `client_payload` now carries
`reason`, either `"lane"` (a human landed a task in a `user` lane — the existing behaviour) or
`"questions-answered"` (this one). `lane` still names the lane the task is sitting in, which for a
notes-only write is the lane it never left. If you only sweep on wake, you need no change at all.

Deliberately **not** gated on `isUserLaneWrite`: the lane isn't changing, and which lane a task
happens to sit in says nothing about whether a human just answered a question in it.

**One gesture, one dispatch.** A write that both moves the task and answers its questions fires
once, the lane one — same property a multi-card drag already has.

An agent's own `release` writing an answered-looking plan fires nothing; the claim path writes
with direct SQL and stays off this hook entirely.

## 3. `status` on the task, and the chip (your §5.3)

Shipped as a **generic first-class field**, not `metadata.autoland.status` — we agree with your
reasoning and it's now `tasks.status`, its own column (migration `0007_task_status.sql`).

```json
{ "kind": "working" | "waiting" | "blocked" | "done", "label": "…", "href": "…" }
```

Accepted on `release` **and** `set-lane`, so a long job reports progress without releasing.
Three-way like `notes`/`metadata`: **omit** to leave it alone, `null` to clear it — so a release
that doesn't mention the chip never wipes it. Claim-gated on the same terms as everything else.
`label` is rendered verbatim and never parsed. `href` makes the chip a link and is validated
http(s)-only, because it reaches an `href` attribute. Board reads hand it back.

### Where we push back: we are NOT fetching the `kind` vocabulary

You asked us to style the chip from what you publish at
`GET /tenhands/api/automation/presets` rather than hardcoding the strings, on the lane precedent.
We think the analogy doesn't carry, and we'd rather say so than build it badly:

- **A lane's label is rendered AS TEXT.** Fetching it is sufficient — the renderer needs nothing
  else to draw a lane it has never seen. That's why lane names being data is a real win.
- **A status `kind` is a styling contract.** It resolves to a colour family and a glyph, and both
  of those are code — a stylesheet rule and an icon-registry name, shipped in a build.
  Downloading the string `"queued"` gets us a name we have no rule for, so it renders unstyled
  either way.
- Worse, it would make the kind **unvalidatable**. Today a typo'd kind is `422 STATUS_INVALID` at
  the write. Fetched, it would have to be accepted, and you'd find out via a blank chip nobody
  can explain three days later. That is the same argument that makes `LANE_INVALID` a real check
  rather than a convention — your §2.
- The half that genuinely is yours, `label`, is already free text we never interpret.

So: the four kinds are a closed set in `TASK_STATUS_KINDS` (`src/domain/types.ts`), validated on
write, one CSS rule each. If the set needs to grow, the honest change is a new kind plus a rule,
shipped together — small, and a PR away. An unrecognised kind renders as a neutral chip rather
than vanishing, so a row written before a kind was retired still reads as "there is a status
here".

**If you disagree, the cheap middle is:** publish `statusKinds` in the preset as documentation,
and we keep validating against our own set, treating yours as the source for what to add next.
Say the word and we'll wire the read; we just don't want the styling to depend on it.

## 4. Checkboxes and the Approve control (your §5.4)

Shipped. `- [ ]` / `- [x]` render as real checkboxes in `PlanMarkdown` / `NotesPopout`, and one
primary **Approve** button appears when an unticked approval item is present.

**Tapping writes the same bytes a human typing `- [x]` would.** `toggleChecklistItem` rewrites
exactly the one character inside the brackets and copies every other byte through —
indentation, marker style (`-`/`*`/`+`/`1.`), the spacing after the `]`, the trailing newline or
its absence. There is no approvals table, no `metadata.approved`, and no second channel. The e2e
asserts this against the notes the **server** stored, not against the rendered markup, because a
renderer that re-emitted the line would look identical and break both our parsers invisibly.

Detection is structural: an approval item is a task-list row whose text starts with `Approve`
(case-insensitive, leading word only), scanned across the whole document rather than only the
Questions section. The wording after it is yours to change.

Boxes inside fenced blocks are text, not controls — the same rule `parsePlanNotes` already
applies to headings, so a plan that shows an example checklist doesn't grow phantom checkboxes.

### One semantic change you need to mirror

`questionsAnswered` and `openQuestionCount` now understand task-list items. **They had to**, or
the Approve button would be a no-op with a 15-minute tail: ticking a box adds no reply paragraph,
so the old predicate would have read an approved plan as unanswered and never fired the wake
from §5.1.

The rules, and they're small:

- An **unticked** box is an open ask, always. It counts, and it is exempt from both the `?` rule
  and the reply rule — a reply does not tick a box.
- A **ticked** box never counts. Its own state is the answer.
- `questionsAnswered` is now: _every_ task-list item is ticked **and** (if there are prose
  questions) a reply trails them.
- **A section with no task-list items behaves byte-for-byte as before.** Every plan you have
  written so far is that shape, and the harness pins it.

Which gives you your §4 states for free: answer the prose and leave the box unticked ⇒ still
`has_open_questions`, i.e. "send it back"; tick it with a question still open ⇒ not answered.

## 5. `claimed` on the card (your §5.5)

Shipped. `GET /boards` — the read the UI actually calls — now flags each task `claimed: true`
when a **live** lease holds it, and the card renders it. One indexed query for the whole board
list, not one per board. An expired lease is not a live one.

Transient by construction: computed from `task_claims` at read time, never stored on the task
row, absent rather than `false` when there is no claim. A cached copy is exactly as old as the
read it came with, which is what it claims to be.

## 6. Per-lane `repo`

Not blessed, as you said it needn't be — `validateLaneSet` still preserves unknown keys verbatim,
so hang `"repo"` on each lane and it round-trips. Nothing changed; nothing needs to.

Your knock-on is correct and we're leaving it: `POST /boards/{ref}/repo` still calls
`grantRepoServiceKeyShare`, and per-lane repos get no auto-grant. Fine while one
`tenhands-service-key` identity drives every board. If per-repo agents ever read the board, tell
us and we'll find that grant a home rather than you working around it.

---

## §10 — what a "preset" means when lanes are per-board

You asked for our view before either side writes code. Here it is, and it's a third option.

**Neither of yours, quite.** The conflict only looks like one because today the _contract_ a
provider publishes and the _lane set_ a board is activated with are the same document. In v3 they
genuinely diverge: the contract is `{ schemaId, schemaVersion, laneKind: "repo", statusKinds }`,
and the lane set is the operator's repo list. So split them at that seam:

- **`validateLaneSet` keeps requiring a non-empty `lanes`.** It guards _activation_, which is the
  thing being written, and a board with an empty tag vocabulary is meaningless. That invariant is
  load-bearing and we're not relaxing it.
- **`lanes` becomes OPTIONAL on a PRESET**, where its absence plus `laneKind: "repo"` means "this
  provider's lanes are per-board; activation must generate them". The relaxation lives in the
  preset reader, not in the validator.

That's your option (b), scoped to the one place it's safe.

**And a concrete reason to reject your option (a)** — an example lane set nobody activates
verbatim. `detectPresetUpdate` calls `countStranded(preset.lanes, taskTags)` to compute
`safe`/`toInbox` on every hydrated board read (`worker/src/routes/preset-update.ts:78`). It
compares a board's LIVE tags against the PUBLISHED lane set. With an example lane set, every v3
board would report every one of its tasks as about to be stranded, and the panel would offer a
migration that looks catastrophic and is fiction. A preset that is shown in a picker and must not
be used as-is is a trap with a live consumer already wired to it.

**The real cost of (b), which the doc doesn't mention:** this is not a validation tweak on our
side, it's a **new activation flow**. Meeting `laneKind: "repo"`, the activation panel has to
collect a repo list from the operator and build the lane set from it before it can preview-commit
a digest. That's a UI we don't have. It's very buildable and we're happy to build it — but it's
the item on this list with actual design in it, so it should be scheduled as one, not as a footnote
to the preset endpoint.

**Suggested sequencing:** nothing above blocks on this. Ship v3 against a lane set your operator
activates by hand once, and land `laneKind` after, when the repo list actually starts churning.

---

## The two you flagged

**§9, lock ordering for unrouted tasks — we agree with you: option (2).** Split routing into a job
that touches no checkout. `Runner.turn()` taking the checkout lock before claiming is the
invariant that makes a lost race cost nothing, and it was chosen carefully; "briefly pins a task"
is exactly the kind of exception that stops being brief once something in the routing path starts
doing IO. One extra turn of latency against never weakening the rule is the right trade. Nothing
on our side cares either way — the lease is the backstop in both designs, and we hold no policy
about which lanes are claimable.

**One board is cheaper — agreed, and the change feed is better than you think.** `getChanges`
returns `tag` per row and, with lanes as repos, `tag` IS the repo, so the feed tells you exactly
which repos moved. Your `{c.get("boardId") for c in changes}` throwing it away is the one-line fix
you identified. Worth adding: `state` is on every row too, and a `Deleted` row is how a task
disappearing reaches you — with one board and no per-board scoping you'll see all of them, so
filter on `tag` rather than assuming the feed is already narrowed.

---

## Operational notes

- **The `status` column needs a hand-applied production migration.**
  `worker/migrations/0007_task_status.sql` is `ALTER TABLE tasks ADD COLUMN status TEXT`. Nothing
  in CI runs migrations here — they're applied by hand from `hadoku_site` via vault + wrangler.
  Until it's applied, a release carrying `status` will 500 in production. The rest of this work
  is unaffected by it.
- **`NOTES_CHANGED` and `STATUS_INVALID`** are in the `DomainErrorCode` enum in the OpenAPI spec,
  so regenerate your client and you'll get them as real variants. `/agent/release` 409 is now
  `LEASE_LOST | LANE_CHANGED | NOTES_CHANGED`; `/agent/release` and `/agent/set-lane` 422 is
  `LANE_UNKNOWN | STATUS_INVALID`.
- **Docs:** [`docs/API.md`](../API.md) (agent endpoints, both guards, the status shape) and
  [`docs/MCP.md`](../MCP.md) (tool args, the claim loop, error codes).

## How it was verified

No mocks anywhere in the assertions.

- `worker/test/autoland-v3-verify.ts` — 30 checks. Real worker, real SQLite D1, real migrations,
  over HTTP and MCP. The one that matters most: after a refused release, the human's text is read
  **straight out of D1** and asserted unchanged, along with the lane and the still-held claim —
  because a guard that answered 409 after half-applying the release would pass a status-code
  assertion and still lose the text.
- `worker/test/lane-dispatch-verify.ts` — 84 checks, `fetch` stubbed so "fired nothing" is a real
  assertion. Covers the transition, the autosave non-storm, the replan re-arm, the Approve tick,
  move-and-answer firing once, MCP, the agent path firing nothing, and a standard board.
- `src/test/plan-notes-verify.ts` — 34 checks on the predicates, including that a plan with no
  checkboxes counts and answers exactly as it did before.
- `e2e/autoland-v3-ui.spec.ts` — 5 specs in a real browser against the real worker: the checkbox
  writes the exact bytes, Approve ticks it and then disappears, approving flips the card badge to
  "Answered" (the predicate the wake fires on), the chip renders per kind with a live href, and
  `claimed` appears and clears.
- Full suite green: every worker harness, and 158 Playwright specs.
