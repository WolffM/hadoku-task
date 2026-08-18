# worker/test/agent-claim-verify.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 4 lanes applicable · anchor `30f067cc914e`

### size — 640 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `main` | async function | 607 | 170–776 |
| `Body` | interface | 29 | 55–83 |
| `req` | async function | 29 | 84–112 |
| `mcp` | async function | 24 | 113–136 |
| `makeKV` | function | 16 | 27–42 |

`main` alone is 78% of the file — moving it to its own module would relocate the problem, not reduce it. Cut inside it instead:

Suggested first cut: split `main` at its internal boundaries (blocks, route groups, phases) rather than extracting it whole, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:worker/test/agent-claim-verify.ts" --reason "..."
```
