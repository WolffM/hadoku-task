# Theme System Upgrade — full Tailwind color package + ecosystem de-handrolling + usage guide

**Status:** proposed — ready to execute
**Owner:** whoever picks this up in `hadoku-task`
**Scope:** `@wolffm/themes` (this repo) + every consumer repo in the ecosystem

This plan is self-contained. It came out of a cross-ecosystem audit (Nov 2026)
of why "colors are fucked in light/dark mode" keeps recurring across apps. Read
the **Evidence** and **Root cause** sections first, then execute the three
tasks in order. Each task is independently shippable.

---

## Why we're doing this (evidence)

An audit of color-fix commits across the ecosystem (resume-bot, contact-ui,
trader, jobplatform, printTool, aggregator, dataplatform, hadoku_site) found the
same fixes happening over and over:

- **8 of 15** color-fix commits were "a token that drifted or never existed →
  the real token" (e.g. `--color-accent`, `--color-surface`, `--color-error-*`,
  `--color-bg-secondary`, `--color-success-light` — none of which exist).
  Commit messages literally repeat: _"bring CSS to current @wolffm/themes
  tokens"_ (4 repos), _"drop dead fallbacks; use real themes vars"_,
  _"theme-correct buttons"_.
- **3 repos** independently added the same stylelint gate
  (`stylelint-value-no-unknown-custom-properties`) — a sign the platform should
  own this, not each consumer.
- hadoku_site shipped white buttons in Nov 2026 because Tailwind classes like
  `bg-success-bg` / `bg-warning-bg` / `bg-bg-secondary` resolved to **nothing**.

## Root cause (three vectors, all silent)

1. **The token set is structurally asymmetric.** The 5 semantic families share
   only `base`, `-hover`, and `on-*` uniformly; every other variant is present
   on some families and absent on others with no derivable rule. So an agent
   reaches for the _symmetric_ name (`--color-danger-bg`) and it doesn't exist.
2. **The package ships no Tailwind color mapping.** `tailwind-integration.css`
   maps radius/shadow/text but **zero colors**, so every consumer hand-maintains
   its own `@theme` color subset (or raw `var()`), which drifts from the source.
3. **Every miss fails silently.** The `var(--x, #hardcoded)` fallback idiom
   renders the hardcoded value — which looks correct in the default _light_
   theme and only breaks in the other 17 themes. And an unmapped Tailwind color
   class (`bg-foo`) simply produces no rule. Neither typecheck nor build catches
   either.

## Current token matrix (verified against `themes/src/style.css`, all 18 themes)

Every token below is defined in all 18 theme blocks (no per-theme drift — the
inconsistency is purely structural across families).

| family  | base | `-dark` | `-light` | `-bg` | `-hover` | `on-*` | oddballs                                    |
| ------- | :--: | :-----: | :------: | :---: | :------: | :----: | ------------------------------------------- |
| primary |  ✓   |    ✓    |    ✓     |   ✓   |    ✓     |   ✓    | —                                           |
| success |  ✓   |    ✓    |    ✗     |   ✓   |    ✓     |   ✓    | —                                           |
| warning |  ✓   |    ✗    |    ✗     |   ✓   |    ✓     |   ✓    | —                                           |
| danger  |  ✓   |    ✓    |    ✓     | **✗** |    ✓     |   ✓    | `-darker` (danger-only)                     |
| neutral |  ✓   |    ✗    |    ✓     | **✗** |    ✓     |   ✓    | `-lighter`; bg is orphan `--color-muted-bg` |

Structural families (fine as-is): `text` (+ `-secondary`/`-tertiary`/`-muted`),
`border` (+ `-light`), `bg` (+ `-card`/`-alt`/`-hover`/`-overlay`). 38 tokens total.

The three concrete agent-traps: (1) `danger` has no `-bg` (uses `-light`),
(2) `muted-bg` breaks the `<family>-bg` pattern (it's really `neutral-bg`),
(3) `-dark`/`-light`/`-darker`/`-lighter` presence is arbitrary per family.

---

## Task 1 — Upgrade `@wolffm/themes` to a full Tailwind color package

**Goal:** every semantic family exposes the _same_ token set, and the package
ships a complete Tailwind `@theme` color mapping so consumers get
`bg-primary` / `text-on-primary` / `bg-success-bg` for free.

### 1a. Normalize the token set to full symmetry

Canonical per-family set (applies to `primary`, `success`, `warning`, `danger`,
`neutral`):

| token               | meaning                                         | pairs with       |
| ------------------- | ----------------------------------------------- | ---------------- |
| `--color-<f>`       | the solid/filled color                          | `on-<f>` as text |
| `--color-<f>-dark`  | darker shade for hover/active on the solid fill | —                |
| `--color-<f>-bg`    | faint tint surface (badge/banner background)    | `<f>` as text    |
| `--color-<f>-hover` | translucent overlay for ghost/hover states      | —                |
| `--color-on-<f>`    | contrast text/icon color ON the solid fill      | —                |

**What must change in `themes/src/style.css` (all 18 blocks + `:root`):**

- **Add new values** (these don't exist yet and need a real per-theme value):
  - `--color-warning-dark` (×18) — darker warning for hover/active.
  - `--color-neutral-dark` (×18) — darker neutral for hover/active.
  - Every added `-dark`/`-bg` must keep the WCAG guarantees in
    `docs/THEME_SYSTEM_RULES.md` (on-X ≥ 4.5:1 vs its base; badge text ≥ 4.5:1
    vs its `-bg`). Validate per theme; do **not** eyeball.
- **Rename/canonicalize (no new values — the value already exists):**
  - `--color-danger-bg` := current `--color-danger-light` value.
  - `--color-neutral-bg` := current `--color-muted-bg` value.
- **Keep every current name as a back-compat alias** so no consumer breaks the
  moment this publishes. In each theme block, after the canonical tokens, add:
  ```css
  /* Back-compat aliases — deprecated, remove after ecosystem migration (Task 2). */
  --color-danger-light: var(--color-danger-bg);
  --color-muted-bg: var(--color-neutral-bg);
  --color-primary-light: var(--color-primary-bg); /* if primary-light usages remain */
  --color-danger-darker: var(--color-danger-dark);
  --color-neutral-light: var(--color-neutral-bg);
  --color-neutral-lighter: var(--color-neutral-bg);
  ```
  (Audit real usage first — only alias names consumers actually reference; drop
  the rest into `THEME_GRAVEYARD.md`.)

**Result:** the target matrix is a full rectangle — every semantic family has
`{base, -dark, -bg, -hover, on-<f>}`, nothing missing, aliases cover the past.

### 1b. Ship a complete Tailwind color `@theme` mapping

Add a `@theme` color block to `themes/src/tailwind-integration.css` (or a new
`./tailwind-colors.css` export that it `@import`s) mapping **every** color token
— all 5 families × 5 variants, plus `text*`, `border*`, `bg*`. Pattern:

```css
@theme {
  --color-primary: var(--color-primary);
  --color-primary-dark: var(--color-primary-dark);
  --color-primary-bg: var(--color-primary-bg);
  --color-primary-hover: var(--color-primary-hover);
  --color-on-primary: var(--color-on-primary);
  /* …repeat for success, warning, danger, neutral… */
  --color-text: var(--color-text);
  --color-text-secondary: var(--color-text-secondary);
  /* …etc for the full flat list… */
}
```

Then `bg-primary`, `text-on-primary`, `bg-success-bg`, `text-warning`,
`border-border`, `bg-bg-alt` all resolve out of the box. Reference implementation
already exists: `hadoku_site/src/styles/global.css` hand-rolled exactly this
`@theme` color block (that's the subset-drift we're eliminating) — lift it into
the package, completed to the full symmetric set.

**Package bookkeeping:**

- Add the color mapping to the `./tailwind-integration.css` export (or add a new
  `./tailwind-colors.css` export in `themes/package.json`).
- Bump `@wolffm/themes` minor version; note the new tokens + the "colors now
  mapped for Tailwind" in `themes/README.md` and `CHANGELOG.md`.

### 1c. Acceptance criteria for Task 1

- Every semantic family has `{base, -dark, -bg, -hover, on-<f>}` in all 18 themes.
- All current token names still resolve (aliases) — nothing breaks on publish.
- A bare Tailwind consumer importing `tailwindcss` + the package's mapping gets
  working `bg-*`/`text-*`/`text-on-*`/`bg-*-bg` for every token, with no
  hand-written `@theme`.
- WCAG pairs still pass per `docs/THEME_SYSTEM_RULES.md`.

---

## Task 2 — De-handroll the ecosystem

**Goal:** every consumer consumes the platform mapping and nothing else; no
hand-maintained color `@theme`, no dead fallbacks, no hardcoded colors, and a
gate that makes regressions loud.

**Consumer repos** (theme-aware, verified): `hadoku_site`, `hadoku-resume-bot`,
`hadoku-contact-ui`, `hadoku-jobplatform`, `hadoku-trader`, `hadoku-aggregator`,
`hadoku-printTool`, `tenhands`, `watchpart2`, `upcominganimego`,
`personal-dataplatform`, `hadoku-task-mobile`, `brave-quartet`,
`color_palette_picker`, `fileSystemAgent`. (`hadoku-task` itself consumes tokens
as raw `var()` in `src/styles/*.css` — same rules apply.)

**Per repo:**

1. Replace the hand-written color `@theme` block with the package import
   (`@import "@wolffm/themes/tailwind-integration.css";` — or the new colors
   export). Delete the local color mapping.
2. **Remove every `var(--color-*, #hardcoded)` fallback** — the fallback is the
   silent-failure vector. `var(--color-x)` with no fallback: if the token is
   wrong it now renders `initial` (visibly broken) instead of a plausible wrong
   color. (hadoku_site alone has ~33 of these today.)
3. Replace hardcoded colors (`text-white`, `#fff`, `color: white`) with tokens
   (`text-on-<f>` on filled backgrounds; never a literal).
4. Migrate any alias/legacy token names to the canonical ones from Task 1, then
   the aliases can be dropped from the package.

**Ship the gate FROM the platform** (don't let each repo reinvent it). Two
checks, because each covers a blind spot the other misses:

- **(a) Unknown CSS custom properties** — `stylelint-value-no-unknown-custom-properties`
  with `importFrom: @wolffm/themes/style.css` (+ a repo-local source for any
  app-specific vars). Already adopted by trader/contact-ui/printTool; standardize
  the exact config. **Blind spot:** this rule _ignores `var(--x, fallback)` by
  design_ — which is why step 2 (ban fallbacks) is mandatory, not optional.
- **(b) Tailwind color classes vs. the token set** — stylelint only lints `.css`
  and never sees `bg-success-bg` in a `.tsx`. Add a scan (grep/script) that
  extracts every `(bg|text|border|ring|fill)-<token>` class used in
  `.tsx`/`.astro` and asserts each maps to a token the package defines. Reference
  implementation (proven in the hadoku_site fix):
  ```sh
  # tokens the package maps  vs  tokens used in components → any diff = fail
  used=$(grep -rhoE "\b(bg|text|border|ring|fill)-(primary|success|danger|warning|neutral|on-[a-z]+|text|bg|border)[a-z0-9-]*" src --include=*.tsx --include=*.astro \
        | sed -E 's/^(bg|text|border|ring|fill)-//' | sort -u)
  comm -23 <(echo "$used") <(package_mapped_tokens) # non-empty ⇒ broken class
  ```
  Ship this as a script in `@wolffm/themes` (e.g. `themes/scripts/check-color-usage.mjs`)
  so consumers run one command.
- Wire both into each repo's `lint:css` + `.husky/pre-commit` (and CI).

### 2c. Acceptance criteria for Task 2

- No consumer has a hand-written color `@theme` block.
- Zero `var(--color-*, #hex)` fallbacks in any consumer.
- Both gates run in pre-commit + CI in every consumer; a made-up token
  (`bg-fake`, `var(--color-nope)`) fails the build.
- Legacy aliases from Task 1b can be removed from the package (no remaining refs).

---

## Task 3 — Write a color **usage** guide (this does not exist yet)

`themes/THEME_CREATION_GUIDE.md` is for **authoring a new theme's colors** — it
is NOT a usage guide. There is currently **no** doc telling a developer/agent
which token to use for a given UI element. Create one.

**New file:** `themes/THEME_USAGE_GUIDE.md` (ship it in the package;
`themes/package.json` `files`/exports so it's readable from `node_modules`).

**Format — optimized for how agents actually read (decision table + full list +
anti-patterns, not prose):**

1. **One-line mental model:** "semantic role, not a fixed hue; light/dark is
   automatic — never branch on theme mode."
2. **Decision table** (the core — keep it to one screen):

   | You're styling…       | Use                                              |
   | --------------------- | ------------------------------------------------ |
   | Filled/primary button | `bg-<f> text-on-<f>` · hover `hover:bg-<f>-dark` |
   | Tint badge / banner   | `bg-<f>-bg text-<f>`                             |
   | Ghost / hover surface | `hover:bg-<f>-hover`                             |
   | Body text             | `text-text`                                      |
   | Secondary/muted text  | `text-text-secondary` / `text-text-tertiary`     |
   | Card / panel surface  | `bg-bg-card` (or `bg-bg-alt` for insets)         |
   | Border / divider      | `border-border`                                  |

   where `<f>` ∈ `primary | success | warning | danger | neutral`.

3. **The complete flat token list** (so there's nothing to guess) — generate it
   from `style.css` so it can't drift.
4. **Anti-patterns (hard rules):** never `text-white` / hardcoded hex; never
   `var(--x, #hex)` fallbacks; never `[data-theme]`-conditional colors in
   components; `on-<f>` is the ONLY correct text color on a filled `<f>` bg.
5. **Contrast contract:** link `docs/THEME_SYSTEM_RULES.md`.

**Exposure (so agents actually find it):**

- Ship it in the package (readable at `node_modules/@wolffm/themes/THEME_USAGE_GUIDE.md`).
- Add a 6-line "Colors" section to each consumer's `CLAUDE.md` that states the
  decision-table rules inline and links the guide. Agents reliably read
  `CLAUDE.md`; a standalone guide only helps if it's pointed to.

### 3c. Acceptance criteria for Task 3

- `THEME_USAGE_GUIDE.md` exists, is a table/rules doc (not prose), lists every
  token, and states the anti-patterns.
- Each consumer `CLAUDE.md` has a Colors section linking it.

---

## Sequencing

**1 → 2 → 3** by dependency, but **write the Task 3 guide against the Task 1
target contract** (symmetric set) so it documents the fixed system, not the mess.
Recommended order: 1a+1b (publish) → 3 (guide the new contract) → 2 (migrate
consumers to it, gate them). Task 1's back-compat aliases mean consumers keep
working throughout, so Task 2 can roll out repo-by-repo without a flag day.

## Appendix — the stylelint config the ecosystem already converged on

```js
// .stylelintrc.cjs  (trader e2176e2 / contact-ui 9b4ba0f / printTool ba2632b)
module.exports = {
  plugins: ['stylelint-value-no-unknown-custom-properties'],
  rules: {
    'csstools/value-no-unknown-custom-properties': [
      true,
      {
        importFrom: [
          require.resolve('@wolffm/themes/style.css'),
          require.resolve('./src/styles/base.css') // repo-local vars, if any
        ]
      }
    ]
  }
}
```

Reminder: this rule **passes** `var(--typo, #fallback)` because a fallback is
present — hence Task 2 step 2 (ban fallbacks) and gate (b) (Tailwind-class scan)
are both required to actually close the root cause.
