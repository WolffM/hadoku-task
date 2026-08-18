# worker/src/mcp/tools.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 5 lanes applicable · anchor `30f067cc914e`

### size — 662 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `TOOLS` | const | 548 | 182–729 |
| `ToolCtx` | interface | 26 | 56–81 |
| `resolveBoard` | async function | 23 | 112–134 |
| `wakeRunner` | function | 22 | 135–156 |
| `ResolvedBoard` | interface | 15 | 39–53 |
| `scheduleProps` | const | 12 | 170–181 |

`TOOLS` alone is 74% of the file — moving it to its own module would relocate the problem, not reduce it. Cut inside it instead:

Suggested first cut: split `TOOLS` at its internal boundaries (blocks, route groups, phases) rather than extracting it whole, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:worker/src/mcp/tools.ts" --reason "..."
```
