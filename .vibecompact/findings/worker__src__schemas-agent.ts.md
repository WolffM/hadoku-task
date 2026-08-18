# worker/src/schemas-agent.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 5 lanes applicable · anchor `30f067cc914e`

### size — 555 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `DOMAIN_ERROR_CODES` | const | 28 | 26–53 |
| `ReconcileBoardSchema` | const | 25 | 335–359 |
| `ActivateResponseSchema` | const | 24 | 540–563 |
| `PresetUpdateSchema` | const | 21 | 216–236 |
| `ActionableItemSchema` | const | 21 | 267–287 |
| `PresetSourceResultSchema` | const | 20 | 237–256 |

Suggested first cut: extract `DOMAIN_ERROR_CODES` (28 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:worker/src/schemas-agent.ts" --reason "..."
```
