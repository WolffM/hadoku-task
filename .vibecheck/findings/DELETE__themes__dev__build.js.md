# themes/dev/build.js

Deletion candidate · orphaned — zero import fan-in, no declared entry point · anchor `4385e57dd6da`

### Pre-run verification

String-reference scan found mentions — **inspect these before treating the file as unreachable** (they usually name the loading mechanism):

- `package.json:37` — `"build": "vite build",`
- `task-ui-components/package.json:32` — `"build": "vite build && tsc --emitDeclarationOnly && node ../scripts/fix-imports.cjs dist && pnpm run copy-css",`
- `themes/package.json:37` — `"build": "tsc && node ../scripts/fix-imports.cjs dist",`

### Action

Resolve the references above first; if they are the loading mechanism, file a noise verdict instead:

```
vibecheck noise "consistency:themes/dev/build.js" --reason "..."
```
