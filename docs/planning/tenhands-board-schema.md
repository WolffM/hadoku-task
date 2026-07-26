# TenHands ↔ hadoku-task — Automation Board Integration

Status: **Draft for TenHands review.** Nothing is implemented yet on either side.
Date: 2026-07-21
Example activation payload: [`schemas/tenhands-v1.json`](schemas/tenhands-v1.json)
Parent design: [`agent-boards-design.md`](agent-boards-design.md)

TenHands is the first consumer of hadoku-task's **automation boards**. This document is the contract
between the two: how a board is activated, what the API guarantees, and which calls drive it.

> ## The pipeline is yours. We hold the lock and the notes.
>
> hadoku-task stores **no** pipeline knowledge — no jobs, no routing, no retry policy, no lane
> semantics. A lane is four fields:
>
> ```jsonc
> { "tag": "triage", "label": "Triage", "order": 0, "editableBy": "user" }
> ```
>
> `editableBy` is the only one that isn't cosmetic. You send this list when you activate a board:
>
> ```
> POST /task/api/boards/{boardId}/activate-automation
> { "schemaId": "tenhands", "schemaVersion": 1, "lanes": [ … ] }
> ```
>
> **What we give you that you can't easily build yourself:** an atomic claim (two workers cannot both
> win), a lease that expires safely, a permission boundary the web UI cannot cross, and a `notes` field
> for plans. That's the whole product.
>
> **What we deliberately don't do:** decide what's eligible, know which lane feeds which job, route a
> task on success or failure, or count your retries. You already have all of that in
> `pipeline_orchestrator.py` and `oss_state.py`. When you release a claim you name the destination
> lane; we move it and get out of the way.
>
> Lane names and the user/agent split below are a **starting proposal** from your README and
> `oss_state.py`. Change any of it — no code change needed on our side.

---

## 1. The shape

**One board per target repo.** Board identity is repo identity; `boards.repo` records which repo the
board drives so TenHands maps board → checkout without parsing display names.

A board has three regions — this part _is_ structural, since it's how we render any lane set. It is **never a horizontal kanban** — at most two columns on desktop,
collapsing to a single stack on mobile.

```
┌──────────────────── Inbox — full width ─────────────────────┐
│  untagged tasks: raw capture, not yet triaged               │
├──────────────────────────┬──────────────────────────────────┤
│  YOURS (left)            │  TENHANDS (right, read-only)     │
│  you drag, edit, approve │  what the pipeline is doing now  │
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

**The invariant: control always comes back to the left.** TenHands picks a task up (it moves right),
reports progress there, and when its turn ends it hands the task back to a lane on your track. The
right column only ever holds transient in-flight work.

### `editableBy` is the whole permission model

| Value               | Renders | A human can                                           | We guarantee                                             |
| ------------------- | ------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `editableBy: user`  | left    | drag in, drag out, edit                               | you can also move tasks here when you release a claim    |
| `editableBy: agent` | right   | never drag **in**; drag **out** only if no live claim | only a claim holder writes it, so nobody yanks live work |

That last cell is the important one, and it's why there's no `onFailure`. **If a worker dies, the lease
expires, the claim is dropped, and the task simply stays where it is** — re-claimable on your next
poll, and draggable by a human if you're gone for good. No routing policy needed, and no way to strand
a task in a lane nobody can touch.

---

## 2. Lanes

| Lane          | `editableBy` | Suggested meaning                               |
| ------------- | ------------ | ----------------------------------------------- |
| `triage`      | user         | A scored issue someone wants to pursue          |
| `planning`    | **agent**    | Building dossier + issue brief                  |
| `plan-review` | user         | Plan is in `notes`; read, edit, approve         |
| `approved`    | user         | Plan signed off; ready to fork and assign       |
| `working`     | **agent**    | Fork + agent + static analysis + review running |
| `pr-review`   | user         | Draft PR on the fork cleared review             |
| `submit`      | user         | Approved for upstream                           |
| `submitting`  | **agent**    | Opening the upstream PR                         |
| `submitted`   | user         | Upstream PR open; parked                        |
| `stalled`     | user         | Something went wrong; a human should look       |

"Suggested meaning" is exactly that — **we store none of it.** The board knows these ten tags, their
order, and which three are yours-only. Which lane triggers `plan` versus `implement`, and what happens
after, lives entirely in TenHands.

The three `agent` lanes are the ones with a live claim behind them. Everything else is a resting place
where a human is expected to act.

`stalled` is `editableBy: user` for a mechanical reason, not a stylistic one: a human has to be able to
drag it back out to retry. (An `agent` lane would work too — an expired claim is draggable — but a
`user` lane is unambiguous.)

---

## 3. Driving it from TenHands

Your `StageDispatcher` (`backend/services/dispatchers.py:24`) already has the right shape:

| `StageDispatcher`         | hadoku-task call                                       | Notes                                                                        |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| _(find work)_             | `GET /task/api/boards/{handle}`                        | Board + lanes + tasks. **You** decide what's eligible                        |
| `dispatch(job_spec, ctx)` | `POST /task/api/agent/claim` `{taskId, lane?}`         | **Atomic.** `{token}` or `409 CLAIM_HELD`. `lane` moves it in the same write |
| `check_status(job_id)`    | `POST /task/api/agent/heartbeat` `{token}`             | Extends the lease. `409 LEASE_LOST` = it was taken; abort                    |
| _(progress)_              | `POST /task/api/agent/set-lane` `{token, lane}`        | Optional: move between your own lanes mid-job                                |
| `collect_results(job_id)` | `POST /task/api/agent/release` `{token, lane, notes?}` | **You name the destination.** Moves the task, drops the claim                |

`job_id` maps to the claim **token** — the correlation key. Your interface docstring already requires
dispatchers to use it to distinguish concurrent jobs of the same type; same requirement here.

Note there is **no `/agent/eligible`**. Deciding what's ready means knowing which lane feeds which job
and what counts as ready — pipeline knowledge we deliberately don't hold. Fetch the board and filter it
however you like (lane, notes present, age, priority); none of those rules need to be taught to us.

### The claim is a real lock

`claim` is a single conditional D1 upsert; the database picks the winner by rows-affected. Two TenHands
workers polling the same board **cannot both win** — one gets `200`, the other `409 CLAIM_HELD`. You do
not need to coordinate workers yourself.

Leases are server-assigned (request a duration at claim time; we clamp it). Heartbeat to extend. If a
worker dies the lease expires, the claim is dropped, and the task stays in its lane — yours to re-claim,
or a human's to drag out. We never move it for you.

### Errors you must handle distinctly

| Code                | HTTP | Do                                                    |
| ------------------- | ---- | ----------------------------------------------------- |
| `CLAIM_HELD`        | 409  | Another worker has it. Move on                        |
| `LEASE_LOST`        | 409  | Your lease was taken. **Abort, write nothing**        |
| `LANE_NOT_EDITABLE` | 403  | You wrote a lane through the wrong path (below)       |
| `LANE_UNKNOWN`      | 422  | Destination isn't a lane on this board                |
| `TASK_NOT_FOUND`    | 404  | Deleted mid-job. Treat as handled                     |
| `LANE_CHANGED`      | 409  | Only if you passed the optional `ifCurrentLane` guard |
| `RATE_LIMITED`      | 429  | Back off per `retryAfter`                             |

### Two things you cannot do (by design)

1. **You cannot skip the queue.** `update_task` into an `agent` lane is refused with `403` — exactly as
   a human drag would be. Those lanes are writable only while holding a claim. This isn't identity
   checking (spoofable); the API simply has no path that does it.
2. **You cannot complete or delete tasks as part of the flow.** Those archive a task and are human
   actions. The automation flow only ever changes which lane tag a task carries — a task in `submitted`
   is still active and on the board. (`complete_task`/`delete_task` remain on MCP for when a human asks
   an agent to tidy up.)

---

## 4. Where the plan lives

`notes` is an explicit markdown field on every task — not a `metadata` convention.

- Your `plan` job writes its implementation plan into `notes` and releases to whichever lane you choose.
- A human edits it in the web UI.
- Your `implement` job reads it back. If you want "don't start without a plan" enforced, check `notes`
  before you claim — that's a rule you own, not a flag we store.

Claim history (who held it, when, and whatever `outcome` string you pass on release) is at
`GET /task/api/agent/history?task=<id>`. Keep `notes` human-readable; it isn't a log file.

---

## 5. Access — you get your own service key

**TenHands authenticates as itself, not as the board owner.** You get a service key, and the owner
grants it **`contributor`** on each board you drive.

| Level         | Can                                                           | Cannot                                                                      |
| ------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `readonly`    | Read tasks and lanes, filter                                  | Any write                                                                   |
| `contributor` | Create/edit/move tasks, claim, set-lane, release, write notes | Delete the board, change board settings, activate/deactivate, manage shares |

Two things follow that are worth knowing:

- **Your `agent_id` is server-derived**, not something you declare. Claims and history are attributed to
  your key, so `task_claim_log` is a real audit trail rather than an honour system.
- **You can't reshape or destroy a board.** Activation and board settings are owner-only — confirmed,
  not an oversight: a compromised service key must not be able to restructure someone's work. **The
  activation payload in §1 is something the owner applies.** To roll a schema change across boards you
  hand owners a new payload; you don't push it yourself. Worth designing your rollout around.

Everything is available over **HTTP** and over **MCP** (`https://hadoku.me/task/api/mcp`), same auth
either way: `X-User-Key`. See [`../MCP.md`](../MCP.md).

Fetch a single board — never call `GET /boards`:

```
GET /task/api/boards/{handle}
```

`handle` is a globally unique ULID, not the board's slug — slugs are display names and collide across
users (every account has a `main`). The owner gives you the handle when they grant you access.

Board count is irrelevant to a runner; it polls only its own repo's board.

---

## 6. Open questions for TenHands

Since the lane set is yours, most of these you answer simply by sending the payload you want. The ones
needing a decision from _us_ are marked.

1. **Are these the lanes you want?** They were inferred from README stages 3–5 and `oss_state.py`'s
   `selected → assigned → ready_to_submit → submitted`. If stage 4's sub-stages (SWE draft, static
   analysis, code review, remediation) should be **visible** rather than collapsed into `working`, add
   lanes for them — no change needed on our side, which is the point.
2. **Is four fields per lane enough?** It should be, because **unknown keys are preserved verbatim**:
   hang `tenhandsStage`, `dispatcher`, or anything else off a lane and we store it and hand it straight
   back untouched. Per-task provider data goes in `Task.metadata`, already an arbitrary-JSON field. So
   the honest question is narrower — is there anything you need that _neither_ a lane extra _nor_
   `metadata` can carry? **Tell us before we build it.**
3. **Who creates the boards?** A human creates and activates a board, then grants your key
   `contributor` (§5). If TenHands should provision one itself when it picks up a new repo, that needs
   both a board-create tool over MCP and a rethink of owner-only activation — **say if you need it.**
4. **Lease duration for long jobs.** Fork + agent + CI can run long. You request a lease length at
   claim time and heartbeat to extend — but only if the dispatcher heartbeats during long waits instead
   of blocking. Worth checking against how `check_status` is currently driven.
5. **Re-activation while work is in flight — resolved, but check it suits you.** A new lane set can be
   applied to a board with live claims. Claims are held on tasks, not lanes, so they survive; tasks in a
   lane the new set removed are cleared to the Inbox; and a `release` naming a lane that no longer
   exists returns `422 LANE_UNKNOWN`, so you abort cleanly rather than writing into a phantom lane.

---

## 7. Status

**Closed as of 2026-07-26.** Everything in this doc is built, live, and driven by TenHands. The
lane set is no longer ours to hold: TenHands serves it at
`https://dispatch.hadoku.me/tenhands/automation/presets`, and the activation UI fetches it
(see [`../API.md`](../API.md) → `GET /automation/presets`). Change a lane there and our picker
offers the change — no re-paste, no drift.

**The live contract is `autoland` v1** — 8 lanes, with `planning` / `working` / `landing`
agent-owned:

```
planning(agent) → plan-review(user) → replan(user) → approved(user)
                → working(agent) → landing(agent) → landed(user) · stalled(user)
```

The human gate sits **before** the work, not after it: from `approved` onward the pipeline
implements, gates, merges and deploys without asking anything further.

`schemas/tenhands-v1.json` was OUR draft — a conversation starter, never a spec — and its guesses
did not survive contact. It proposed `triage` / `pr-review` / `submit` / `submitting` /
`submitted`, and assumed a second board-driven pipeline ("Simple Work"). There isn't one:
TenHands' second pipeline is `crimson-kitty` (aggregator in, upstream PR out), explicitly not
board-driven, so it has no lane vocabulary. Keep that file as the historical draft only — the
provider endpoint is the source of truth.
