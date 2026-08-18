# src/domain/handlers/handlers.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 5 lanes applicable · anchor `30f067cc914e`

### size — 558 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `batchMoveTasks` | async function | 79 | 630–708 |
| `batchClearTag` | async function | 72 | 709–780 |
| `createTask` | async function | 62 | 178–239 |
| `updateTask` | async function | 58 | 240–297 |
| `batchUpdateTags` | async function | 53 | 577–629 |
| `getBoards` | async function | 51 | 100–150 |

Suggested first cut: extract `batchMoveTasks` (79 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:src/domain/handlers/handlers.ts" --reason "..."
```
