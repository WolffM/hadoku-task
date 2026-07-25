# MCP Server

The task service exposes a **remote [MCP](https://modelcontextprotocol.io) server** so
agents can manage tasks and the calendar across workstreams.

- **Endpoint:** `https://hadoku.me/task/api/mcp`
- **Transport:** stateless **Streamable HTTP** — one JSON-RPC request per `POST`, no
  sessions and no Durable Objects (cheap + fast; reuses the worker's in-process
  handlers and KV/D1).
- **Source:** `worker/src/mcp/` — `tools.ts` (transport-agnostic tool definitions) and
  `handler.ts` (the JSON-RPC-over-HTTP handler). Mounted in `worker/src/index.ts`.

`GET` on the endpoint returns `405` (this stateless server offers no server→client SSE
stream); compliant clients fall back to `POST` request/response.

> **HTTP + OpenAPI.** Everything below is also a plain HTTP endpoint (see [API.md](API.md)).
> The full surface — tasks, boards, sharing, automation, and the agent claim protocol —
> is described by a **zod-generated OpenAPI spec at `GET /task/api/openapi.json`**, so a
> non-TS consumer (e.g. Python) can codegen a client and catch drift at build time. The
> spec is generated from the same schemas that validate requests, so it can't fall out of
> sync with the server.

## Auth & routing

The endpoint sits behind edge-router at `/task/api/*`, so it uses the **same auth as the
rest of the task API**: send `X-User-Key`. Edge-router authenticates the key, stamps the
tier + `X-Edge-Auth`, and forwards. Task storage is **scoped by that key** (KV key
`tasks:{X-User-Key}:{board}`), so a request reads/writes the calendar belonging to that
key. Use **your own task key** (the same identity your task app resolves to) — a
different key would address a separate, isolated calendar.

`initialize` and `tools/list` don't touch storage and answer without a key; any
`tools/call` that reads/writes data is scoped by the key.

> A prettier `mcp.hadoku.me/task` alias can be added later as a thin edge-router route to
> this same endpoint — no changes here are required.

## Connecting (Claude Code)

```bash
claude mcp add --transport http hadoku-tasks https://hadoku.me/task/api/mcp \
  --header "X-User-Key: $HADOKU_TASK_KEY"
```

Keep the key in an env var / secret; never hardcode it.

## Tools

All task tools default to the **`main`** board unless a `board` argument is given. For a
board **shared with you**, address it by its **`handle`** (from `list_boards`), not its
slug — a slug only ever resolves within your own tasks (see [Shared boards](#shared-boards)).

### Tasks

| Tool             | Arguments                                                                                  | Purpose                                                         |
| ---------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `list_tasks`     | `board?`, `date?` (`YYYY-MM-DD`), `tag?`, `limit?`, `offset?`                              | List active tasks; optional day / tag filter; **paginated**     |
| `get_task`       | `id`, `board?`                                                                             | Fetch one task                                                  |
| `create_task`    | `title`, `notes?`, `tag?`, `date?`, `startTime?`, `endTime?`, `metadata?`, `board?`        | Create a task                                                   |
| `update_task`    | `id`, `title?`, `notes?`, `tag?`, `date?`, `startTime?`, `endTime?`, `metadata?`, `board?` | Update only the fields passed                                   |
| `set_task_notes` | `id`, `notes`, `board?`                                                                    | Replace a task's markdown body / plan (§6). `""` clears it      |
| `schedule_task`  | `id`, (`startTime`+`endTime`) \| `date` \| `clear:true`, `board?`                          | Put a task on the calendar (timed or all-day), or unschedule it |
| `complete_task`  | `id`, `board?`                                                                             | Mark complete (removes from active list)                        |
| `delete_task`    | `id`, `board?`                                                                             | Delete                                                          |

### Boards

| Tool           | Arguments    | Purpose                                                                                           |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| `list_boards`  | —            | Your boards + any shared with you; each row carries `handle`, `access`, `mode`, `lanes`           |
| `get_board`    | `board`      | One board fully hydrated: metadata (`repo`, `mode`, `lanes`) + every task, each flagged `claimed` |
| `create_board` | `id`, `name` | Create a board (your own). Slug in, unique `handle` minted server-side                            |

### Notes (`list_tasks` pagination)

`list_tasks` returns `{ board, count, total, offset, limit, nextOffset, tasks }`. Page a
large board by passing `offset` = the previous `nextOffset` until it comes back `null`.
`limit` defaults to 100, max 500.

### Agent claim protocol

For **safe multi-agent work** on a board: claim a task (atomic — exactly one winner),
heartbeat to hold the lease, move it between lanes, and release it to a destination lane
with notes. See [Automation boards & the claim loop](#automation-boards--the-claim-loop).

| Tool                | Arguments                                                                                              | Purpose                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `claim_task`        | `taskId`, `board?`, `agentId?`, `lane?`, `leaseSeconds?`                                               | Atomically claim; `CLAIM_HELD` if a live lease exists                          |
| `heartbeat_claim`   | `taskId`, `token`, `board?`, `leaseSeconds?`                                                           | Extend the lease; `LEASE_LOST` if it was taken                                 |
| `set_lane`          | `taskId`, `token`, `lane`, `board?`                                                                    | Move a task while holding the claim (agent path — `agent` lanes ok)            |
| `release_claim`     | `taskId`, `token`, `lane?`, `notes?`, `metadata?`, `outcome?`, `ifCurrentLane?`, `complete?`, `board?` | Move + write notes/metadata + unclaim; `complete:true` archives it; idempotent |
| `cancel_claim`      | `taskId`, `board?`                                                                                     | **Owner-only:** force-drop a stuck claim; the holder then gets `LEASE_LOST`    |
| `get_claim_history` | `taskId`, `board?`                                                                                     | Who claimed it when, and how each claim ended                                  |
| `list_changes`      | `since?` (`"<updatedAt>,<id>"`), `limit?`                                                              | Change feed — poll instead of full-scanning; returns a `cursor`                |

### Scheduling model

A task occupies one of three states, mirroring the calendar data model:

- **Timed event** — `startTime` + `endTime` (ISO 8601, UTC), e.g. `2026-06-10T17:00:00.000Z`.
- **All-day task** — `date` only (`"YYYY-MM-DD"`).
- **Board-only task** — none of the above (appears on the board, not the calendar).

`tag` is a space-separated string (`"work urgent"`). `metadata` is arbitrary JSON for
provider/event detail. Tasks ingested from other apps additionally carry `source` and
`sourceId`; they behave like any other task here.

## Shared boards

A board's owner can grant you `contributor` (read + write tasks) or `readonly` access to a
board you don't own. It then appears in your `list_boards` with `access` set accordingly
and an `ownerUserId`. **Address a shared board by its `handle`, never a slug** — slugs
resolve only within your own tasks, so passing the owner's slug would reach your own
(empty) board of that name, never theirs. A `readonly` grantee's writes are refused
(`FORBIDDEN`); a `contributor`'s task writes land in the owner's board. Granting, listing,
and revoking shares are **owner-only** and done over HTTP (`/task/api/boards/:ref/shares`),
not MCP.

## Automation boards & the claim loop

An **automation board** (`mode: "automation"` in `list_boards`) replaces freeform tags with
a fixed, ordered **lane** vocabulary the board owner activated. Each lane is
`{ tag, label, order, editableBy }`; `editableBy` is `"user"` or `"agent"`.

**Two write paths, gated by endpoint** (not by a self-declared identity):

- **Human path** — `create_task` / `update_task` (and the app's drag): may land a task only
  in a **`user`** lane. Into an `agent` lane → `LANE_NOT_EDITABLE` (403); a non-lane tag →
  `LANE_INVALID` (422). Clearing the tag (→ Inbox) is always allowed.
- **Agent path** — `claim_task` / `set_lane` / `release_claim`: needs a **live claim token**
  and may write **any** lane, including `agent` lanes.

The loop a runner drives:

1. `list_boards` → find your board (by `repo`/`handle`) and read its `lanes`.
2. `list_tasks` (or `list_changes`) → pick a task in a trigger lane.
3. `claim_task { taskId, lane: "<working-lane>" }` → get `{ token, expiresAt }`, or
   `CLAIM_HELD` (another agent has it — move on).
4. `heartbeat_claim { taskId, token }` before `expiresAt` to keep the lease.
5. `set_task_notes` / `set_lane` as the work progresses.
6. `release_claim { taskId, token, lane: "<next-lane>", notes, ifCurrentLane: "<working-lane>" }`
   → moves the task, writes your result, unclaims. `ifCurrentLane` aborts with `LANE_CHANGED`
   if a human retagged it under you. Replaying `release_claim` with the same token is a safe
   no-op.

If your lease expires, the claim simply drops — the task becomes claimable again and stays
where it is. The worker runs no orchestration and holds no policy: it hands out leases and
records outcomes. There is no "eligible" query — you decide what's ready from the lanes.

## Error codes

Tool failures return `isError: true` with a `structuredContent.code` you can act on:

| Code                                 | HTTP | Do                                                                |
| ------------------------------------ | ---- | ----------------------------------------------------------------- |
| `CLAIM_HELD`                         | 409  | Another agent holds a live claim (`holder`, `expiresAt`). Move on |
| `LEASE_LOST`                         | 409  | Your lease was taken. Abort immediately, write nothing            |
| `LANE_NOT_EDITABLE`                  | 403  | Wrong path for this lane (human path → `agent` lane). Never retry |
| `LANE_UNKNOWN`                       | 422  | Destination isn't a lane on this board. Fix the caller            |
| `LANE_INVALID`                       | 422  | Task carried zero or two lane tags. Repair, don't retry           |
| `LANE_CHANGED`                       | 409  | `ifCurrentLane` didn't match — a human retagged it. Re-read       |
| `BOARD_SCHEMA_LOCKED`                | 409  | Lane structure is frozen on an automation board. Never retry      |
| `DIGEST_MISMATCH`                    | 409  | Activation preview is stale. Re-run the dry-run                   |
| `VERSION_CONFLICT`                   | 409  | Re-pull and retry                                                 |
| `NOTES_TOO_LARGE`                    | 413  | Truncate or link out; don't retry unchanged                       |
| `RATE_LIMITED`                       | 429  | Back off per `retryAfter` (seconds). Service tier: 600/min        |
| `TASK_NOT_FOUND` / `BOARD_NOT_FOUND` | 404  | Abort; treat as already handled                                   |
| `FORBIDDEN`                          | 403  | Readonly access, or an owner-only action. Never retry             |

**Rate limits.** Trusted human tiers (`friend`, `admin`) aren't throttled. The **`service`**
tier — the credential class an autonomous agent authenticates with — is capped at **600/min**
(10/sec), far above a normal poll+claim+heartbeat loop; exceeding it returns `429` with
`code: "RATE_LIMITED"` and a `retryAfter`. `public` is 60/min. Authenticate with a **service-tier
key** so a burst can't blacklist you like a browser session.

## Tool results

`tools/call` returns both a human-readable `content` text block and a machine-readable
`structuredContent` (the task or list). Tool-level failures come back as a result with
`isError: true` (so the model sees the message) rather than as a transport error;
protocol errors (e.g. unknown method) use standard JSON-RPC error codes.

## Examples

`initialize`:

```bash
curl -s -X POST https://hadoku.me/task/api/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{}}}'
```

Create a timed event:

```bash
curl -s -X POST https://hadoku.me/task/api/mcp \
  -H 'Content-Type: application/json' -H "X-User-Key: $HADOKU_TASK_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
        "name":"create_task",
        "arguments":{"title":"Design review","startTime":"2026-06-10T17:00:00.000Z",
                     "endTime":"2026-06-10T18:00:00.000Z","tag":"work"}}}'
```

List a day:

```bash
curl -s -X POST https://hadoku.me/task/api/mcp \
  -H 'Content-Type: application/json' -H "X-User-Key: $HADOKU_TASK_KEY" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
        "name":"list_tasks","arguments":{"date":"2026-06-10"}}}'
```

## Adding a tool

Add an entry to the `TOOLS` array in `worker/src/mcp/tools.ts` (name, description,
JSON-Schema `inputSchema`, and a `handler(args, ctx)` that calls the shared
`TaskHandlers`). The handler picks it up automatically; no protocol changes needed.
