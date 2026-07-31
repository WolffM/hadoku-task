# Task `metadata` is documented as a merge and implemented as a replace

**Filed from:** tenhands (hadoku-task-automation pipeline)
**Impact:** agent-written task metadata is silently destroyed; downstream cost
telemetry is wrong by roughly one phase per task.

## The defect

`worker/src/routes/board-claims.ts` documents the metadata field on the agent
release/set-lane path as a merge — twice:

```ts
// Merge into the task's metadata while holding the claim (§6 confirmation 1).
metadata?: Record<string, unknown> | null
```

```ts
// Build the task UPDATE from exactly the fields the runner is writing: tag
// (the lane), optional notes, optional metadata merge, and completion.
```

The implementation (same file, ~line 304) is a whole-column replace:

```ts
if (opts.metadata !== undefined) {
  sets.push('metadata = ?')
  binds.push(opts.metadata === null ? null : JSON.stringify(opts.metadata))
}
```

Any writer that sends `metadata` therefore discards every key it did not send,
including keys belonging to a different subsystem. Callers written against the
documented contract will lose data and have no way to notice.

## What it costs us today

tenhands records per-phase agent seconds under a `taskauto` key in task
metadata. Measured on the live boards:

- **9 of 9** landed tasks carry only `implement_s` / `implement_runs`.
- The one task still sitting in `plan-review` **does** carry
  `plan_s: 182.793, plan_passes: 1`.
- Task `MS3GT4QMQ0XISM3R1IZFF34BU2`'s claim log shows **two** claims:
  `2026-07-27T18:30:35Z → 18:32:45Z` (130s, the planning pass) and
  `2026-07-28T01:37:43Z → 01:41:19Z` (216s, the implement pass, matching the
  recorded `implement_s: 210.467`).

So planning demonstrably ran and was measured, and the measurement is gone by
the time the task lands. The reported `agent_s` for that task is **210s**
against a true cost of **~346s** — understated by 38%. Every cost number derived
from this field is implement-only.

## What is confirmed vs. what is not

**Confirmed:** the agent path replaces rather than merges (code above), and the
plan-phase metrics are present before the task is approved and absent after it
lands.

**Not confirmed:** _which_ write clears them. tenhands re-seeds its accumulator
from `task.metadata` at pickup, so a replace performed by our own agent writes
should still carry the earlier keys forward. That points at a non-agent write
landing between the two claims — the human moving the task `plan-review →
approved`. A local-first client that PUTs a whole task from a cached copy taken
before the agent wrote would send `metadata: null` (cf. `src/api/client.ts`,
`metadata: removed.metadata ?? null`) and wipe it.

**Decisive test, one move:** task `MS3K7F81AS…` on the `task` board currently has
`plan_s` in its metadata. Read it, drag it `plan-review → approved` in the UI,
read it again. If `plan_s` is gone, the client write is the culprit. If it
survives, the loss is on the agent path and tenhands' seeding is at fault.

## What we'd like

1. **Make the agent path merge, as documented** — read the current metadata and
   shallow-merge the incoming keys, or do it in SQL with `json_patch`. Either
   way the behaviour should match the two comments already in the file.
2. **Make the UI/client path preserve keys it does not own.** A client writing a
   task should not be able to clear a namespace it never read. Omitting
   `metadata` (leaving it untouched) is safer than sending a stale value.
3. **Say which it is in `docs/API.md`.** Whatever you choose, the contract needs
   to be stated, because the current comments assert the opposite of the code
   and that is what callers build against.

If you would rather keep replace semantics, that is a legitimate choice — but
then please say so explicitly, because a shared `metadata` column with
last-writer-wins semantics is not safe for more than one subsystem, and we will
move our telemetry somewhere we own instead.

## Note for whoever picks this up

This is the same shape as the two-lane-tag bug: a write path clobbering state it
did not author. That one was fixed by making the invariant explicit in the
handlers rather than trusting each caller. The same approach applies here.
