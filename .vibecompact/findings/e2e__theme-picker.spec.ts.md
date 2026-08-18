# e2e/theme-picker.spec.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: duplication · 4 lanes applicable · anchor `30f067cc914e`

### duplication — 45 duplicated lines

| this file | duplicates |
|---|---|
| 14–37 | `e2e/task-button-prefs.spec.ts`:36–68 |
| 121–141 | `e2e/task-button-prefs.spec.ts`:37–68 |

Extract the shared block into one module both sites import.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "duplication:e2e/theme-picker.spec.ts" --reason "..."
```
