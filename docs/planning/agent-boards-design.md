# Configurable Boards + Agent-Ready Task Backend — Design Doc

Status: **Ratified 2026-07-21.** T0–T7 backend shipped (T0–T5 prod-verified 2026-07-24;
T6–T7 verified in-harness, deploy pending); only T8 (agent-facing hardening) remains. The full
agent runtime is live: shared boards, automation activation + lane enforcement, and the
claim/heartbeat/set-lane/release protocol + change feed, over both HTTP and MCP. Deferred UI (not
blocking TenHands): T5's My/Shared picker grouping + shared-board pinning, T6's two-track render +
Edit-Boards activation affordance, and the 🤖 claimed badge (T7).
Date: 2026-07-21
Supersedes the "Source of truth" and "Write safety" rows of
[`local-integration-design.md`](local-integration-design.md) — see §13.

Two goals:

1. **Boards become configurable.** Own as many boards as you like; choose which few sit in the top bar.
2. **The task store becomes safe for autonomous agents.** Atomic claims, expiring leases, a permission
   boundary the web UI cannot cross, and somewhere to put a plan.

The first consumer is [TenHands](tenhands-board-schema.md), which drives one board per target repo.

---

## 1. Settled decisions

| Area                | Decision                                                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage engine      | **Tasks + boards move from Workers KV to D1.** A blob-per-board read-modify-write over an eventually consistent store cannot express compare-and-swap. D1 is already bound and already hot.                                                         |
| Concurrency         | **Real CAS via one conditional D1 upsert** on `task_claims`; `meta.changes` picks the winner. No Durable Object, no lock service.                                                                                                                   |
| Board visibility    | **`pinned` + `position` in `board_prefs`, keyed by viewer** — server-side, one source of truth for every client, and per user-key so a shared board can be pinned without touching its owner's row. Pinned = top bar _and_ cold-load hydration set. |
| Repo scoping        | **One board per repo** (~30). Viable because hydration is O(pinned), not O(boards) — see §5.5.                                                                                                                                                      |
| Lane vocabulary     | **Supplied by the provider** at activation. A lane is four fields: `tag`, `label`, `order`, `editableBy`. We store no jobs, no routing, no retry policy, no lane semantics.                                                                         |
| Lane permissions    | **`editableBy: user \| agent`** — the only permission. Enforced structurally by endpoint: agent lanes are writable only while holding a claim token, and become draggable once it expires.                                                          |
| Automation flow     | Agents **only change which lane tag a task carries**. `complete`/`delete` archive a task — human actions, untouched by this design.                                                                                                                 |
| Plan storage        | **An explicit `notes` column on every task**, not a `metadata` convention.                                                                                                                                                                          |
| Rendering           | **Two-track vertical flow**: full-width Inbox on top, `user` lanes left, `agent` lanes right; one stack on mobile. Never horizontal.                                                                                                                |
| Hardcoded behaviour | Lane caps, grid shapes, per-section limits and untagged placement move into a **board-type descriptor**. `standard` reproduces today's rendering exactly.                                                                                           |
| Trigger mechanism   | **Poll + claim.** No webhooks in v1. A change feed keeps pollers from full-scanning.                                                                                                                                                                |
| Migration style     | **Lazy read-repair**, the same shape as the raw-key→userId flip already shipped. No bulk copy.                                                                                                                                                      |
| Client architecture | **Unchanged.** localStorage-optimistic + background sync stays as-is; this is a storage swap behind the existing `Storage` interface.                                                                                                               |

---

## 2. The current state, audited

### 2.1 Boards are not configurable

`MAX_BOARDS = 5` (`src/app/constants.ts:7`) is purely cosmetic client state — `BoardsSection.tsx:50`
slices the list, `:53` hides the "+" button. The server caps nothing (`createBoard`,
`src/domain/handlers/handlers.ts:256`). A user with 6 boards silently loses the 6th. No ordering, no
hide/show, no rename; order is insertion order (`handlers.ts:277`).

### 2.2 Board writes have no concurrency control

`BoardsFile.version` is typed as the literal `1` (`src/domain/types.ts:58`) and `withBoardOperation()`
(`handlers-utils.ts:289`) neither checks nor bumps it. Task writes got optimistic concurrency in Phase 0
of the local-integration work; board writes never did.

### 2.3 The locks are not locks

`withBoardLock()` (`worker/src/routes/route-utils.ts:258`) is a `Map<string, Promise>` in module scope.
Its own docblock says it: per-worker-instance, not globally coordinated. Two colos share nothing.

### 2.4 KV cannot give us a claim

`local-integration-design.md` §4 is explicit and correct: version + `If-Match` over KV **narrows** lost
updates without eliminating them, because the server's own read of `version` can be stale. Fine for one
human. For two agents racing to claim one task it is the exact failure we must not have — **both can
believe they won.**

### 2.5 Other gaps

| Gap                             | Where                                                                 | Consequence                                    |
| ------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| `batchMoveTasks` is unguarded   | `handlers.ts:432` — four independent `saveX` calls, no version check  | Lost updates on cross-board moves              |
| No body/notes field on `Task`   | `src/domain/types.ts:14`                                              | Nowhere to write or review a plan              |
| MCP errors are an opaque string | `worker/src/mcp/handler.ts:83` — every failure → `isError` + text     | Agent can't tell "retry me" from "bad input"   |
| No single-board read path       | `worker/src/routes/boards.ts:44` — `GET /boards` hydrates every board | Cold load is O(all boards); runners over-fetch |
| No change feed                  | —                                                                     | Pollers re-read everything every tick          |
| `list_tasks` has no pagination  | `worker/src/mcp/tools.ts:73`                                          | Unbounded payloads as boards grow              |
| Events have no actor            | `worker/src/events.ts:10`                                             | Can't tell which agent (or the human) did what |

### 2.6 What already works and must be reused

- **Task-level OCC** through the single read-modify-write chokepoint `withTaskOperation()`
  (`handlers-utils.ts:220`) + `parseIfMatch()` (`route-utils.ts:206`). The storage swap must preserve
  this behaviour exactly.
- **`readWithRepair()`** (`route-utils.ts:46`) — read primary, fall back to legacy, copy forward. Proven
  in the userId flip; the KV→D1 cutover is the same pattern with a different primary.
- **`source` + `sourceId` ingest-once idempotency** (`types.ts:30`, `handlers.ts:128`) — already the
  create-retry guarantee agents need.
- **The `Storage` interface** (`src/server/storage.ts`) is the seam that makes the migration tractable:
  handlers never learn the backend changed.

---

## 3. Storage: KV → D1

### 3.1 Why

Every gap in §2.2–2.4 has one root cause: whole-file read-modify-write over an eventually consistent
store. Compare-and-swap cannot be built on that. D1 gives it in one statement.

Falling out for free: per-task writes (edits to different tasks stop contending), queries (filter by
lane/date/state without loading the board), a change feed (`WHERE updated_at > ?`), board OCC, and an
atomic `db.batch()` for the multi-board move at `handlers.ts:432`.

### 3.2 It should be faster, and that is the gate

`getBoards()` (`handlers.ts:40`) is N+1 today: per board, 1 KV get for tasks (`route-utils.ts:78`) plus
2 D1 queries for stats (`:109`, `:110`). Five boards ≈ 5 KV gets + 10 D1 queries. **D1 is already on the
cold-load critical path**, so the "KV is edge-cached" objection is already priced in. The same payload
is 2–3 D1 queries.

Independently: `getBoardTimeline` pulls **100 events per board** on every `getBoards` and the frontend
never renders them. Trim in T1.

**Hard gate:** `pnpm run profile` against the `docs/PROFILING.md` baseline — tasks on screen **246 ms**,
total API **998 ms**. Regression blocks the tranche (§10).

### 3.3 Schema

One migration, all columns for all tranches, so we migrate once. Lives cross-repo in
`hadoku_site/workers/task-api/migrations/`.

```sql
CREATE TABLE boards (
  user_id         TEXT    NOT NULL,
  id              TEXT    NOT NULL,             -- client-supplied slug; NOT unique across users
  handle          TEXT    NOT NULL,             -- ULID, globally unique: the API's board reference (§7.1)
  name            TEXT    NOT NULL,
  tags            TEXT    NOT NULL DEFAULT '[]',  -- JSON array; freeform boards only
  repo            TEXT,                           -- which repo this board drives
  mode            TEXT    NOT NULL DEFAULT 'standard',  -- 'standard' | 'automation'
  schema_id       TEXT,                           -- provider's label, stored verbatim (§5.1)
  schema_version  INTEGER,                        -- provider's version, stored verbatim
  lanes           TEXT,                           -- JSON: the provider's lane list, verbatim
  previous_config TEXT,                           -- pre-activation snapshot, for deactivate
  version         INTEGER NOT NULL DEFAULT 1,     -- OCC, finally real
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE UNIQUE INDEX boards_handle ON boards(handle);

CREATE TABLE tasks (
  user_id    TEXT NOT NULL,
  board_id   TEXT NOT NULL,
  id         TEXT NOT NULL,                       -- ULID
  title      TEXT NOT NULL,
  notes      TEXT,                                -- markdown body / the plan (§6)
  tag        TEXT,                                -- space-separated, unchanged contract
  state      TEXT NOT NULL DEFAULT 'Active',      -- 'Active' | 'Completed' | 'Deleted'
  date       TEXT,                                -- 'YYYY-MM-DD', UTC day
  start_time TEXT,
  end_time   TEXT,
  source     TEXT,
  source_id  TEXT,
  metadata   TEXT,                                -- JSON
  created_at TEXT NOT NULL,
  updated_at TEXT,
  closed_at  TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX tasks_board   ON tasks(user_id, board_id, state);
CREATE INDEX tasks_updated ON tasks(user_id, updated_at, id);      -- change-feed cursor (§4.4)
CREATE UNIQUE INDEX tasks_source ON tasks(user_id, source, source_id)
  WHERE source IS NOT NULL;                                        -- ingest-once, in the DB

CREATE TABLE board_prefs (                        -- per-VIEWER board state (§7.2)
  user_id  TEXT    NOT NULL,                      -- the viewer: owner or grantee
  owner_id TEXT    NOT NULL,                      -- board's owner, so a grantee can pin someone else's
  board_id TEXT    NOT NULL,
  pinned   INTEGER NOT NULL DEFAULT 0,            -- top bar AND cold-load hydration set (§5.5)
  position INTEGER NOT NULL DEFAULT 0,            -- order among pinned
  PRIMARY KEY (user_id, owner_id, board_id)
);
CREATE INDEX board_prefs_pinned ON board_prefs(user_id, pinned, position);

CREATE TABLE board_shares (                       -- §7: shared boards
  owner_user_id   TEXT NOT NULL,
  board_id        TEXT NOT NULL,
  grantee_user_id TEXT NOT NULL,                  -- another user key, or a service key (e.g. TenHands)
  level           TEXT NOT NULL,                  -- 'readonly' | 'contributor'
  created_at      TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, board_id, grantee_user_id)
);
CREATE INDEX board_shares_grantee ON board_shares(grantee_user_id);

CREATE TABLE task_claims (                        -- the CAS surface
  user_id      TEXT NOT NULL,
  board_id     TEXT NOT NULL,
  task_id      TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  token        TEXT NOT NULL,                     -- opaque, server-minted
  claimed_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,                     -- server-assigned, always
  heartbeat_at TEXT NOT NULL,
  PRIMARY KEY (user_id, task_id)
);

CREATE TABLE task_claim_log (                     -- display history, not a state store
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  board_id   TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  ended_at   TEXT,
  ended_by   TEXT,                                -- 'release' | 'expiry'
  outcome    TEXT                                 -- free text from the runner; we don't interpret it
);
CREATE INDEX task_claim_log_task ON task_claim_log(user_id, task_id, id);
```

`boards.tags` stays a JSON array: a small unordered set always read with its board, preserving the
existing `Board.tags` contract at zero migration cost. On automation boards it's unused — `lanes` is the
structure.

### 3.4 ⚠️ Identity hazard: do not reuse the masked key

`task_events.user_key` is **deliberately masked to the first 50%** of the identifier — see
`hadoku_site/workers/task-api/migrations/0001_mask_user_keys.sql` and every `maskKey()` call site in
`route-utils.ts` (`:106`, `:150`, `:169`). Lossy and collision-prone by construction, which is fine for
analytics and disqualifying for content.

**The new tables key on the full stable `user_id`** — the registry UUID stamped from `X-User-Id`
(`worker/src/index.ts:110-125`). `task_events` stays masked and unchanged. **Never join the new tables
to `task_events` on user.** If a joined view is ever needed, add an explicit unmasked column to
`task_events` rather than un-masking the existing one. Getting this wrong lets two users collide on a
truncated key — a data-leak class bug.

### 3.5 Cutover: lazy read-repair

Mirror `readWithRepair()` (`route-utils.ts:46`) with D1 as primary and KV as legacy:

1. Read the board's rows from D1.
2. On a miss, read the KV blob, insert its rows into D1 in one `db.batch()`, **read them back to verify
   they landed**, then **delete the KV entry in the same request**, and serve.
3. **All writes go to D1 only** from the flip onward.

No soak window, no scheduled prune, no cleanup job — the migration completes per board, in-process, the
first time that board is read. If any step fails the KV entry is left untouched and the whole thing
retries on the next read, so it is idempotent and self-healing.

Race-free for the same reason the userId flip was: we never do a bulk copy, so there is no window where
a post-copy KV write is silently lost. The pre-flip raw-credential namespace (`legacyId`) must survive
the same path — a user not yet repaired off the raw key must still land in D1 on first read.

Rollback protection comes from a **one-off KV export taken before the flip**, not from leaving live data
in two places. That's a file we can restore from, rather than a second source of truth that can drift.

New code: `createD1Storage(env, legacyId?)` beside `createKVStorage` in `route-utils.ts`, implementing
the same `TaskStorage` interface. `getContext()` (`route-utils.ts:194`) picks which to construct. That
is the entire blast radius, because handlers, routes and MCP all go through the interface.

---

## 4. The claim protocol

### 4.1 Atomic claim — one statement

```sql
INSERT INTO task_claims
  (user_id, board_id, task_id, agent_id, token, claimed_at, expires_at, heartbeat_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6)
ON CONFLICT(user_id, task_id) DO UPDATE SET
  agent_id     = excluded.agent_id,
  token        = excluded.token,
  claimed_at   = excluded.claimed_at,
  expires_at   = excluded.expires_at,
  heartbeat_at = excluded.heartbeat_at
WHERE task_claims.expires_at < ?6;   -- only ever steal an EXPIRED lease
```

`meta.changes === 1` ⇒ **you won**. `0` ⇒ a live lease exists ⇒ `409 CLAIM_HELD`, with the holder and
expiry in the body. No lock, no lease service, no second round trip. The `WHERE` on the conflict branch
is what makes stealing safe: a live lease is never taken from a working agent, and an abandoned one is
recoverable without a sweeper.

When `claim` is given a `lane`, the lane write goes in the **same `db.batch()`** as this statement, so
"claimed" and "shows as In Progress" can never disagree.

### 4.2 Lifecycle

```
unclaimed ──claim(lane?)──▶ leased ──heartbeat──▶ leased ──release(lane, notes?)──▶ unclaimed
    ▲                          │
    └──────────────────────────┘  lease expires: claim dropped, task stays where it is
```

- **Unclaimed** = no unexpired `task_claims` row. What counts as _eligible_ is the runner's business,
  not ours.
- **`set-lane`** moves a task while you hold the claim, for runners with intermediate states.
- **`heartbeat`** extends the lease `WHERE token = ?`, so a runner whose lease already expired and was
  taken gets `409 LEASE_LOST` and aborts instead of double-working.
- **`release`** takes `{token, lane, notes?}` — the runner names the destination. Idempotent on token.
- **Expiry drops the claim and nothing else.** No routing, no retry counter, no forced destination. The
  task becomes claimable again and rescuable by hand (§5.2). This is why no `onFailure` exists.
- **Expiry is server-assigned only.** Runners never send timestamps, so clock skew can't extend a lease.

### 4.3 Error codes agents can act on

Today `mcp/handler.ts:83` flattens every failure to a string. Fixing that matters as much as the
locking does.

| Code                  | HTTP | Agent should                                                        |
| --------------------- | ---- | ------------------------------------------------------------------- |
| `CLAIM_HELD`          | 409  | Someone holds a live claim. Move on                                 |
| `LEASE_LOST`          | 409  | Your lease was taken. Abort immediately, write nothing              |
| `LANE_NOT_EDITABLE`   | 403  | Structural refusal — wrong path for this lane (§5.2). Never retry   |
| `LANE_UNKNOWN`        | 422  | Destination isn't a lane on this board. Fix the caller              |
| `LANE_INVALID`        | 422  | Task carried zero or two lane tags; repair, don't retry             |
| `LANE_CHANGED`        | 409  | Only when the optional `ifCurrentLane` guard was passed             |
| `VERSION_CONFLICT`    | 409  | Re-pull and retry (existing, `types.ts:173`)                        |
| `TASK_NOT_FOUND`      | 404  | Abort; treat as already handled                                     |
| `BOARD_SCHEMA_LOCKED` | 409  | Lane structure is frozen on an automation board (§5.2). Never retry |
| `NOTES_TOO_LARGE`     | 413  | Truncate or link out; do not retry unchanged                        |
| `RATE_LIMITED`        | 429  | Back off per `retryAfter`                                           |

The transport exists: `onError` (`worker/src/index.ts:299`) maps any structurally detected
`DomainError` (`httpStatus` + `code`) to its status. New errors subclass `DomainError`
(`src/domain/types.ts:134`). The MCP handler must forward `code` in `structuredContent`.

### 4.4 Change feed — zero extra writes

D1's free tier is 100k **writes**/day, so the feed must not cost a write. It doesn't: `tasks.updated_at`
is already set on every mutation, and `tasks_updated` indexes `(user_id, updated_at, id)`.

```
GET /task/api/changes?since=<updated_at>,<id>
→ SELECT … WHERE user_id = ? AND (updated_at, id) > (?, ?) ORDER BY updated_at, id LIMIT ?
```

The composite `(updated_at, id)` cursor disambiguates ties within the same timestamp. No `seq` column,
no second write per mutation, no dependence on `task_events` — which is masked-key-scoped (§3.4) and
therefore the wrong table to build a per-user cursor on anyway.

Deletes appear in the feed because a deleted task keeps its row with `state = 'Deleted'` and a fresh
`updated_at`; the tombstone is the change event.

**Write budget, per user action:** one `UPDATE tasks` (or `INSERT`), plus the existing
`INSERT task_events` that already happens today. A claim adds one upsert on `task_claims`; a release
adds one `UPDATE tasks` + one `UPDATE task_claim_log`. Nothing in this design adds a write to the
common path, and the change feed adds none at all.

---

## 5. Automation boards

Activating a board is **destructive**: it replaces the board's freeform tags with a fixed set of lanes
and locks that structure against editing from the app. The lock exists so a human can't reshape the
queue under a running agent.

### 5.1 The lane set comes from the provider

We hardcode **no** lane names, ordering, or user/agent split. That list arrives in the activation
request. A lane is four fields:

| Field        | Meaning                                           | Whose concern     |
| ------------ | ------------------------------------------------- | ----------------- |
| `tag`        | The literal tag written on the task               | the provider's    |
| `label`      | Display name for the section                      | rendering (ours)  |
| `order`      | Fixed position; never frequency-ranked (§5.3)     | rendering (ours)  |
| `editableBy` | `user` or `agent` — who may move tasks in and out | **the guarantee** |

There is deliberately no `role`, `job`, `whileRunning`, `onSuccess`/`onFailure`, `requiresNotes` or
`maxAttempts`. Those would be us re-implementing the provider's state machine inside a task store — and
TenHands already has one. A runner holding a claim knows where the task goes next; it tells us:

```
POST /task/api/agent/release   { token, lane: "plan-review", notes: "…" }
```

| Not stored              | Because                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `job`                   | The runner polls by lane; it knows what that lane is for    |
| `whileRunning`          | The runner names the lane when it claims                    |
| `onSuccess` `onFailure` | The runner names the lane when it releases                  |
| `requiresNotes`         | The runner can read `notes` before claiming                 |
| `maxAttempts`           | The runner counts its own attempts; we expose claim history |
| `role`                  | Pipeline semantics. Never ours                              |

**Validation is structure only:** lane tags unique within the board, `editableBy` ∈ {`user`,`agent`},
`order` present.

**Unknown keys are preserved verbatim, never rejected.** Those four fields are what we _interpret_; a
provider may hang anything else off a lane and we store it and hand it straight back:

```jsonc
{
  "tag": "working",
  "label": "Working",
  "order": 4,
  "editableBy": "agent",
  "tenhandsStage": 4,
  "dispatcher": "copilot",
  "anything": { "at": "all" }
}
```

Same for `Task.metadata`, which is already an arbitrary-JSON catch-all (`src/domain/types.ts:36`). Between
the two there is no provider-specific concept that needs a column here — which is the point. **No agentic
business logic lives in this repo.** It is a task-manager utility that happens to hold other people's
JSON without opening it.

The activation payload has a published JSON Schema at
[`schemas/board-automation.schema.json`](schemas/board-automation.schema.json) so a provider can validate
before sending. It sets `additionalProperties: true` deliberately.

`schemaId` / `schemaVersion` are stored verbatim as opaque labels, so a provider can tell which contract
a board is running and push an update. Not keys into any registry of ours.

### 5.2 Enforcement — structural, not advisory

Gated by **endpoint**, never by asking the caller who they are (a self-declared `agent_id` is
spoofable):

| Writer                                                                   | May move a task into          |
| ------------------------------------------------------------------------ | ----------------------------- |
| `PATCH /task/api/:id`, batch tag ops, MCP `update_task` — the human path | only `editableBy: user` lanes |
| `POST /agent/claim` / `set-lane` / `release` — **needs a live token**    | any lane on the board         |

Anything else → `403 LANE_NOT_EDITABLE`. **An agent can't skip the queue either**: an agent calling
`update_task` to drop a task into an `agent` lane is refused exactly like a human drag. The guarantee
comes from the shape of the API, not from trusting an identity.

**Agent lanes are not a black hole:**

- **With a live claim** — locked both ways. Nobody yanks work out from under a running job.
- **With no live claim** — still can't drag _in_, but you can drag _out_. A lease that expired with
  nobody routing the task must be rescuable by hand.

**The lane structure is immutable while `mode = 'automation'`.** `createTag`, `deleteTag` and
`batchClearTag` (`handlers.ts:322`, `:352`, `:505` — the last also mutates board metadata at `:556`)
reject with `409 BOARD_SCHEMA_LOCKED`. The provider changes lanes by re-activating (§5.4); nothing else
can. The UI hides the affordances, but the server is the enforcement.

**Corollaries:**

- **A task on an automation board carries exactly one tag, and it is a lane.** No free labels, no
  extras — validated on every write, `422 LANE_INVALID` otherwise. The board's tag vocabulary _is_ the
  provider's contract, so anything else is drift. Per-task provider data goes in `metadata`, not tags.
- Filter chips on an automation board therefore list lanes, and only lanes.

### 5.3 Two-track vertical flow

**Never a horizontal board.** Full-width Inbox on top, then two tracks — at most two columns, collapsing
to one stack on mobile.

```
┌──────────── Inbox (untagged) — full width ─────────────┐
├──────────────────────┬─────────────────────────────────┤
│ YOURS                │ AGENT (read-only)               │
│ editableBy: user     │ editableBy: agent               │
│  ▸ …in `order`       │  ▸ …in `order`                  │
└──────────────────────┴─────────────────────────────────┘
```

The two columns **are** `editableBy`, so the visual structure is the permission model and the two can't
drift. Empty lanes simply don't render — a section appears when it has work.

The ping-pong (you act, the runner takes it right, hands it back left) is **the runner's to drive**. We
don't validate that control returns; a provider that strands its own work will notice immediately. What
we guarantee is that an unclaimed agent lane is always escapable (§5.2).

**The layout already exists.** `getLayoutConfig(tagCount, isMobile = true)` (`src/utils/layout.ts:29-40`)
emits "N rows × 1 column, in tag order" — the current mobile stack. The two-track view is that stack
rendered twice side by side. Three deltas:

1. **Order comes from the lane list, not frequency.** `getTopTags` (`src/domain/utils/tags.ts:69`) sorts
   by descending occurrence count, so sections would reshuffle as work moves — unusable for a flow.
2. **Untagged goes to the top, not the bottom.** Today untagged tasks render as "Other Tasks" _after_
   every tag section (`TaskLayout.tsx:192`). For a top-to-bottom flow an untriaged capture is the
   _start_. This is the one genuine inversion of existing behaviour.
3. **No lane cap.** `App.tsx:245` truncates to `isMobile ? 3 : 6`.

#### Board-type descriptor — the magic numbers come out of the code

```ts
interface BoardTypeConfig {
  layout: 'adaptive-grid' | 'two-track-flow'
  laneOrder: 'frequency' | 'declared'
  laneLimit: { mobile: number | null; desktop: number | null } // null = uncapped
  maxPerSection: number | null
  untaggedPosition: 'top' | 'bottom'
  untaggedLabel: string
  tagsEditable: boolean
}
```

| Setting            | `standard` (today, unchanged) | `automation`     |
| ------------------ | ----------------------------- | ---------------- |
| `layout`           | `adaptive-grid`               | `two-track-flow` |
| `laneOrder`        | `frequency`                   | `declared`       |
| `laneLimit`        | `{ mobile: 3, desktop: 6 }`   | `{ null, null }` |
| `maxPerSection`    | `10`                          | `null`           |
| `untaggedPosition` | `bottom`                      | `top`            |
| `untaggedLabel`    | `"Other Tasks"`               | `"Inbox"`        |
| `tagsEditable`     | `true`                        | `false`          |

Call sites to drain into it: `MAX_BOARDS` (`src/app/constants.ts:7`), the `isMobile ? 3 : 6` literal
(`App.tsx:245`), the grid shapes and `maxPerColumn: 10` in `getLayoutConfig` (`src/utils/layout.ts`),
and the "Other Tasks" placement (`TaskLayout.tsx:192`). **`standard` must reproduce today's rendering
exactly** — the existing e2e suite is the proof.

### 5.4 Activation is a migration, not a toggle

`POST /task/api/boards/:id/activate-automation` with `{ schemaId, schemaVersion, lanes[], dryRun }`.

- **`dryRun: true` changes nothing** and returns a preview: for each existing tag, how many tasks carry
  it and where it lands; which tasks fall through to the Inbox; any collision between a lane tag and an
  existing tag. The preview returns a digest the committing call must echo back, so an automated
  activation can't silently reshape a board nobody looked at.
- **Unmapped tags are cleared**, dropping the task into the untagged Inbox — genuinely untriaged under
  the new structure. Originals are preserved in `metadata.preAutomationTags`; nothing is discarded.
- **`boards.lanes` is replaced wholesale**; `schema_id` + `schema_version` recorded verbatim.
- **`previous_config` snapshots the board** so `deactivate-automation` restores the tag list. Revert
  restores _structure_, not per-task lanes — those are recoverable from `metadata.preAutomationTags`.
- **Re-activation is allowed while claims are live.** Refusing would mean a rollout across ~30 boards
  might never find a quiet moment. A claim is held on a _task_, not on a lane, so it survives. The only
  thing that must not happen is the board landing in a weird state, so:
  - Tasks sitting in a lane the new set removed are **cleared to the Inbox**, exactly like any other
    unmapped tag. Every task is always either in a valid lane or untagged — never in a phantom one.
  - A `release` naming a lane that no longer exists returns `422 LANE_UNKNOWN`. The runner aborts, the
    claim expires on its own, and the task is left somewhere real.
  - Enforcing that a runner's pipeline survives a lane rename is **not our job** — keeping the board
    consistent is.
- **Activation is owner-only**, including re-activation. A contributor drives work through a board; it
  cannot reshape one, and a compromised service key therefore cannot restructure someone's work. The
  cost is one coordination step: the owner applies the provider's lane set (§7.3). Providers roll a
  schema change by handing owners a new payload, not by pushing it themselves.
- **Updating the lane set is just activating again** with a bumped `schemaVersion`. Same endpoint, same
  preview, same rules — so a provider rolls a change across all its boards programmatically instead of a
  human re-doing 30 by hand.
- **Who may activate:** the provider over the API, or the user from the Edit Boards UI. Destructive
  either way, hence the mandatory preview.

### 5.5 One board per repo — scoped hydration is what makes it cheap

Board identity _is_ repo identity, which keeps each repo's work, lanes and stats genuinely isolated.

The objection to ~30 boards was never the boards — it was that `getBoards()` (`handlers.ts:40`) hydrates
tasks _and_ stats for **every** board on **every** load. Unbounded today (6 boards = 6 hydrations), 30×
at this scale, against a 246 ms / 998 ms baseline.

The fix: **hydration scope becomes "the pinned boards"**, so cold load is O(top-bar slots) — a constant.

| Call                                                 | Returns                                                              | Used by                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------- |
| `GET /boards`                                        | **Metadata only** — id, name, pinned, position, mode, repo. No tasks | The picker; cheap at any board count    |
| `GET /boards?hydrate=pinned` _(the app's cold load)_ | Metadata for all + full hydration for the ≤5 pinned                  | Website cold load                       |
| `GET /boards/{handle}`                               | **One board, fully hydrated** (lanes + tasks)                        | Switching to an unpinned board; runners |

- **Cold load gets faster than today**, not slower: O(all boards) → O(≤5), enforced by the same
  `TOPBAR_BOARD_SLOTS` constant that drives the tab list. Board count and page weight decouple for good.
- **Runners never call `GET /boards`.** A runner polls its own board by id. No fan-out, no cross-board
  scan — the isolation the per-repo split was for.
- **`boards.repo`** maps board → checkout from data, not by parsing a display name that will get renamed.
- Switching to an unpinned board costs one request, on demand.

`GET /boards/{handle}` doesn't exist today (`worker/src/routes/boards.ts:44`). It lands in T1, because
the hydration split is a storage concern, not a UI one.

### 5.6 The automation flow never completes or deletes

`complete` and `delete` archive a task — `closeTask` (`handlers-utils.ts:179`) splices it out of the
active list into the stats graveyard. That's a human's "I'm done with this", not a pipeline transition,
and this design does not touch it.

- The automation flow's only write to a task is **which lane tag it carries**. `release` cannot reach
  `completeTask`/`deleteTask`.
- **`state` is never changed by the automation flow.** A task parked in a provider's "done" lane is
  still `state: 'Active'` and still on the board.
- **The human buttons work exactly as today**, on automation boards too. A parked task is cleared by you.
- `complete_task` / `delete_task` **stay on MCP** — an agent doing what you explicitly asked is fine.
  They're simply not reachable from the lane flow.

### 5.7 Surface

Each gets an HTTP endpoint and a matching MCP tool (`TOOLS` in `worker/src/mcp/tools.ts`).

| Endpoint                                          | Purpose                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `GET  /task/api/boards/:handle`                   | One board, hydrated: lanes + tasks. How a runner sees its work    |
| `POST /task/api/agent/claim`                      | `{taskId, lane?, leaseSeconds?}` → `{token}` or `409 CLAIM_HELD`  |
| `POST /task/api/agent/heartbeat`                  | `{token}` → extend; `409 LEASE_LOST` if taken                     |
| `POST /task/api/agent/set-lane`                   | `{token, lane}` → move while holding the claim                    |
| `POST /task/api/agent/release`                    | `{token, lane, notes?, outcome?, ifCurrentLane?}` → move, unclaim |
| `GET  /task/api/agent/history?task=`              | Claim history, for display                                        |
| `GET  /task/api/changes?since=<cursor>`           | Change feed, so pollers stop full-scanning                        |
| `POST /task/api/boards/:id/activate-automation`   | Provider-supplied lane set (§5.1); `dryRun` previews              |
| `POST /task/api/boards/:id/deactivate-automation` | Restore structure from `previous_config`                          |
| `GET/POST/DELETE /task/api/boards/:handle/shares` | Owner-only: list, grant (by grantee key or userId), revoke (§7)   |
| `DELETE /task/api/boards/:handle/shares/me`       | **Grantee-only: leave a shared board** (§7.3)                     |

There is **no `/agent/eligible`**: deciding what's ready means knowing which lane feeds which job, which
is exactly the knowledge we don't hold. A runner fetches its board and filters however it likes.

The worker performs **no orchestration and holds no policy**. It knows four things: which lanes exist,
who may write each one, who holds a claim, and what the notes say.

---

## 6. `notes` — an explicit field

An explicit field, not a `metadata` convention, because a convention is unenforceable and un-editable
from the UI.

- `notes?: string | null` on `Task` (`src/domain/types.ts`), a real column on every task.
- An expandable markdown body on the task card (`src/components/TaskItem.tsx`).
- Readable/writable over HTTP and MCP (`get_task`, `update_task`, plus `set_task_notes` so a long plan
  doesn't round-trip the whole task).
- A runner that wants "don't start without a plan" checks `notes` before claiming — its rule, not a flag
  we store.
- Size-capped (~64 KB) → `413 NOTES_TOO_LARGE`.
- Claim history lives in `task_claim_log`, not here. `notes` never becomes a log file.

## 7. Shared boards

A board has one **owner** — the user key that created it. The owner may grant other user keys access at
one of two levels. This is how TenHands gets in: **a service key with `contributor` on the boards it
drives**, rather than borrowing your key.

| Level         | Can                                                         | Cannot                                                                                 |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `readonly`    | Read tasks, read lanes, filter                              | Any write at all                                                                       |
| `contributor` | Create/edit/move/complete tasks, claim + release, set notes | Delete the board, change board settings, activate/deactivate automation, manage shares |
| owner         | Everything                                                  | —                                                                                      |

Board settings, deletion, activation and share management are **owner-only**, deliberately: a
contributor drives work through a board, it does not get to redefine or destroy one.

### 7.1 Scoping: separate "who is asking" from "whose data"

Traced through the code, this is less invasive than it first looks, because **the scoping key is already
a parameter, not an assumption.** Every `Storage` method takes it explicitly
(`src/server/storage.ts:3-21` — `getTasks(userType, sessionId, boardId)` and friends), and
`auth.sessionId` is already the userId, not a session (`worker/src/index.ts:110-125`).

Today `auth.sessionId` means two things at once: _who is asking_ and _whose data_. Sharing splits them:

- **`callerId`** — the authenticated key's userId. Used for authorisation.
- **`ownerId`** — the board's owner. Used for storage scoping.

The minimal-blast-radius move: **resolve the board at the route edge and hand handlers an auth context
whose `sessionId` is already the owner's id**, plus `callerId` + granted level for the permission check.
`AuthContext.sessionId` keeps its existing meaning ("which data namespace"), so **the 16 handler
signatures and the whole `Storage` interface stay unchanged** — only `getContext()`
(`route-utils.ts:194`) grows a board-resolution step. That is one chokepoint, not 43 call sites.

Two places genuinely can't use a single owner scope:

**Board references are opaque handles.** Board `id` is a client-supplied slug (`CreateBoardInputSchema`,
`schemas.ts:209`) and **every user has a `main`** (`constants.ts:24`), so `/boards/main` is ambiguous the
moment anything is shared. Each board therefore carries a globally unique ULID `handle`, and that is what
the API takes: `/task/api/boards/{handle}`. Slugs stay as display identity and may keep colliding across
users; owner ids never appear in URLs. Existing boards get a handle backfilled in the T1 migration, and
routes accept a bare slug only as a legacy fallback resolved against the caller's own boards.

- **`GET /boards`** returns the union of owned + shared, so it queries across owners by design. This is
  the page-load authorisation surface: validate the key, then return what that key can reach. Each board
  carries `ownerUserId` and `access: 'owner' | 'contributor' | 'readonly'` so every client knows what it
  may offer before the user clicks anything.
- **`batchMoveTasks`** (`handlers.ts:432`) touches two boards. **Cross-owner moves are refused** —
  moving a task between two people's boards is a copy with different semantics, not a move. One owner
  per operation, enforced at resolution.

### 7.2 Pinning had to move (a bug this surfaced)

`pinned`/`position` were originally on the board row. Reading the structure showed that breaks the
moment a board is shared: **a grantee pinning a shared board would write the owner's row and change the
owner's top bar.**

So they live in **`board_prefs`, keyed by viewer** — owner and grantee alike get their own row. This is
also a closer fit to "pinned is per user-key" than the board row ever was, and the cold-load hydration
query is unchanged in shape: `board_prefs WHERE user_id = me AND pinned = 1`, joined to boards
regardless of who owns them. A shared board can be pinned, which it obviously must be.

### 7.3 What the UI must get right

- **Group the picker: "My Boards" and "Shared Boards"**, visually distinct. Ownership changes what the
  board can do, so it can't be invisible.
- **Owner-only affordances are hidden, not just refused, on shared boards.** Delete, rename, board
  settings, activate/deactivate automation, and share management do not appear. Same rule as §12.4 for
  Kate: never present an action we know statically will be rejected.
- **Granting identifies the grantee by their key, not their name.** In this ecosystem the operator
  issues keys, so the person granting access already holds the grantee's key — including TenHands'
  service key. That makes resolution exact and trivial: one `SESSIONS_KV.get('key:' + rawKey)` via
  `getKeyRecord` (`edge-router/src/registry.ts:73`), yielding `{name, tier, userId}`. Store the
  `userId` in `board_shares`; **never store the key**, and never log it.

  **The display name is output, not input** — it exists so the confirm step can say "grant _contributor_
  to **TenHands** (service tier)?" instead of showing a bare UUID. Name uniqueness is therefore
  irrelevant; the registry's "the key is the auth, name is metadata" (`registry.ts:60-71`) is exactly
  right and we don't fight it.

  Two consequences worth having on purpose:
  1. **No enumeration surface at all.** We never list the registry — one keyed `get`, never
     `KV.list({prefix:'key:'})`. Nothing here can be used to discover who exists, which matters because
     edge-router has no rate limiting and no precedent for exposing names to non-admin callers.
  2. **A raw `userId` is accepted as an alternative input**, for the case where the owner has the UUID
     but not the key.

  One real edge case survives: **`userId` is lazily minted** on first upsert (`registry.ts:144`), so a
  key that has been issued but never used has none. Granting to one must fail with "that key has never
  signed in" rather than writing a null share row.

  The mechanism is a **direct read-only `SESSIONS_KV` binding**, the established pattern here —
  `prefs-api` already binds the same namespace and reads `key:{rawKey}` for `record.userId`
  (`hadoku_site/workers/prefs-api/src/routes/admin.ts:122-152`, `wrangler.toml:41-46`). Worth knowing:
  the registry is `SESSIONS_KV` under a `key:` prefix (`registry.ts:4-6`) — there is no separate
  `KEY_REGISTRY_KV` despite what some planning docs claim — and `userId` is **not exposed over HTTP at
  all today**, not even to admins, so a route-based approach would have to build that first.

- **Leave a shared board.** A grantee must be able to remove their own access without involving the
  owner — `DELETE /task/api/boards/{ref}/shares/me`. It deletes the `board_shares` row and the viewer's
  `board_prefs` row. This is the one destructive-looking action a non-owner _can_ take, and it is
  destructive only to their own access.
- **Deleting a board that others share** is owner-only and takes their access with it; the preview
  should say how many people lose the board.
- `readonly` renders the board with every write affordance absent — not present-and-erroring.

### 7.4 It also fixes the agent-identity problem

With a service key, TenHands has **its own `user_id`**. That makes `task_claims.agent_id` and
`task_claim_log.agent_id` server-derived from the authenticated key rather than a self-declared string a
caller could put anything in. The audit trail stops being an honour system.

It composes cleanly with §5.2: a contributor still can't write an `editableBy: agent` lane except by
holding a claim, and still can't touch board settings. Two independent gates, neither trusting the
caller's word about who it is.

### 7.5 Sharing is not automation

The two are orthogonal and shouldn't be conflated: you can share a normal board with a person, and you
can have an automation board nobody else can see. TenHands happens to need both — a contributor grant
_and_ an activated board — but the features stand alone.

---

## 8. Edge cases

| Case                                            | Resolution                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two agents claim simultaneously                 | D1 conditional upsert (§4.1). Exactly one gets `changes === 1`; the other `409 CLAIM_HELD` + holder + expiry                                         |
| Agent dies mid-work                             | Lease expires, claim dropped, task stays put — re-claimable by the runner, draggable by you. No forced destination                                   |
| Agent hangs but the process lives               | It stops heartbeating; same path. If it revives it gets `409 LEASE_LOST`                                                                             |
| Agent replays `release`                         | Keyed by claim token — a second call with the same token is an idempotent no-op                                                                      |
| Agent replays `create`                          | `tasks_source` unique index enforces ingest-once at the DB level                                                                                     |
| Human retags a claimed task                     | Only possible in a `user` lane. `release` may pass `ifCurrentLane` → `409 LANE_CHANGED`. Opt-in, not imposed                                         |
| Human deletes a claimed task                    | Claim + log rows cascade. `release` → `404 TASK_NOT_FOUND`; the agent aborts                                                                         |
| Human edits title/notes mid-claim               | Allowed. UI shows a 🤖 badge with agent id + lease expiry so the edit is informed                                                                    |
| User drags **into** an agent lane               | `403 LANE_NOT_EDITABLE`. The layout refuses the drop target, so it never looks available                                                             |
| User drags **out of** an agent lane             | Refused while a claim is live; allowed once it expires, so a dead runner can't strand work                                                           |
| Agent tries to skip the queue                   | `update_task` into an agent lane → `403`. Agent lanes need a live token; identity is never trusted                                                   |
| Agent tries to complete/delete via the flow     | Unreachable — `release` only writes lane tags (§5.6)                                                                                                 |
| User adds/renames/deletes a tag                 | `409 BOARD_SCHEMA_LOCKED` on an automation board; UI hides the affordance too                                                                        |
| Lane tag collides with an existing tag          | Reported in the `dryRun` preview (§5.4); the existing tasks' tags are cleared into Inbox like any other unmapped tag                                 |
| Contributor tries to delete/reconfigure a board | Refused — owner-only (§7). A contributor drives work through a board; it doesn't get to redefine one                                                 |
| Free tag added on an automation board           | Refused. A task there carries exactly one tag and it is a lane (§5.2)                                                                                |
| Activation while claims are live                | **Allowed** (§5.4). A claim is held on a task, not a lane; tasks in removed lanes go to Inbox; a release naming a dead lane → `422 LANE_UNKNOWN`     |
| Provider renames a lane                         | Re-activation remaps it. Tasks are never silently retagged by a config edit alone                                                                    |
| Task ends up with 0 or 2 lane tags              | `422 LANE_INVALID` on write. On read the board flags it for repair rather than guessing                                                              |
| Board deleted with live claims                  | Claims + log rows cascade with the tasks (extends `deleteBoardData`, `route-utils.ts:166`)                                                           |
| Board deactivated with live claims              | Leases are honoured to expiry; no new claims granted                                                                                                 |
| A provider's "done" lane grows unbounded        | By design — it's a resting place. Cleared with the normal human complete/delete                                                                      |
| More lanes than the layout cap                  | `laneLimit: {null, null}` (§5.3) — nothing truncates, the flow just gets longer                                                                      |
| Clock skew between agent and server             | Expiry is server-assigned only; agents never send timestamps                                                                                         |
| Oversized plan                                  | `notes` capped (~64 KB) → `413 NOTES_TOO_LARGE` with the limit in the body                                                                           |
| Poller stampede                                 | Change-feed cursor instead of full scans; beyond that the existing throttle middleware (`index.ts:128`) returns `429 RATE_LIMITED` with `retryAfter` |

---

## 9. Board configuration UI (goal 1)

- `MAX_BOARDS` stops meaning "maximum boards" and becomes **top-bar slots** — rename to
  `TOPBAR_BOARD_SLOTS` so the constant stops lying.
- `BoardsSection.tsx:50` filters on `pinned` and sorts on `position` instead of `.slice(0, 5)`.
- `BoardsSection.tsx:53` stops gating board creation — the server never capped it anyway.
- New **Edit Boards** modal in `src/components/modals/`: create, rename, reorder, pin/unpin, delete.
- **The picker is grouped: "My Boards" and "Shared Boards"** (§7.3), visually distinct — ownership
  changes what the board can do, so it can't be invisible.
- **Owner-only affordances are absent on shared boards**, not present-and-erroring: delete, rename,
  board settings, activate/deactivate, share management. Plus a **Leave** action a grantee can take
  without the owner.
- **A searchable picker is load-bearing at ~30 boards**, not a nicety. The top bar holds the pinned few;
  everything else is reached by typing. Pinning also decides what gets hydrated on cold load (§5.5), so
  it has real performance meaning — worth saying in the UI copy rather than leaving it as a cosmetic
  favourite.
- Reordering is a board-metadata write and goes through the new board OCC — two devices reordering
  concurrently produce `409 VERSION_CONFLICT`, not a silent clobber; the loser re-pulls and retries.
- **Activation is the one destructive action here** and must not look like the others: a mandatory
  preview of the `dryRun` result before anything is written. In the common case the provider activates
  over the API and this UI just reflects it.

---

## 10. Tranches

| #      | Scope                                                                                                                                                                                                                                                                                                                                                        | Definition of done                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T0** | This doc + the TenHands handoff. Update `local-integration-design.md` (§11).                                                                                                                                                                                                                                                                                 | ✅ Design captured; nothing built.                                                                                                                                                                                                                                                                                  |
| **T1** | D1 foundation: migration (cross-repo), `createD1Storage()`, read-repair cutover, board OCC, `batchMoveTasks` → one `db.batch()`, scoped hydration + `GET /boards/:handle` + handle backfill, trim the 100-event timeline.                                                                                                                                    | Concurrency harness green (§11 below); KV→D1 read-repair proven; **cold load flat from 5 → 30 boards**; no regression vs baseline; existing e2e green. **Kate:** run the plugin against a D1 build — it exercises `If-Match`/`409` harder than the web client, which doesn't send `If-Match` at all.                |
| **T2** | Board config + Edit Boards UI: `board_prefs` pinned/position, rename, reorder, delete, searchable picker. `MAX_BOARDS` → `TOPBAR_BOARD_SLOTS`.                                                                                                                                                                                                               | 30 boards creatable and navigable; pinned set appears in chosen order; survives reload + cross-device sync; concurrent reorder → `409`. **Kate:** `pinnedBoards()` becomes a read-through of server state; one-shot push of the existing local `Boards/Pinned` (§12.2).                                             |
| **T3** | `notes` end to end: domain type, API, MCP (`set_task_notes`), expandable markdown body in `TaskItem.tsx`.                                                                                                                                                                                                                                                    | Notes round-trip web ↔ MCP; oversize → `413`; renders and edits in the browser. **Kate:** add `notes` to `domain.h` + the openapi parity test (§12.5); a Kate edit must not round-trip a task and drop `notes`.                                                                                                    |
| **T4** | Board-type descriptor (§5.3): drain `MAX_BOARDS`, the `isMobile ? 3 : 6` literal, `getLayoutConfig`'s shapes + `maxPerColumn`, untagged placement. Add `two-track-flow`.                                                                                                                                                                                     | `standard` renders exactly as before (existing e2e is the gate); `two-track-flow` renders Inbox-first, declared order, uncapped, two tracks desktop / one mobile.                                                                                                                                                   |
| **T5** | **Shared boards** (§7): `board_shares` + `board_prefs`, the read-only `SESSIONS_KV` binding in `hadoku_site/workers/task-api/wrangler.toml` (cross-repo, same as the D1 migration), owner-qualified board references, the authorisation step in `getContext()`, owner-only guards, grant-by-key resolution, leave-a-share, My/Shared grouping in the picker. | ✅ **Backend + MCP shipped & prod-verified 2026-07-24** (`worker/test/shared-boards-verify.ts`, 36 checks over HTTP **and** MCP): a `contributor` service key reads + writes a board it doesn't own (writes land in the owner's namespace), share management is owner-only, `readonly` writes → 403/isError, grant-by-key resolves via the live `SESSIONS_KV` binding, leave works. A shared handle resolves identically on HTTP and MCP via `resolveBoardCtx`. **Deferred (UI, not blocking TenHands):** My/Shared picker grouping, hiding readonly write affordances, shared-board pinning through `board_prefs`, and an explicit owner-only 403 on board rename/delete (today a grantee's attempt resolves harmlessly to their own namespace). **Kate:** unchanged — it only ever acts as the owner. |
| **T6** | ✅ **Backend shipped 2026-07-24** (`worker/test/automation-verify.ts`, 44 checks over HTTP + MCP). `activate-automation` (owner-only) + provider lane set, structural validation, `dryRun`+digest gate, tag→lane migration (unmapped → Inbox, original kept in `metadata.preAutomationTags`), `previous_config` snapshot, re-activation in place, `deactivate`. Human-path lane writes gated (agent lane → 403 `LANE_NOT_EDITABLE`, non-lane → 422 `LANE_INVALID`); `createTag`/`deleteTag`/`batchClearTag` → 409 `BOARD_SCHEMA_LOCKED`; `mode`+`lanes` on GET /boards + MCP. **Deferred:** two-track render UI; writing INTO an agent lane (needs a claim token, → T7 — until then agent lanes are enter-by-nobody / escapable-by-hand per §5.2).                                                                                                                                                                    | A provider can define any lane vocabulary and it works end to end; preview matches reality; re-activation updates in place; user drag into an agent lane → `403`. **Kate:** hide `createTag`/`clearTagEverywhere` on automation boards; restrict quick-add `#tag` autocomplete to `editableBy: user` lanes (§12.4). |
| **T7** | ✅ **Backend shipped 2026-07-24** (`worker/test/agent-claim-verify.ts`, 37 checks over HTTP + MCP). Atomic claim (conditional upsert, `meta.changes` = CAS) / heartbeat / set-lane / release + `task_claim_log` + change feed (§4.4, zero extra writes — `createTask` now stamps `updatedAt`). Full loop over HTTP + MCP; concurrent-claim proof (5 → exactly one winner, rest 409 `CLAIM_HELD`); a live lease is unstealable, an expired one is stealable and its old token → `LEASE_LOST`; `release` idempotent on token, `ifCurrentLane` → 409 `LANE_CHANGED`, never touches task `state`; MCP + `onError` forward the structured `code` (+ holder/expiresAt/currentLane) per §4.3. **Deferred:** the 🤖 claimed badge (UI). | Full loop live over MCP: claim → set-lane → release to a named lane. Concurrent-claim test proves one winner. Expired claim leaves the task rescuable, not stranded. **Kate:** show a claimed task as claimed (agent + expiry) instead of letting a user edit blind. |
| **T8** | Agent-facing hardening: structured MCP error codes, pagination on `list_tasks`, board/tag write tools, `actor` attribution on events, documented limits. Update `docs/MCP.md` + `docs/API.md`.                                                                                                                                                               | An agent can distinguish every code in §4.3 and retry correctly; docs match reality.                                                                                                                                                                                                                                |

**Out of scope:** the runner itself. This repo publishes the contract; runners live elsewhere.

---

## 11. Verification

Typecheck, lint and build are **not evidence**. Every tranche proves itself at runtime.

**Concurrency, for real** (T7). Extend `worker/test/phase0-verify.ts` — it already boots the real
`createTaskHandler()` and drives `app.request()` — to run against miniflare's local D1 (real SQLite):

- N concurrent `claim`s on one task → **exactly one** `200`, the rest `409 CLAIM_HELD`.
- A live lease cannot be stolen; an expired one can.
- `heartbeat` with a stale token → `409 LEASE_LOST`.
- `release` replayed with the same token → idempotent success, the lane moves exactly once.
- `release` with a stale `ifCurrentLane` → `409 LANE_CHANGED`, writes nothing.
- An expired claim leaves the task draggable by a human; a live one does not.
- `release` never changes `state` and never reaches `completeTask`/`deleteTask` (§5.6) — the task is
  still `Active` and still on the board afterwards.
- **Board OCC (T1):** two concurrent board-metadata writes (rename, reorder, pin) → one `200`, one
  `409 VERSION_CONFLICT` carrying the current version, and the losing write is **not** applied. This is
  the gap §2.2 exists to close, so it needs its own assertion rather than riding on the task-level tests.

**Lane enforcement, from every angle** (T6). Test the bypasses, not the happy path:

- `PATCH /:id` writing an `editableBy: agent` lane → `403 LANE_NOT_EDITABLE`.
- MCP `update_task` doing the same → `403`. **This is the one that matters**: it proves an agent is
  refused on the human path exactly like a human, so the guarantee doesn't rest on trusting `agent_id`.
- Batch tag ops writing an agent lane → `403`.
- `createTag` / `deleteTag` / `batchClearTag` on an automation board → `409 BOARD_SCHEMA_LOCKED`.
- A task written with zero or two lane tags → `422 LANE_INVALID`.

**Activation, dry run vs real** (T6). Seed a board with messy tags, run `dryRun`, then commit and assert
the outcome is exactly what the preview promised; `metadata.preAutomationTags` retains the originals;
activation is refused while a live claim exists; a lane/tag collision is reported, not silently merged.

**Cutover safety** (T1). Seed KV blobs, read through the D1 adapter, assert rows materialised
field-for-field and that the second read never touches KV. Include a user still on the pre-flip
raw-credential namespace (`legacyId`) to prove the double hop.

**Perf, and flatness in board count** (T1). `pnpm run profile` against the `docs/PROFILING.md` baseline —
tasks on screen **246 ms**, total API **998 ms**. Regression blocks the tranche. Then the stronger
assertion the per-repo decision demands: **profile at 5 boards and at 30, and the numbers must be within
noise.** If cold load scales with board count at all, scoped hydration isn't working and 30 repos will
be unusable — so this belongs in the regression guard, not a one-off check.

**Sharing** (T5). The authorisation surface is `GET /boards`, so test it there: a grantee's board list
contains exactly owned + shared, each labelled with `ownerUserId` and `access`; a `readonly` key gets
`403` on every write; a `contributor` is refused on delete/settings/activate/share-management but
succeeds on task writes; a grantee pinning a shared board leaves the owner's `board_prefs` untouched; a
grantee can leave unaided and the board disappears from their list; a cross-owner `batchMoveTasks` is
refused. In the browser: shared boards never render a delete or settings affordance.

**UI, in a browser.** Playwright in `e2e/`: with 30 boards the top bar shows exactly the pinned ones in
order, the rest are reachable through the picker, switching to an unpinned board fetches on demand, and
it survives reload. For automation boards:

- Sections render top-to-bottom in declared order, and **that order does not change as tasks move**.
- **Inbox renders first**, above every lane — not last as "Other Tasks" does today.
- **Nothing truncates at mobile viewport**; no horizontal scrolling anywhere. **This is a release
  gate, not a nicety** — mobile is a live WebView on prod (§12), so there is no staged rollout between
  a layout regression and every phone.
- Dragging onto an agent lane is refused outright, not optimistically applied and snapped back.
- **`standard` boards render exactly as today** — the likeliest regression from the T4 refactor.
- `e2e/board-switch-race.spec.ts` and `e2e/data-sync.spec.ts` stay green through the D1 flip; they are
  the net for the storage swap.

**Live MCP** (T7). Drive the deployed `/task/api/mcp` with curl through the full loop: create → claim →
set-lane → release to a named lane → verify the lane moved, notes persisted, `task_claim_log` row closed.

**Deploy ordering.** The usual chain (push → publish → dispatch → hadoku_site → prod). Two cross-repo
prerequisites, both in hadoku_site and both must land **before** the package version that needs them:
the **D1 migration** (T1) and the read-only **`SESSIONS_KV` binding** on `workers/task-api/wrangler.toml`
(T5, namespace `d2b6af9765194ceeaee92b639505ac1f`, mirroring `prefs-api`).

---

## 12. Client surfaces — there are two, not three

| Surface     | What it is                                                                                                                                                      | Propagation cost                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Browser** | The React app in this repo                                                                                                                                      | —                                 |
| **Mobile**  | A Capacitor **WebView pointing at `https://hadoku.me/task/`** (`capacitor.config.ts:8`). No UI of its own; `MainActivity.java` only injects a last-URL tracker. | **Zero** — it _is_ the browser UI |
| **Kate**    | A real native client: 604-line `TaskApiClient`, `TaskStore`, Tasks + Calendar tool views                                                                        | Real — §12.2 onward               |

**Mobile costs nothing, with one caveat that raises the stakes elsewhere.** Because it's a live WebView
on prod there is **no app-release gate**: whatever ships to the site is on phones immediately. A layout
regression can't be caught by a staged rollout, so the mobile-viewport assertions in §11 are the only
thing between a bad `two-track-flow` and every phone. That makes them a release gate, not a
nice-to-have.

The shape is already right: `two-track-flow` collapses to a single stack on mobile (Inbox → your lanes
→ agent lanes) and automation boards set `laneLimit: {null, null}` so nothing truncates. Mobile really
is just an ordering change — which holds precisely _because_ the two tracks are ordered lists rather
than a horizontal board.

`plugins/kate/` is the only surface with real propagation cost. It is **not** the skeleton its own
design doc describes: it is a working second entry point for creating tasks and editing boards, and
every tranche here has to keep it working.

### 12.1 Kate: what it already does that we benefit from

- **It never used the hydrated `GET /boards` payload.** It reads only `id`, `name`, `tags` from
  `/boards` (`taskapiclient.cpp:169-181`) and fetches tasks separately via `GET /tasks?boardId=`. The
  scoped-hydration split of §5.5 is therefore the access pattern Kate already uses — the metadata-only
  `GET /boards` is a no-op for it, not a break.
- **It already implements the OCC contract.** It holds the board `version`, presents `If-Match`, and on
  `409` re-syncs from `currentVersion` and retries (`taskapiclient.cpp:374-387`). The D1 migration must
  preserve this byte-for-byte; it is the strongest reason the storage swap keeps the existing
  `version`/`If-Match` semantics rather than inventing new ones.
- **It serialises its own writes** through an enqueue, so it won't self-race.

### 12.2 Kate: pinned boards move to the server

Kate already solved "many boards, few in the bar" — a pinned set plus an overflow menu
(`TaskToolbar.qml:17,41-48,155`), persisted per-machine in `QSettings` under `Boards/Pinned`
(`sessionmanager.cpp:84-95`). That predates this design and is now the wrong home for it.

**Decided: `pinned` is server state, scoped per user-key.** The board rows are already keyed by the
stable `user_id` (§3.4), so `boards.pinned` is per-user-key for free. One source of truth across
browser, mobile and Kate — you pin a board on your phone and Kate's bar reflects it.

That matters more than tidiness here, because `pinned` is not cosmetic in this design: it selects the
cold-load hydration set (§5.5). A device-local pin list would mean each client hydrating a _different_
set of boards, which makes the perf property in §11 unverifiable — you could never say "cold load is
O(pinned)" and mean anything by it.

Consequences for the plugin, in T2:

- `SessionManager::pinnedBoards()` / `setPinnedBoards()` stop being the source of truth.
  `pinnedBoards()` becomes a read-through of the board list; `setPinnedBoards()` becomes a board write
  (and therefore goes through board OCC — a `409` is possible and must be handled like any other write).
- `QSettings` `Boards/Pinned` may stay as an **offline display cache only**, never authoritative.
- **One-shot migration:** on first launch after the upgrade, if the server has no pinned boards set for
  this user and local `Boards/Pinned` is non-empty, push the local list up once, then stop reading it as
  truth. Without this a user silently loses the bar they curated.

### 12.3 What has to propagate to Kate, per tranche

| Tranche | Impact on the plugin                                                                                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1**  | None expected — same HTTP contract, same `version`/`If-Match`. **This is a claim to verify, not assume**: the plugin is the best regression test for the storage swap and should be run against a D1 build. |
| **T2**  | Resolve the pinned conflict (§12.2). If `pinned` becomes server state, `SessionManager::pinnedBoards()` becomes a read-through rather than the source of truth.                                             |
| **T3**  | `Task` (`plugins/kate/src/domain.h:11`) has no `notes` field. Additive — the plugin ignores it until updated — but a task edited in Kate must **not** round-trip a task and drop `notes`.                   |
| **T4**  | Layout work is web-only. Kate has its own QML layout and is unaffected.                                                                                                                                     |
| **T6**  | **The real work.** Kate can currently create tags, delete tags, create boards, and quick-add with `#tags` parsed from free text. On an automation board every one of those can now legitimately fail.       |
| **T7**  | Read-only: Kate should show a task is claimed (agent + expiry) rather than letting a user edit blind. It never needs to claim anything itself.                                                              |

### 12.4 T6 is where Kate actually breaks

Concretely, on an automation board:

- `createTag` (`POST /tags`) and `clearTagEverywhere` (`POST /batch-clear-tag`,
  `taskapiclient.cpp:523-551`) will return **`409 BOARD_SCHEMA_LOCKED`**. Today the plugin surfaces
  errors through a generic `errorOccurred` — it needs to hide these affordances on automation boards
  instead of offering an action that always fails.
- **Quick-add is the sharp edge.** The entry field parses `#tags` out of free text
  (`TaskToolbar.qml:14`), so a user can type `Fix the thing #working` and land a task directly in an
  agent lane. That must be refused (`403 LANE_NOT_EDITABLE`) and, better, prevented — the tag
  autocomplete should offer only `editableBy: user` lanes.
- The tag-filter chip row is fed by `recomputeAllTags()` from board tags + task tags. On an automation
  board the lane list is the structure, and chips should reflect lanes, not arbitrary tags.

**Minimum bar for T6:** Kate must never present an action that the server will reject. Degrading
gracefully (an error toast) is not sufficient when we know statically that the affordance is invalid.

### 12.5 Drift guard

`domain.h` is a hand-written mirror of `src/domain/types.ts`, with a CI parity test vs `openapi.json`
noted as "later" and still not built. Three tranches here add fields to `Task` and `Board`
(`notes`, `pinned`, `position`, `mode`, `lanes`). That parity test stops being optional — schedule it
in T3, the first tranche that widens `Task`.

---

## 13. Relationship to `local-integration-design.md`

Phase 0 of that doc (task `version` + `If-Match` + `409`) is **kept, not reverted** — it stays the
concurrency contract for task content, and the Kate plugin's `TaskApiClient` needs no change.

Superseded:

- **"Source of truth: Cloudflare KV"** → D1 (§3). The HTTP contract is unchanged, so the plugin is
  unaffected.
- **"Write safety"** — its escape hatch was "true CAS = Durable Object (deferred)". D1 is the exit, and
  it was already bound.
- **§4 item 4** — "keep the in-memory per-instance `withBoardLock`". Once content is in D1 that lock is
  dead weight and should be deleted rather than left as false comfort.

Item 5 ("later, optional: migrate the web client to send `If-Match`") becomes _more_ valuable: with D1
the `409` is trustworthy rather than probabilistic.
