# worker/test/automation-verify.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 4 lanes applicable · anchor `30f067cc914e`

### size — 1106 code lines (tier 2)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `main` | async function | 1030 | 318–1347 |
| `Body` | interface | 57 | 144–200 |
| `req` | async function | 31 | 201–231 |
| `reqTier` | async function | 31 | 232–262 |
| `mcp` | async function | 29 | 263–291 |
| `env` | const | 25 | 82–106 |

`main` alone is 76% of the file — moving it to its own module would relocate the problem, not reduce it. Cut inside it instead:

Suggested first cut: split `main` at its internal boundaries (blocks, route groups, phases) rather than extracting it whole, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:worker/test/automation-verify.ts" --reason "..."
```
