# worker/src/routes/share-registry.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 5 lanes applicable · anchor `d8054e55c8bc`

### deadcode — 5 of 5 exported items unconsumed

| item | line | action |
|---|---|---|
| `readLiveRows` | 33 | un-export — used inside this file |
| `IdentityError` | 38 | delete after verification |
| `IdentityResult` | 39 | delete after verification |
| `KeyRegistryRecord` | 40 | delete after verification |
| `ResolvedIdentity` | 41 | delete after verification |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:worker/src/routes/share-registry.ts" --reason "..."
```
