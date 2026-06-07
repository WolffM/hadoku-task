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

All tools default to the **`main`** board unless a `board` argument is given.

| Tool            | Arguments                                                                        | Purpose                                                         |
| --------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `list_tasks`    | `board?`, `date?` (`YYYY-MM-DD`), `tag?`                                         | List active tasks; optional day / tag filter                    |
| `get_task`      | `id`, `board?`                                                                   | Fetch one task                                                  |
| `create_task`   | `title`, `tag?`, `date?`, `startTime?`, `endTime?`, `metadata?`, `board?`        | Create a task                                                   |
| `update_task`   | `id`, `title?`, `tag?`, `date?`, `startTime?`, `endTime?`, `metadata?`, `board?` | Update only the fields passed                                   |
| `schedule_task` | `id`, (`startTime`+`endTime`) \| `date` \| `clear:true`, `board?`                | Put a task on the calendar (timed or all-day), or unschedule it |
| `complete_task` | `id`, `board?`                                                                   | Mark complete (removes from active list)                        |
| `delete_task`   | `id`, `board?`                                                                   | Delete                                                          |
| `list_boards`   | —                                                                                | List boards                                                     |

### Scheduling model

A task occupies one of three states, mirroring the calendar data model:

- **Timed event** — `startTime` + `endTime` (ISO 8601, UTC), e.g. `2026-06-10T17:00:00.000Z`.
- **All-day task** — `date` only (`"YYYY-MM-DD"`).
- **Board-only task** — none of the above (appears on the board, not the calendar).

`tag` is a space-separated string (`"work urgent"`). `metadata` is arbitrary JSON for
provider/event detail. Tasks ingested from other apps additionally carry `source` and
`sourceId`; they behave like any other task here.

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
