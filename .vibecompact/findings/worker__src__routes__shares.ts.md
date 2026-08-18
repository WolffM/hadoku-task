# worker/src/routes/shares.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 5 lanes applicable · anchor `30f067cc914e`

### size — 509 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `createShareRoutes` | function | 207 | 513–719 |
| `grantContributor` | async function | 57 | 386–442 |
| `resolveGrantee` | async function | 51 | 61–111 |
| `grantShareByName` | async function | 46 | 303–348 |
| `annotatedSharesByBoard` | async function | 34 | 234–267 |
| `searchRegistryNames` | async function | 32 | 171–202 |

Suggested first cut: extract `createShareRoutes` (207 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:worker/src/routes/shares.ts" --reason "..."
```
