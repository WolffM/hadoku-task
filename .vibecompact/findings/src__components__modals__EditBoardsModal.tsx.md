# src/components/modals/EditBoardsModal.tsx

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 5 lanes applicable · anchor `30f067cc914e`

### size — 864 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `AutomationPanel` | function | 365 | 638–1002 |
| `EditBoardsModal` | function | 346 | 93–438 |
| `SharePanel` | function | 199 | 439–637 |
| `ShareApi` | interface | 40 | 33–72 |
| `EditBoardsModalProps` | interface | 17 | 73–89 |

Suggested first cut: extract `AutomationPanel` (365 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:src/components/modals/EditBoardsModal.tsx" --reason "..."
```
