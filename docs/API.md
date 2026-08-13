# API Reference

Complete endpoint documentation for implementing the Task Manager backend.

> **Note**: This document is for backend implementers. For integration examples, see [README.md](../README.md).

---

## Authentication

**This micro-frontend delegates authentication to your parent application.**

### Your Responsibilities

1. **Validate authentication keys/tokens** in your backend
2. **Provide `userType` and `sessionId`** to the task app via props
3. **Secure all API endpoints** - validate auth headers before processing
4. **Handle user login/logout** in your application

### Request Headers

All authenticated endpoints should include:

```http
X-User-Type: public | friend | admin
X-Session-Id: <unique-session-identifier>
```

---

## Storage Interface

Implement this interface for your storage backend:

```typescript
interface TaskStorage {
  getTasks(userType: UserType): Promise<TasksFile>
  saveTasks(userType: UserType, tasks: TasksFile): Promise<void>
  getStats(userType: UserType): Promise<StatsFile>
  saveStats(userType: UserType, stats: StatsFile): Promise<void>
}
```

**Implementations:**

- Cloudflare Workers KV
- Filesystem (Node.js)
- Database (SQL/NoSQL)
- In-memory (testing)

---

## Task Endpoints

### Addressing a board

Every task endpoint takes the board the SAME way, so an integration that hits more
than one of them encodes the board once:

- as a **query parameter** — `?board=<ref>` (or the older `?boardId=<ref>`) — on
  every task route, and
- in the **body** — `"board": "<ref>"` (or `"boardId"`) — on the routes that carry
  one. The body wins when both are present.

Omitted, it defaults to `main`. A `<ref>` is your own board's id, or the globally
unique `handle` of a board shared with you (`GET /boards` returns both, plus your
`access` level on each). A bare slug ALWAYS resolves inside your own namespace, so
passing someone else's board id can never reach their data.

---

### GET `/`

Get all active tasks for a board.

**Query Parameters:**

- `userType` (optional): `public` | `friend` | `admin`
- `boardId` (optional): Board ID (default: `main`)

**Response:**

```json
{
  "tasks": [
    {
      "id": "01HQ...",
      "title": "Task title",
      "tag": "work home",
      "state": "Active",
      "createdAt": "2025-10-27T12:00:00Z",
      "updatedAt": "2025-10-27T12:00:00Z",
      "closedAt": null,
      "startTime": "2025-10-27T14:00:00Z",
      "endTime": "2025-10-27T15:00:00Z"
    }
  ]
}
```

**Note:** `startTime` and `endTime` are optional. Tasks without these fields are classic board tasks that won't appear in calendar views.

---

### POST `/`

Create a new task.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "title": "Task title",
  "tag": "work",
  "boardId": "main",
  "startTime": "2025-10-27T14:00:00Z",
  "endTime": "2025-10-27T15:00:00Z"
}
```

| Field       | Type           | Required | Description                               |
| ----------- | -------------- | -------- | ----------------------------------------- |
| `title`     | string         | Yes      | Task title                                |
| `tag`       | string         | No       | Space-separated tags                      |
| `boardId`   | string         | No       | Target board (default: "main")            |
| `startTime` | string \| null | No       | Scheduled start time (ISO 8601)           |
| `endTime`   | string \| null | No       | Scheduled end time or deadline (ISO 8601) |

**Response:**

```json
{
  "id": "01HQ...",
  "title": "Task title",
  "tag": "work",
  "createdAt": "2025-10-27T12:00:00Z",
  "updatedAt": "2025-10-27T12:00:00Z",
  "startTime": "2025-10-27T14:00:00Z",
  "endTime": "2025-10-27T15:00:00Z"
}
```

---

### PATCH `/:id`

Update a task's title, tags, or scheduling.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**URL Parameters:**

- `id`: Task ID (ULID format)

**Body:**

```json
{
  "title": "Updated title",
  "tag": "new-tag",
  "boardId": "main",
  "startTime": "2025-10-27T16:00:00Z",
  "endTime": null
}
```

| Field       | Type           | Required | Description                    |
| ----------- | -------------- | -------- | ------------------------------ |
| `title`     | string         | No       | New task title                 |
| `tag`       | string         | No       | New tags (space-separated)     |
| `boardId`   | string         | No       | Board ID (default: "main")     |
| `startTime` | string \| null | No       | New start time (null to clear) |
| `endTime`   | string \| null | No       | New end time (null to clear)   |

**Response:**

```json
{
  "id": "01HQ...",
  "title": "Updated title",
  "tag": "new-tag",
  "updatedAt": "2025-10-27T12:30:00Z",
  "startTime": "2025-10-27T16:00:00Z",
  "endTime": null
}
```

---

### POST `/:id/complete`

Mark a task as completed (moves to stats graveyard).

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**URL Parameters:**

- `id`: Task ID

**Query Parameters:**

- `boardId` (optional): Board ID (default: `main`)

**Example:**

```
POST /task/api/01HQ.../complete?boardId=work
```

**Response:**

```json
{
  "ok": true,
  "message": "Task 01HQ... completed"
}
```

---

### DELETE `/:id`

Permanently delete a task.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**URL Parameters:**

- `id`: Task ID

**Query Parameters:**

- `boardId` (optional): Board ID (default: `main`)

**Example:**

```
DELETE /task/api/01HQ...?boardId=work
```

**Response:**

```json
{
  "ok": true,
  "message": "Task deleted"
}
```

---

## Board Endpoints

### GET `/boards`

Get all boards for the current user.

**Query Parameters:**

- `userType` (optional): `public` | `friend` | `admin`
- `sessionId` (optional): Session identifier

**Response:**

```json
{
  "version": 1,
  "updatedAt": "2025-10-27T12:00:00Z",
  "boards": [
    {
      "id": "main",
      "name": "Main Board",
      "tags": ["work", "home"],
      "tasks": [...],
      "stats": {...},
      "calendar": {
        "ref": "main",
        "name": "Main Board",
        "canWrite": true,
        "scheduled": 3
      }
    }
  ]
}
```

Every board carries its `calendar` (see [Board Calendars](#board-calendars)).
`calendar.ref` is the reference to address that board by — for a board shared with
you it is the handle, so a client never has to work out which reference resolves.

---

### POST `/boards`

Create a new board.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "id": "project-x",
  "name": "Project X"
}
```

**Response:**

```json
{
  "id": "project-x",
  "name": "Project X",
  "tags": [],
  "tasks": []
}
```

---

### DELETE `/boards/:id`

Delete a board and all its tasks.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**URL Parameters:**

- `id`: Board ID (cannot delete "main")

**Response:**

```json
{
  "success": true
}
```

**Error Response:**

```json
{
  "error": "Cannot delete main board"
}
```

---

## Tag Endpoints

### POST `/boards/:id/tags`

Create a persisted tag on a board.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**URL Parameters:**

- `id`: Board ID

**Body:**

```json
{
  "tag": "urgent"
}
```

**Response:**

```json
{
  "success": true,
  "tags": ["urgent", "work", "home"]
}
```

---

### POST `/tags/delete`

Delete a persisted tag from a board.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "boardId": "main",
  "tag": "urgent"
}
```

**Response:**

```json
{
  "success": true,
  "tags": ["work", "home"]
}
```

---

## Batch Operations

### PATCH `/batch-tag`

Update tags for multiple tasks.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "boardId": "main",
  "updates": [
    { "taskId": "01HQ...", "tag": "urgent" },
    { "taskId": "01HR...", "tag": null }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "updated": 2
}
```

Also served at `POST /boards/:boardId/tasks/batch/update-tags`, which takes the board in the path
instead of the body. Same handler; the legacy alias above is the one the UI calls.

**This is the write path a lane drag takes.** The board's drop handlers bulk-update even for a
single card, so this endpoint — not `PATCH /:id` — is the primary human lane write. It therefore
carries the same automation rules as the single-task path: the board reference is resolved through
the sharing layer (so a shared `handle` reaches the owner's data, and a readonly grantee gets `403`),
every update's tag is checked against the board's lanes on an automation board (`403
LANE_NOT_EDITABLE` for an `agent` lane, `422 LANE_INVALID` for a non-lane), and a write that lands
in a `user` lane fires the [wake dispatch](#the-wake-dispatch--repository_dispatch-on-a-human-lane-write)
— once per request, since a multi-card drag is one gesture.

---

### POST `/batch-move`

Move multiple tasks between boards.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "sourceBoardId": "main",
  "targetBoardId": "archive",
  "taskIds": ["01HQ...", "01HR..."]
}
```

**Response:**

```json
{
  "success": true,
  "moved": 2
}
```

---

### POST `/batch-clear-tag`

Remove a specific tag from multiple tasks.

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "boardId": "main",
  "tag": "urgent",
  "taskIds": ["01HQ...", "01HR..."]
}
```

**Response:**

```json
{
  "success": true,
  "updated": 2
}
```

---

## Preferences Endpoints

### GET `/preferences`

Get user preferences (synced for non-public users).

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Response:**

```json
{
  "version": 1,
  "updatedAt": "2025-10-27T12:00:00Z",
  "experimentalThemes": false,
  "alwaysVerticalLayout": false
}
```

> **Note**: Theme is NOT included - it's stored per-device in sessionStorage.

---

### PUT `/preferences`

Save user preferences (syncs for non-public users).

**Headers:**

- `X-User-Type`: `public` | `friend` | `admin`
- `X-Session-Id`: Session identifier

**Body:**

```json
{
  "experimentalThemes": true,
  "alwaysVerticalLayout": false
}
```

**Response:**

```json
{
  "ok": true
}
```

---

## Session & Authentication Endpoints

### POST `/validate-key`

Validate an authentication key.

> **Note**: Implement your own key validation logic. This endpoint is called when users enter a key in the settings modal.

**Headers:**

```http
X-User-Key: user-provided-key
```

**Response (valid):**

```json
{
  "valid": true
}
```

**Response (invalid):**

```json
{
  "valid": false
}
```

---

### POST `/session/create`

Create a new authenticated session after key validation.

> **Note**: Called after successful key validation. Should create a server-side session and return session details.

**Headers:**

```http
X-User-Key: validated-key
```

**Response:**

```json
{
  "sessionId": "unique-session-identifier",
  "userType": "friend",
  "valid": true
}
```

The frontend stores `sessionId` and `userType` in localStorage for subsequent requests.

---

### POST `/session/handshake`

Establish or migrate a session on page load (for authenticated users).

> **Note**: Called on page load for non-public users. Used to migrate preferences from old sessions and establish the current session.

**Headers:**

```http
X-User-Type: friend | admin
X-Session-Id: current-session-id
```

**Body:**

```json
{
  "newSessionId": "current-session-id",
  "oldSessionId": "previous-session-id-or-null"
}
```

**Response:**

```json
{
  "success": true,
  "sessionId": "current-session-id",
  "userType": "friend",
  "migrated": false,
  "preferences": {
    "experimentalThemes": false,
    "alwaysVerticalLayout": false
  }
}
```

> **Important - Session Expiration**: The `userType` field in the response reflects the server's determined user type based on the current session state. If the server session has expired (e.g., KV TTL exceeded), the server will return `userType: "public"` even if the client sent `X-User-Type: friend`. The client must check for this mismatch and handle session expiration appropriately (show re-authentication prompt, reload page).

---

## Statistics Endpoint

### GET `/stats`

Get task statistics for a board.

**Query Parameters:**

- `userType` (optional): `public` | `friend` | `admin`
- `boardId` (optional): Board ID (default: `main`)

**Response:**

```json
{
  "version": 2,
  "counters": {
    "totalCreated": 150,
    "totalCompleted": 120,
    "totalDeleted": 10,
    "totalUpdated": 200
  },
  "graveyard": [
    {
      "id": "01HQ...",
      "title": "Completed task",
      "tag": "work",
      "createdAt": "2025-10-20T10:00:00Z",
      "closedAt": "2025-10-27T12:00:00Z",
      "reason": "completed"
    }
  ]
}
```

---

## Board Calendars

A calendar is a **property of a board**, not a collection of its own: it is the
board's tasks that carry a calendar day. `date` (local `"YYYY-MM-DD"`) is the
membership key — a task with `date` (or with `startTime`/`endTime`, which backfill
it) is on the board's calendar; a task without one lives in board view only. There
is nothing to create, enable, or keep in sync.

So you **write** a calendar with the ordinary task endpoints pointed at the board,
and **read** it here.

### GET `/boards/:ref/calendar`

The board's scheduled tasks, ordered by day then start time.

**Query Parameters:**

- `from` (optional): inclusive first day, `"YYYY-MM-DD"`
- `to` (optional): inclusive last day, `"YYYY-MM-DD"`
- `source` (optional): only tasks mirrored from this provider (`Task.source`) —
  how an integration reconciles what it already wrote

**Response:**

```json
{
  "board": "MRY93H8LG7ZCSK998165RCUBHW",
  "calendar": { "ref": "MRY93H8LG7ZCSK998165RCUBHW", "name": "Main", "canWrite": true, "scheduled": 12 },
  "from": "2026-08-01",
  "to": "2026-08-31",
  "count": 2,
  "tasks": [...]
}
```

`scheduled` is the whole calendar; `count`/`tasks` are the window you asked for.
`canWrite` is false for a readonly grantee — reads work, writes are refused with
403 `FORBIDDEN`.

**Shared boards.** Pass the board's `handle` as `:ref` and you read the OWNER's
calendar; a contributor grant lets you create and delete on it with the task
endpoints using that same ref. Writes land in the owner's data and are immediately
visible in the owner's own calendar view. 404 `BOARD_NOT_FOUND` when the ref is a
board that isn't shared with you.

**Example — mirror an appointment onto a shared calendar, then withdraw it:**

```bash
# Discover the board you may write, and the ref that addresses its calendar
curl -H "X-User-Key: $KEY" https://hadoku.me/task/api/boards \
  | jq '.boards[] | select(.access == "contributor") | .calendar'

# Create a timed entry on it
curl -X POST https://hadoku.me/task/api -H "X-User-Key: $KEY" \
  -d '{"id":"01HQ...","title":"Intro call","board":"<ref>",
       "startTime":"2026-08-11T17:00:00Z","endTime":"2026-08-11T17:30:00Z",
       "source":"contact","sourceId":"appt_2"}'

# Reconcile what you have mirrored, then withdraw one
curl -H "X-User-Key: $KEY" "https://hadoku.me/task/api/boards/<ref>/calendar?source=contact"
curl -X DELETE "https://hadoku.me/task/api/01HQ...?board=<ref>" -H "X-User-Key: $KEY"
```

---

## Shared Boards

A board owner can share a board with another user key (or a service key). Grantees then see
it in `GET /boards` with `ownerUserId` + `access` (`contributor` | `readonly`), addressed by
its opaque **`handle`** (a slug only ever resolves within the caller's own namespace).

### POST `/boards/:ref/shares`

Owner-only. Grant (or update) a share. `level` is `readonly` | `contributor`. Identify the
grantee three ways, **preferred first** — no bearer credential need change hands:

- `{ name, level }` — **display name** (recommended). Resolved case-insensitively against live
  registry rows (retired rows excluded), the same way name-uniqueness is enforced. → `404
NAME_NOT_FOUND` if no live key has that name; `409 NO_USER_ID` if it exists but never signed in.
- `{ userId, level }` — a stable userId if you already have one.
- `{ key, level }` — the grantee's raw access key (a bearer credential; prefer `name`).

→ `{ ok, granteeUserId, granteeName, level, granted: { name, tier, level } }`. The `granted`
echo lets the owner confirm they granted the identity + tier they intended.

### GET `/boards/:ref/shares`

Owner-only. → `{ shares: [{ granteeUserId, level, createdAt }] }`.

### DELETE `/boards/:ref/shares/:granteeUserId`

Owner-only revoke. → `{ ok, removed }`.

### DELETE `/boards/:ref/shares/me`

Grantee leaves a shared board (removes their own access). → `{ ok, left }`.

---

## Automation Boards

Activating a board replaces its freeform tags with a fixed **lane** vocabulary and locks
the structure (see [MCP.md](MCP.md#automation-boards--the-claim-loop)).

### POST `/boards/:ref/repo`

Owner-only. Body: `{ repo }` — `"owner/name"`. The board → checkout mapping (§5.5): a runner reads
`repo` off the hydrated board instead of parsing a display name. Empty string, `null`, or an
omitted `repo` **clears** it. Stored verbatim (trimmed); probe it with `GET /repos/validate` first
if you want it checked against GitHub. → `{ ok, repo }`.

`404 BOARD_NOT_FOUND` when no board of that ref exists. Worth knowing why that isn't redundant: an
unknown slug resolves to "your own not-yet-created board", so this is answered from whether the
write actually touched a row — otherwise a typo'd ref would return `{ ok: true }` having stored
nothing.

Setting a `repo` also arms the wake dispatch below.

**Connecting a repo shares the board with that repo's service key.** Setting a `repo` grants that
repo's own service key `contributor` on the board, reported as
`serviceKeyShare: { granted, name, granteeUserId?, reason? }`. Connecting the repo is the whole
setup — no second, hand-typed share step.

The grantee is derived from the repo name by **convention**:

```
<repo name, with a leading "hadoku-" (or "hadoku_") trimmed>-service-key

WolffM/hadoku-aggregator  →  aggregator-service-key
WolffM/tenhands           →  tenhands-service-key
WolffM/hadoku_site        →  site-service-key
```

The owner segment is dropped (a key is named for the repo, not who hosts it), the trim is
case-insensitive, and the separator after `hadoku` may be `-` or `_` — `WolffM/hadoku_site` is a
real repo whose key is `site-service-key`, so a hyphen-only trim would match nothing. No live key
name begins with `hadoku`, so accepting both can't collide. This is convention rather than lookup
because the key registry row carries no
`repo` field — the display name is the only link between a checkout mapping and an identity, so
`repoServiceKeyName` in `worker/src/routes/shares.ts` is the single place that changes if the
convention does.

- Same terms as the automation-runner grant: **idempotent and never escalating** (an existing share
  of any level is left alone and reported `already_shared`), **owner-only**, and **never fatal** —
  a repo whose key hasn't been minted yet reports `no_registry_row` and the repo mapping still
  saves.
- **Clearing the repo grants nothing and revokes nothing.** The field is simply absent from the
  response. Removing someone's access is an explicit owner action through the share panel, not a
  side effect of blanking a field.
- `POST /boards/:ref/activate-automation` does the same thing when its body carries a `repo`,
  reported as `repoServiceKeyShare` alongside `automationRunnerShare`. A re-activation that omits
  `repo` connects nothing new (the column is `COALESCE`d), so it reports no repo grant.

### The wake dispatch — `repository_dispatch` on a human lane write

Not an endpoint: an **outbound** call the worker makes. When a human-path write lands a task in a
`user` lane on an automation board that records a `repo`, the worker POSTs
`repository_dispatch` (`event_type: "taskauto"`) to `api.github.com/repos/{repo}/dispatches`:

```json
{
  "boardId": "<owner-scoped slug>",
  "handle": "<board handle>",
  "taskId": "<task id>",
  "lane": "<destination lane tag>",
  "at": "<ISO-8601>"
}
```

A runner's cron is throttled hard by GitHub (measured on one repo: 78 of 254 `*/15` ticks
delivered, median gap 46 min), so a task dragged into a claimable lane could sit ~23 minutes before
anything looked at it. `repository_dispatch` isn't throttled that way and starts a run in seconds.
The cron stays as the backstop — this only shortens the wait for the first look.

The predicate is **structural, not semantic**: _a human wrote a task into a lane a human may write,
on a board wired to a repo_. It never names a lane. Which lanes are claimable is the runner's
policy and changes on the runner's schedule (`routes/agent.ts`: the worker performs no
orchestration), so the worker says only "a person moved something here" and the runner decides
whether that is actionable. Over-firing costs an idle run; a lane added on the runner's side needs
no change here.

Therefore it fires for a lane write from any human surface — the batch tag endpoints (what a drag
writes through), `POST /`, `PATCH /:id`, and the MCP `create_task` / `update_task` — and **not**:

- when the tag is cleared to the Inbox (a settle delay is the point of an Inbox; the backstop sweep
  picks up a task once it goes quiet)
- into an `agent` lane (those are the pipeline's own writes, and the human path is refused anyway)
- on a standard board, or an automation board with no `repo`
- on a write that doesn't touch the tag (complete, delete, schedule, rename)

It is fire-and-forget off the response path (`waitUntil`), 5s-bounded, no retries and no queue.
**A failed dispatch never fails the human's write** — a non-`204` is logged with the repo and
status and dropped. A multi-card drag is one gesture, so it sends one dispatch, not one per card.

Authenticates with the worker's single GitHub binding, `GITHUB_READ_TOKEN` (needs `repo` scope for
this write) — the same credential `GET /repos/validate` reads with. Both go through
`githubToken(env)` rather than the binding, so giving the write a narrower token later is a change
in one function. Unbound ⇒ nothing is sent and board writes are unaffected. Note GitHub answers
**404, not 403**, when a token can't see a private repo, so an under-scoped PAT looks like a
missing repo in the logs.

### GET `/automation/presets`

Signed-in only. The lane contracts our configured providers publish, fetched **server-side** so
the activation UI offers a provider's current schema instead of a JSON blob someone pasted months
ago. → `{ presets[], sources[] }`, where a preset is
`{ providerId, providerLabel, schemaId, schemaVersion, label, description, lanes[] }` — hand
`{ schemaId, schemaVersion, lanes }` straight to `activate-automation`.

Every preset is run through the same lane-set validator activation uses, so a provider can't
offer a lane set that would 422 on commit; an invalid one is dropped rather than blanking the
provider's good ones. `sources[]` reports each provider separately
(`{ id, label, url, ok, count, cached?, notModified?, stale?, error? }`) — an empty `presets`
with a failing source means "provider down", not "none exist", and a provider that breaks after a
good fetch keeps serving its last good copy (`stale: true`).

**Caching.** Inside a 5-minute TTL we serve from memory with no network at all; past it we
revalidate with `If-None-Match`, so an unchanged contract costs a 304 and keeps the lanes we
already parsed.

**Configuring providers.** `AUTOMATION_PRESET_SOURCES`, a JSON array of `{ id, label, url }`:

```json
[{ "id": "tenhands", "label": "TenHands", "url": "https://…/automation/presets" }]
```

`https` only (loopback excepted, for local dev) — a preset drives a destructive board migration,
so the contract can't arrive over a channel someone can rewrite in transit. Unset ⇒ no picker,
and paste-JSON still works.

**What a provider serves** (no auth — a lane vocabulary is public): a GET returning
`{ "presets": [ <payload>, … ] }`, a bare array, or a single `<payload>`, where `<payload>` is
exactly what `activate-automation` accepts. Serving a strong `ETag` is what makes the
revalidation above free.

TenHands, the reference provider, describes its half of this in an OpenAPI 3.1 document at
<https://dispatch.hadoku.me/tenhands/automation/openapi.json> — public, same strong-ETag/304
revalidation as the presets route, covering both routes plus the `AutomationPreset` and `Lane`
schemas. Generate a client from it rather than transcribing the shapes above. It describes only
that public automation surface; the rest of the TenHands API is authenticated and deliberately
absent.

### GET `/boards/:ref/actionable`

Signed-in, non-readonly. What this board's repo has **open** that the pipeline could take on —
the data behind the "Automate open items" button. →
`{ ok, repo, items[], reason? }`, where an item is
`{ kind: "issue" | "pr", number, title, url, author?, suggestedTitle, bodySnippet?, headRef? }`.

Fetched server-side from TenHands (`GET {base}/api/taskauto/actionable?board=<handle>`), which has
already dropped the pipeline's own `taskauto/*` PRs and bot authors — so this is work a human
filed, not the pipeline's output looping back. The `base` is derived from the `tenhands` entry in
`AUTOMATION_PRESET_SOURCES` (its URL minus `/automation/presets`); the credential is **not**
shared with presets — a lane vocabulary is public, an issue list is not — and comes from
`TENHANDS_SERVICE_KEY`, sent as `X-User-Key`. The caller's own credential is never forwarded.

The board is identified by its **handle**, the same identifier the runner discovers boards by, not
by whatever ref you addressed this route with.

`ok` says the answer is TRUSTWORTHY, not that the list is non-empty. `ok: true` with
`reason: "no_repo"` / `"not_automation"` means there is definitely nothing to do; `ok: false`
means we don't know, and a UI must render nothing rather than an empty backlog. Reasons:
`no_repo`, `not_automation`, `signed_out`, `no_provider_configured`, `no_service_key`,
`provider_<status>`, `provider_timeout`, `provider_unreachable`, `bad_payload`,
`provider_reported_failure`. Nothing is cached — this is "what is open right now", read on board
load — and nothing is created: the caller turns the items into ordinary tasks itself.

**How the app uses it.** Scan on board load, drop items whose `suggestedTitle` (or `Address #N` /
`Address PR #N` form) already matches a task on the board, and offer the rest. Each accepted item
becomes an ordinary untagged Inbox task — no lane, no metadata — titled `suggestedTitle`, with
notes carrying the URL, title, snippet, and a one-line instruction (`Reproduce if needed, fix it,
and open a PR.` for an issue; `Check out branch {headRef} and address the outstanding review/CI
feedback.` for a PR). The taskauto runner picks those rows up on its own. Because visibility
already excludes items that have a task, the action needs no lock: a double-click or a reload is
safe.

### POST `/boards/:ref/activate-automation`

Body: `{ lanes[], schemaId?, schemaVersion?, repo?, dryRun?, digest? }`. Each lane
is `{ tag, label, order, editableBy }` (`editableBy` ∈ `user` | `agent`; extra keys preserved
verbatim). `dryRun: true` returns a preview `{ digest, mapping, toInbox, collisions }` and
writes nothing; the committing call echoes that `digest` (stale → `409 DIGEST_MISMATCH`).
Unmapped tags are cleared to the Inbox, preserved in `metadata.preAutomationTags`.

**Who may activate.** A `dryRun` writes nothing, so any caller with write access may run one — a
contributor needs it to discover whether its commit will be allowed. For a commit:

| Caller          | May commit                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **owner**       | anything — first conversion, and migrations that displace tasks                                                             |
| **contributor** | only an **upgrade**: the board is already `mode: automation` AND the new lane set strands nothing (`preview.toInbox === 0`) |
| **readonly**    | never                                                                                                                       |

This is what lets a provider ship its own schema versions — re-orders, relabels, added lanes,
version bumps — without a human in the loop, while a lane set that would strand tasks still needs
the board owner. The line is `toInbox`, not "same `schemaId`", because `toInbox` is the only thing
that measures actual harm: it counts tasks whose current lane would vanish. A refused contributor
commit is `403 FORBIDDEN` and writes nothing.

**The runner is shared in automatically.** An **owner's** committing activation also grants the
automation runner `contributor` on the board, and reports it as
`automationRunnerShare: { granted, name, granteeUserId?, reason? }`. Without it every automation
board needed a hand-typed share before the runner could touch it, and that was the step everyone
forgot — the symptom was a runner 403 long after activation looked fine.

- The grantee is resolved by registry **name**, default `tenhands-service-key` (the identity the
  TenHands worker presents — not `tenhands-devvault`, which is only the operator's dev-vault
  caller). Overridable with the `AUTOMATION_RUNNER_KEY_NAME` binding, because that name has been
  retired and re-minted before.
- **Idempotent, and never escalating.** An existing share of any level is left alone and reported
  as `granted: false, reason: "already_shared"` — so an owner who deliberately pins the runner to
  `readonly` keeps it across re-activations.
- **Owner-only**, so a contributor upgrading a board can't hand a third identity access to a board
  it doesn't own. A contributor's activation omits the field entirely, as does any `dryRun`.
- **Never fatal.** The activation is already committed, so a registry miss or outage can't fail the
  call — it comes back `granted: false` with `reason` ∈ `already_shared` | `no_registry_row` |
  `no_user_id` | `registry_unavailable` | `self`.

### POST `/boards/reconcile-shares`

Backfill for links made **before** the auto-grants shipped, and a drift check afterwards. The
automatic grants only fire on the write that creates a link, so a board connected earlier still has
no share. This walks every board **you own** and repairs both kinds:

- a linked `repo` → that repo's service key (`<repo minus a leading "hadoku-"/"hadoku_">-service-key`)
- `mode: automation` → the automation runner (`tenhands-service-key`)

Body: `{ dryRun?, force?, allOwners? }` — `dryRun` and `force` both default to `true`.

- **`dryRun` defaults to TRUE.** A bulk grant across every board you own has to be asked for, so you
  must pass `false` to write anything. A dry run runs the **same** resolution and the same
  branching as the commit — including the existing-share lookup — and stops short of the write, so
  its tally is what the commit will actually do rather than an optimistic guess.
- **`force` defaults to TRUE.** An existing share below `contributor` is upgraded and reported as
  `escalated` with the `previousLevel` it replaced — never silently. Pass `force: false` to leave
  existing rows exactly as they are. (This is the one place that escalates: the incidental
  auto-grants never do, because there nobody asked.)

**Both names are verified before anything is granted** — that check is the point of doing this
deliberately rather than blind-inserting from the `boards` table:

1. the **repo** is probed against GitHub, so a typo'd mapping can never mint a share;
2. the derived **key name** must resolve to a live, signed-in registry row.

Either check failing is reported as `outcome: "skipped"` with a `reason`, and grants nothing.

→ `{ dryRun, summary: { boardsScanned, boardsWithWork, granted, escalated, alreadyShared, skipped },
boards: [ { boardId, repo, mode, grants: [ { kind, name, outcome, previousLevel?, granteeUserId?,
reason? } ] } ] }`. Boards with no link at all are omitted entirely.

**`allOwners: true` sweeps every owner's boards, and needs a service-tier key** (403 below that).
This is deliberately _not_ privileged information: the grantee is fully determined by the board's
own `repo`, or is the fixed automation runner, so **a caller cannot choose who gets access**. The
sweep can only create the shares the system would already have made automatically on the next
write. Report rows carry `ownerId` in this mode.

The one thing it must not do is let one owner's agent overwrite **another** owner's deliberate
level, so **`force` silently does not apply to boards you don't own** — an existing `readonly` set
by hand stays `readonly`, reported with
`reason: "left alone: force does not apply to another owner's board"`. That board's owner can still
escalate it by running the reconcile themselves. Creating a _missing_ share cross-owner is fine
(it's deterministic); changing one someone set by hand is theirs to do.

Without `allOwners` it reads `boards WHERE user_id = <caller>`, so the default is owner-scoped and
any signed-in caller can run it on their own boards. Re-running is safe and idempotent either way.

```sh
# See the plan (writes nothing):
curl -s -X POST https://hadoku.me/task/api/boards/reconcile-shares \
  -H "X-User-Key: $KEY" -H 'Content-Type: application/json' -d '{}'
# Apply it:
curl -s -X POST https://hadoku.me/task/api/boards/reconcile-shares \
  -H "X-User-Key: $KEY" -H 'Content-Type: application/json' -d '{"dryRun":false}'

# Every owner's boards (service-tier key required):
curl -s -X POST https://hadoku.me/task/api/boards/reconcile-shares \
  -H "X-User-Key: $SERVICE_KEY" -H 'Content-Type: application/json' \
  -d '{"allOwners":true,"dryRun":false}'
```

### POST `/boards/:ref/deactivate-automation`

Owner-only. Restores the pre-activation tag list. → `{ ok, mode: "standard", restoredTags }`.

While a board is automation, the human path (`POST /`, `PATCH /:id`, batch tag ops) may write
only `user` lanes (`403 LANE_NOT_EDITABLE` / `422 LANE_INVALID`), and `createTag` / `deleteTag`
/ `batchClearTag` → `409 BOARD_SCHEMA_LOCKED`.

---

## Agent Claim Protocol

Safe multi-agent work. All resolve the board through the sharing/automation layer; the write
endpoints need `contributor`+ access. The agent path may write `agent` lanes.

### POST `/agent/claim`

Body: `{ board, taskId, agentId?, lane?, leaseSeconds? }`. Atomic — exactly one concurrent
caller wins → `{ token, agentId, expiresAt, lane }`. A live lease → `409 CLAIM_HELD` with
`{ holder, expiresAt }`. Only an **expired** lease is stealable.

### POST `/agent/heartbeat`

Body: `{ board, taskId, token, leaseSeconds? }`. Extends the lease → `{ ok, expiresAt }`, or
`409 LEASE_LOST` if the token no longer holds it.

### POST `/agent/set-lane`

Body: `{ board, taskId, token, lane }`. Move while holding the claim → `{ ok, lane }`.
`422 LANE_UNKNOWN` if the lane isn't on the board; `409 LEASE_LOST` without the claim.

### POST `/agent/release`

Body: `{ board, taskId, token, lane?, notes?, metadata?, outcome?, ifCurrentLane?, complete? }`.
Moves the task, writes `notes`, merges `metadata` (claim-gated), closes the claim, records
history. Idempotent on token. `ifCurrentLane` guards against a human retag → `409 LANE_CHANGED`.
`complete: true` archives the task (removes it from the active list) — still claim-gated and
audited; otherwise `state` is never changed.

`notes` is capped at **64 KB of UTF-8** (not characters — multibyte content is measured on its
encoded length). Over it → `413 NOTES_TOO_LARGE`, and **nothing is written and your claim is not
dropped**, so truncate or link out and retry on the same token. Don't retry unchanged.

### POST `/agent/cancel`

Owner-only. Force-drop the claim on a task (reclaim a stuck/held task by hand). Body:
`{ board, taskId }`. → `{ ok, dropped }`. The holding agent's next `heartbeat`/`set-lane`
then sees no live claim → `409 LEASE_LOST`. Idempotent (`dropped: false` when nothing was held).

### GET `/agent/history?board=&task=`

→ `{ history: [{ agentId, claimedAt, endedAt, endedBy, outcome }] }` (newest first).

### GET `/boards/:ref`

One board, fully hydrated (§5.5) — resolves through sharing, so a grantee reads the owner's
board. → `{ board: { id, name, handle, repo, mode, lanes, schemaId, schemaVersion, access,
ownerUserId, presetUpdate? }, tasks: [{ …task, claimed }], version }`. Each task carries a
`claimed` boolean (a live lease holds it). How a runner sees all its work — metadata + tasks +
claim state — in one request.

**`presetUpdate`** — present only when the board's lane set is behind the provider contract it
was activated from:

```jsonc
"presetUpdate": {
  "providerId": "tenhands",
  "providerLabel": "TenHands",
  "schemaId": "autoland",
  "schemaVersion": 2,      // what the provider publishes NOW
  "label": "Autoland",
  "description": "…",
  "safe": true,            // applying it strands no task
  "toInbox": 0             // active tasks that would be cleared to the Inbox
}
```

Absent when the board is current, isn't an automation board, carries a `schemaId` no configured
provider serves, or is read by anyone but the owner — nobody else can activate, so nobody else
is told. Advisory only: **no privilege changes**, and applying it is still the owner driving
the ordinary `activate-automation` handshake. `safe` is `toInbox === 0`, meaning every active
task's tag survives into the new lane set, so applying relabels columns and moves no work;
`safe: false` is a real migration and belongs in front of a human who can see what lands where.

Computed from the worker's **cached** copy of the provider contract — this read never fetches,
so a board load can't inherit a provider's latency. A cold cache therefore reports nothing and
refreshes in the background, which resolves on the next read. Do not treat absence as proof the
board is current; it is a hint, and `activate-automation` remains the source of truth.

### GET `/changes?since=<updatedAt>,<id>&limit=`

Change feed — the caller's own tasks whose `(updatedAt, id)` sort after the cursor (deletes
appear as `state: "Deleted"`). → `{ changes: [{ id, boardId, tag, state, updatedAt }], cursor }`.
Poll with the returned `cursor` as the next `since`.

---

## Error Responses

All endpoints return errors in this format:

**HTTP Status Codes:**

- `200` - Success
- `400` - Bad request (validation error)
- `403` - Forbidden (permission denied)
- `404` - Not found
- `409` - Conflict (version/claim/lane)
- `413` - Payload too large (notes)
- `422` - Unprocessable (lane validation)
- `500` - Server error

Domain errors carry a machine-readable `code` (and, where useful, extra fields like `holder`,
`expiresAt`, `currentVersion`, `currentLane`, `currentDigest`). **Branch on the `code`, not the
status** — a 409 is `CLAIM_HELD` (someone else has the task; move on) or `LEASE_LOST` (your claim
is gone; abort and write nothing), which need opposite behaviour.

The codes are a **closed set**, published in the OpenAPI spec as the `DomainErrorCode` enum, so a
generated client gets a real enum rather than a bare string. Where a status maps to a single code
the response schema is narrowed further (`/agent/heartbeat` 409 → `LeaseLostError`, `/agent/claim`
409 → `ClaimHeldError`), so codegen yields one exception type per outcome. Full set, with what to
do about each: [MCP.md](MCP.md#error-codes): `CLAIM_HELD`, `LEASE_LOST`, `LANE_NOT_EDITABLE`,
`LANE_UNKNOWN`, `LANE_INVALID`, `LANE_CHANGED`, `LANE_SET_INVALID`, `BOARD_SCHEMA_LOCKED`,
`DIGEST_MISMATCH`, `VERSION_CONFLICT`, `NOTES_TOO_LARGE`, `RATE_LIMITED`, `TASK_NOT_FOUND`,
`BOARD_NOT_FOUND`, `NAME_NOT_FOUND`, `NO_USER_ID`, `FORBIDDEN`.

**Rate limits.** `friend`/`admin` are not throttled; the **`service`** tier is capped at
**600/min** (10/sec) and `public` at 60/min. A `429` carries `{ error, code: "RATE_LIMITED",
message, retryAfter }`. Authenticate an autonomous agent with a service-tier key.

**Error Response:**

```json
{
  "error": "Error message describing what went wrong"
}
```

---

## Data Types

### Task

```typescript
interface Task {
  id: string // ULID format
  title: string
  tag?: string | null // Space-separated tags
  state: 'Active' | 'Deleted' | 'Completed'
  createdAt: string // ISO 8601
  updatedAt?: string | null // ISO 8601
  closedAt?: string | null // ISO 8601 (when completed/deleted)
  // Calendar scheduling (see docs/MCP.md for the model)
  date?: string | null // canonical day "YYYY-MM-DD" (UTC); date-only = all-day task
  startTime?: string | null // ISO 8601 — timed event start
  endTime?: string | null // ISO 8601 — timed event end
  // External provider origin (calendar integrations) + arbitrary detail
  source?: string | null // e.g. "contact", "admin-mail"
  sourceId?: string | null // event id within that provider
  metadata?: Record<string, unknown> | null
}
```

`POST /` and `PATCH /:id` accept `date`, `startTime`, `endTime`, `source`, `sourceId`,
and `metadata` alongside `title`/`tag`. `date` is persisted as the UTC day and derived
from `startTime` when omitted. Agents can drive all of this through the
[MCP server](MCP.md).

### Board

```typescript
interface Board {
  id: string
  name: string
  tags: string[] // Persisted tags
  tasks: Task[]
  stats: StatsFile
}
```

### StatsFile

```typescript
interface StatsFile {
  version: number
  counters: {
    totalCreated: number
    totalCompleted: number
    totalDeleted: number
    totalUpdated: number
  }
  graveyard: StatsTaskRecord[]
}
```

---

## Implementation Examples

For complete integration examples with Express, Hono, and Cloudflare Workers, see:

- [README.md - Installation](../README.md#installation)
- [ARCHITECTURE.md - Server Architecture](ARCHITECTURE.md#server-architecture)

---

**Related Documentation:**

- [Architecture Overview](ARCHITECTURE.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
