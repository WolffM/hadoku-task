# themes/dev/editor.js

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 4 lanes applicable · anchor `30f067cc914e`

### size — 631 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `applyChanges` | async function | 61 | 697–757 |
| `renderThemePicker` | function | 49 | 50–98 |
| `renderCompactVars` | function | 39 | 105–143 |
| `exportCSS` | function | 38 | 565–602 |
| `renderGradientStops` | function | 37 | 243–279 |
| `updateThemePreview` | function | 34 | 165–198 |

Suggested first cut: extract `applyChanges` (61 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:themes/dev/editor.js" --reason "..."
```
