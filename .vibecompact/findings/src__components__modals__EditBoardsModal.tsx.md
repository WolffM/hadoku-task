# src/components/modals/EditBoardsModal.tsx

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 5 lanes applicable · anchor `d8054e55c8bc`

### size — 516 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `EditBoardsModalProps` | interface | 17 | 26–42 |
| `EditBoardsModal` | function | 15 | 134–148 |

Suggested first cut: extract `EditBoardsModalProps` (17 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:src/components/modals/EditBoardsModal.tsx" --reason "..."
```
