# TenHands ↔ hadoku-task — Automation Board Integration

**Status:** the storage foundation is **built and live in production**; the automation surface TenHands drives is **designed and next to build**, pending your review of this contract.
**Audience:** the TenHands team, read cold. This doc is self-contained — you do not need any other hadoku-task doc to act on it.
**Date:** 2026-07-24
**Example activation payload:** [`schemas/tenhands-v1.json`](schemas/tenhands-v1.json) · **JSON Schema:** [`schemas/board-automation.schema.json`](schemas/board-automation.schema.json)

---

## 0. TL;DR

hadoku-task is a personal task manager. We are turning one of its boards into a
queue an autonomous system can drive safely. **TenHands is the first such system.**

> ### The pipeline is yours. We hold the board, the lock, and the notes.
>
> We store **no** pipeline knowledge — no jobs, no routing, no retry policy, no
> idea what your states _mean_. You define the states (lanes), you move tasks
> between them, you decide what's ready. What we give you that you can't easily
> build yourself:
>
> - an **atomic claim** so two workers can't grab the same task,
> - a **lease that expires safely** so a dead worker never strands a task,
> - a **permission boundary** the human's web UI cannot cross,
> - a **`notes` field** for plans, and a board a human can watch and steer in real time.

**Three things are yours to figure out** (§4): how you **read and cache** the
board, how you **react when new work appears**, and **how many states** your
pipeline actually needs. That last one you express as a **named configuration**
(§5) — e.g. a lightweight _"Simple Work"_ vs a checkpoint-heavy _"Complex Work"_.

**What we need back from you** is in §9.

---

## 1. What is already live (the foundation you build on)

This is not a paper design. As of 2026-07-24 the following ships in production
(`@wolffm/task` ≥ 3.4.106, deployed at `https://hadoku.me/task/api`):

| Capability                                                                                     | State   |
| ---------------------------------------------------------------------------------------------- | ------- |
| Board + task storage on **Cloudflare D1** (SQLite), migrated off the old KV blob store         | ✅ live |
| **Optimistic concurrency** on every task and board write (`If-Match` → `409 VERSION_CONFLICT`) | ✅ live |
| Board CRUD, rename, **pin/reorder**, and an Edit-Boards UI                                     | ✅ live |
| **Scoped hydration** — cold load fetches only pinned boards, so many boards stay cheap         | ✅ live |
| Per-task **`notes`** (markdown) end to end — API, MCP, web UI                                  | ✅ live |
| **Per-user-key auth**, HTTP and MCP, same `X-User-Key` credential                              | ✅ live |

Everything below in §6–§8 — **automation activation, lanes, the claim/lease
runtime, and board sharing** — is designed against this foundation and is the
next build. It is not live yet. This doc exists so you can shape that contract
before we implement it.

---

## 2. The shape of an automation board

**One board per target repo.** Board identity is repo identity; the board records
which repo it drives so you map board → checkout without parsing display names.

A board renders as **three regions** — this part _is_ structural, because it's how
we render any lane set. It is **never a horizontal kanban**: at most two columns
on desktop, collapsing to a single stack on mobile.

```
┌──────────────────── Inbox — full width ─────────────────────┐
│  untagged tasks: raw capture, not yet triaged               │
├──────────────────────────┬──────────────────────────────────┤
│  YOURS (left)            │  TENHANDS (right, read-only)     │
│  a human drags/edits     │  what the pipeline is doing now  │
│                          │                                  │
│  ▸ triage        ────────┼──▶ ▸ planning                    │
│  ▸ plan-review  ◀────────┼────┘                             │
│  ▸ approved      ────────┼──▶ ▸ working                     │
│  ▸ pr-review    ◀────────┼────┘                             │
│  ▸ submit        ────────┼──▶ ▸ submitting                  │
│  ▸ submitted    ◀────────┼────┘                             │
│  ▸ stalled      ◀────────┼──── (failure from any job)       │
└──────────────────────────┴──────────────────────────────────┘
```

**The invariant: control always comes back to the left.** You pick a task up (it
moves to your column), you report progress there, and when your turn ends you hand
it back to a human lane on the left. The right column only ever holds transient,
in-flight work.

---

## 3. A lane is four fields

You hardcode **no** lane names in us. A lane is exactly:

```jsonc
{ "tag": "planning", "label": "Planning", "order": 1, "editableBy": "agent" }
```

| Field        | Meaning                                       | Whose concern     |
| ------------ | --------------------------------------------- | ----------------- |
| `tag`        | the literal tag written on the task           | yours             |
| `label`      | display name for the section                  | rendering (ours)  |
| `order`      | fixed position; never frequency-ranked        | rendering (ours)  |
| `editableBy` | `user` or `agent` — who may move tasks in/out | **the guarantee** |

`editableBy` is the only field that isn't cosmetic:

| Value               | Renders | A human can                                           | We guarantee                                             |
| ------------------- | ------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `editableBy: user`  | left    | drag in, drag out, edit                               | you can also move a task here when you release a claim   |
| `editableBy: agent` | right   | never drag **in**; drag **out** only if no live claim | only a claim holder writes it, so nobody yanks live work |

That last cell is why there is **no `onFailure`**. If a worker dies, its lease
expires, the claim drops, and the task simply **stays where it is** — re-claimable
on your next poll, and draggable by a human if you're gone for good. No routing
policy needed, and no way to strand a task in a lane nobody can touch.

**Unknown keys are preserved verbatim.** Those four fields are all we _interpret_.
Hang `tenhandsStage`, `dispatcher`, whatever off a lane and we store it and hand
it straight back untouched. Same for per-task data via `Task.metadata` (already an
arbitrary-JSON field). So there is almost certainly nothing you need that a lane
extra or `metadata` can't carry — but if there is, tell us before we build (§9).

---

## 4. Your three jobs

Everything in this section is **yours to design**. We deliberately hold none of it.

### 4.1 Read and cache the board

A runner polls **its own board** and filters however it likes — by lane, by
`notes` present, by age, by priority. Board count in the whole system is
irrelevant to you; you never call the "list all boards" endpoint.

- **Today (live):** fetch the board and its tasks over HTTP/MCP, cache locally,
  and re-poll. Reads are cheap (scoped hydration) and per-user-key scoped.
- **Coming with the automation surface:** a single "give me this board fully
  hydrated" call (lanes + tasks) is the runner's read primitive — see §7. Cache
  that, diff against your last snapshot, act on what changed.
- **A change feed is planned but not built.** v1 is **poll + claim**, no webhooks.
  A cursor-based `changes?since=…` feed (so you stop full-scanning) is on the
  roadmap; until it lands, poll the board on an interval you choose and diff.

**You own the cache and its invalidation.** We are the source of truth; a `409`
on write is your signal that your cached version is stale — re-pull and retry.

### 4.2 React when new work appears

"New task in a lane you care about" is a **you**-side decision, because only you
know which lane feeds which job. Mechanically:

1. Poll the board (§4.1). New/changed tasks show up in your diff.
2. Decide eligibility (your rules — lane, `notes`, age, whatever).
3. **Claim** the task (§7). The claim is atomic: two of your workers polling the
   same board **cannot both win** — one gets the token, the other `409 CLAIM_HELD`.
   You do not need to coordinate workers yourself.
4. Do the work, **heartbeat** to hold the lease, then **release** to the lane you
   choose next.

There is deliberately **no `/eligible` endpoint**. Deciding what's ready means
knowing which lane feeds which job — pipeline knowledge we don't hold.

### 4.3 Decide how many states you actually want

The example in [`schemas/tenhands-v1.json`](schemas/tenhands-v1.json) has ten
lanes inferred from your README and `oss_state.py`. **Treat it as a conversation
starter, not a spec.** Fewer lanes is fine. More is fine. Sub-stages of "working"
(SWE draft, static analysis, code review, remediation) can each be their own lane
if you want them _visible_ to the human — or collapsed into one. No change needed
on our side either way; that's the whole point.

This is where your napkin thoughts become real: **you** convert "I want a planning
step and an adversarial-review step" into an ordered lane list with an
`editableBy` on each. Which lane triggers `plan` vs `implement`, and what happens
after, lives entirely in TenHands.

---

## 5. Named configurations ("Simple Work" vs "Complex Work")

A **configuration is a named lane set.** In the activation payload it's just
`schemaId` + `schemaVersion` + `lanes` (§6). We store the name/version verbatim as
opaque labels — they let _you_ tell which contract a board is running and push an
update. They are **not** keys into any registry of ours.

We expect you'll want **more than one**, matched to how much ceremony a task
deserves. For example:

**`schemaId: "simple-work"`** — few steps, human triages and approves, one agent
does the thing:

```jsonc
{
  "schemaId": "simple-work",
  "schemaVersion": 1,
  "label": "Simple Work",
  "lanes": [
    { "tag": "todo", "label": "To Do", "order": 0, "editableBy": "user" },
    { "tag": "working", "label": "Working", "order": 1, "editableBy": "agent" },
    { "tag": "review", "label": "Review", "order": 2, "editableBy": "user" },
    { "tag": "done", "label": "Done", "order": 3, "editableBy": "user" },
    { "tag": "stalled", "label": "Stalled", "order": 4, "editableBy": "user" }
  ]
}
```

**`schemaId: "complex-work"`** — intermediary checkpoints, a planning agent, an
adversarial-review agent, human gates between each:

```jsonc
{
  "schemaId": "complex-work",
  "schemaVersion": 1,
  "label": "Complex Work",
  "lanes": [
    { "tag": "triage", "label": "Triage", "order": 0, "editableBy": "user" },
    { "tag": "planning", "label": "Planning", "order": 1, "editableBy": "agent" },
    { "tag": "plan-review", "label": "Plan Review", "order": 2, "editableBy": "user" },
    { "tag": "approved", "label": "Approved", "order": 3, "editableBy": "user" },
    { "tag": "implementing", "label": "Implementing", "order": 4, "editableBy": "agent" },
    { "tag": "adversarial", "label": "Adversarial QA", "order": 5, "editableBy": "agent" },
    { "tag": "pr-review", "label": "PR Review", "order": 6, "editableBy": "user" },
    { "tag": "submit", "label": "Submit", "order": 7, "editableBy": "user" },
    { "tag": "submitting", "label": "Submitting", "order": 8, "editableBy": "agent" },
    { "tag": "submitted", "label": "Submitted", "order": 9, "editableBy": "user" },
    { "tag": "stalled", "label": "Stalled", "order": 10, "editableBy": "user" }
  ]
}
```

Both are illustrative — **the exact names, count, and split are yours.** The point
of named configs is: a repo picks the config that fits the work, and you can roll a
config change across all boards on it by bumping `schemaVersion` and re-activating
(§6). Two lanes both `editableBy: agent` back to back (like `implementing` →
`adversarial` above) is fine — a human isn't required between every step, only
where you want a gate.

**The `agent` lanes are the ones with a live claim behind them.** Everything else
is a resting place where a human is expected to act.

---

## 6. Activation — turning a board into a queue

Activation is **destructive**: it replaces a board's freeform tags with your fixed
lane set and locks that structure against editing from the app (so a human can't
reshape the queue under a running agent). It's a migration, not a toggle.

```
POST /task/api/boards/{boardId}/activate-automation
{ "schemaId": "complex-work", "schemaVersion": 1, "lanes": [ … ], "dryRun": true }
```

- **`dryRun: true` changes nothing** and returns a preview: for each existing tag,
  how many tasks carry it and where it lands; which fall through to the Inbox; any
  collision. The preview returns a digest the committing call must echo back, so an
  automated activation can't silently reshape a board nobody looked at.
- **Unmapped tags are cleared** into the Inbox (originals preserved in
  `metadata.preAutomationTags`; nothing is discarded).
- **Updating a config = activating again** with a bumped `schemaVersion`. Same
  endpoint, same preview — so you roll a change across every board on a repo
  programmatically instead of a human redoing them by hand.
- **Re-activation is allowed while claims are live.** A claim is held on a _task_,
  not a lane, so it survives; tasks in a removed lane are cleared to the Inbox; a
  `release` naming a lane that no longer exists returns `422 LANE_UNKNOWN` and you
  abort cleanly.
- **Activation is owner-only** (the human). You hand owners a payload; you don't
  push it yourself. This is deliberate: a compromised service key must not be able
  to restructure someone's work.

**Validation is structure only:** lane tags unique, `editableBy ∈ {user, agent}`,
`order` present. We never validate that your pipeline makes sense — that's yours.

---

## 7. Driving it — claim / heartbeat / set-lane / release

Your `StageDispatcher` already has the right shape. The mapping:

| Your dispatcher        | hadoku-task call                                       | Notes                                                                        |
| ---------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| _(find work)_          | `GET /task/api/boards/{handle}`                        | board + lanes + tasks, fully hydrated. **You** decide what's eligible        |
| `dispatch(job, ctx)`   | `POST /task/api/agent/claim` `{taskId, lane?}`         | **atomic.** `{token}` or `409 CLAIM_HELD`. `lane` moves it in the same write |
| `check_status(job)`    | `POST /task/api/agent/heartbeat` `{token}`             | extends the lease. `409 LEASE_LOST` = it was taken; abort                    |
| _(progress)_           | `POST /task/api/agent/set-lane` `{token, lane}`        | optional: move between your own lanes mid-job                                |
| `collect_results(job)` | `POST /task/api/agent/release` `{token, lane, notes?}` | **you name the destination.** Moves the task, drops the claim                |

- `job_id` maps to the claim **token** — the correlation key.
- **The claim is a real lock:** one conditional D1 upsert, the database picks the
  winner by rows-affected. Two workers on the same board cannot both win.
- **Leases are server-assigned.** You request a duration at claim time; we clamp
  it. Heartbeat to extend. Clock skew can't extend a lease — you never send
  timestamps.
- **Long jobs:** fork + agent + CI can run long. Heartbeat during long waits
  rather than blocking, or request a longer lease up front.

### Errors you must handle distinctly

| Code                | HTTP | Do                                                       |
| ------------------- | ---- | -------------------------------------------------------- |
| `CLAIM_HELD`        | 409  | another worker has it — move on                          |
| `LEASE_LOST`        | 409  | your lease was taken — **abort, write nothing**          |
| `LANE_NOT_EDITABLE` | 403  | you wrote a lane through the wrong path (below)          |
| `LANE_UNKNOWN`      | 422  | destination isn't a lane on this board                   |
| `LANE_INVALID`      | 422  | task carried zero or two lane tags — repair, don't retry |
| `TASK_NOT_FOUND`    | 404  | deleted mid-job — treat as handled                       |
| `VERSION_CONFLICT`  | 409  | your cached version is stale — re-pull and retry         |
| `NOTES_TOO_LARGE`   | 413  | truncate or link out; don't retry unchanged              |
| `RATE_LIMITED`      | 429  | back off per `retryAfter`                                |

### Two things you cannot do (by design)

1. **You cannot skip the queue.** `update_task` into an `agent` lane is refused
   with `403` — exactly as a human drag would be. Those lanes are writable only
   while holding a claim. This isn't identity-checking (spoofable); the API simply
   has no path that does it.
2. **You cannot complete or delete tasks as part of the flow.** Those archive a
   task and are human actions. The automation flow only ever changes which lane a
   task carries — a task in `submitted` is still active and on the board.
   (`complete_task`/`delete_task` remain available for when a human explicitly asks
   an agent to tidy up.)

---

## 8. Where the plan lives — `notes`

`notes` is an explicit markdown field on every task (live today), not a `metadata`
convention.

- Your `plan` job writes its implementation plan into `notes` and releases to
  whichever lane you choose. A human reads and edits it in the web UI. Your
  `implement` job reads it back.
- Want "don't start without a plan"? Check `notes` before you claim — your rule,
  not a flag we store.
- Claim history (who held it, when, and any `outcome` string you pass on release)
  will be at `GET /task/api/agent/history?task=<id>`. Keep `notes` human-readable;
  it isn't a log file.

---

## 9. Access, and what we need from you

**TenHands authenticates as itself, not as the board owner.** You get a **service
key**; the owner grants it **`contributor`** on each board you drive. Everything is
available over **HTTP** and **MCP** (`https://hadoku.me/task/api/mcp`), same auth
either way: `X-User-Key`.

| Level               | Can                                                                         | Cannot                                                                |
| ------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `contributor` (you) | read, create/edit/move tasks, claim/heartbeat/set-lane/release, write notes | delete the board, change settings, activate/deactivate, manage shares |

- **Your `agent_id` is server-derived** from your key, not a string you declare —
  so the claim log is a real audit trail, not an honour system.
- **You can't reshape or destroy a board.** Activation and settings are owner-only
  (§6). Design your rollout around handing owners a payload.

### What we're asking you to send back

1. **Confirm the mechanism works for you** — the activation payload shape, the
   claim → heartbeat → set-lane → release loop, the error codes (§7), and `notes`.
2. **Send us your named configuration(s)** — the actual lane sets you want (§5).
   One or several (e.g. Simple Work / Complex Work). Names, count, and user/agent
   split are entirely yours.
3. **Tell us if anything you need can't be carried** by the four-field lane, a lane
   extra, or `Task.metadata` — **before** we build. We'd rather widen the contract
   now than have you work around it.

---

## 10. Status

The foundation (§1) is live. The automation surface (§6–§8) is designed and is the
next build — internally tracked as three tranches: board **sharing** (so your
service key gets `contributor`), **activation + lane enforcement**, then the
**claim/lease runtime**. We'll implement against whatever you send back in §9, so
the contract fits your pipeline rather than our guess at it.
