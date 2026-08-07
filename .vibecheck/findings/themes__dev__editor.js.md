# themes/dev/editor.js

Worst-offender rank 1 · firing: consistency + size · 4 lanes applicable · anchor `4385e57dd6da`

### consistency — orphaned (zero import fan-in)

### size — 631 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `applyChanges` | async function | 62 | 697–758 |
| `renderThemePicker` | function | 49 | 50–98 |
| `renderCompactVars` | function | 39 | 105–143 |
| `exportCSS` | function | 38 | 565–602 |
| `renderGradientStops` | function | 37 | 243–279 |
| `updateThemePreview` | function | 34 | 165–198 |

Suggested first cut: extract `applyChanges` (62 lines) into its own module, with a test first.

### Pre-run verification

String-reference scan found mentions — **inspect these before treating the file as unreachable** (they usually name the loading mechanism):

- `docs/CHANGELOG.md:143` — `- Editor refactored from 1 monolithic HTML file (2354 lines) into 5 modular files: `editor.html` (294 lines), `editor.cs`

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "consistency:themes/dev/editor.js" --reason "..."
vibecheck wontfix|noise|justify "size:themes/dev/editor.js" --reason "..."
```
