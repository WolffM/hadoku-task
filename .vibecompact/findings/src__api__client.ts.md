# src/api/client.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 5 lanes applicable · anchor `30f067cc914e`

### size — 791 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `createApi` | function | 782 | 272–1053 |
| `reportRefusal` | async function | 56 | 160–215 |
| `syncBoardsToLocalStorage` | async function | 50 | 34–83 |
| `backgroundSync` | function | 43 | 216–258 |
| `readErrorDetail` | async function | 21 | 131–151 |
| `adminHeaders` | function | 16 | 84–99 |

`createApi` alone is 74% of the file — moving it to its own module would relocate the problem, not reduce it. Cut inside it instead:

Suggested first cut: split `createApi` at its internal boundaries (blocks, route groups, phases) rather than extracting it whole, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:src/api/client.ts" --reason "..."
```
