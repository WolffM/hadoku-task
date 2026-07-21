# Handoff — migrate the remaining consumer repos to @wolffm/themes 3.x

**Status:** ready to execute. Platform work is done and live; this is the fan-out.
**Prereq reading:** `node_modules/@wolffm/themes/THEME_USAGE_GUIDE.md` (ships in the package).
**Background:** `docs/planning/theme-tailwind-upgrade.md` in `hadoku-task`.

---

## What already happened

`@wolffm/themes@3.0.1` is published and live. It consolidated the token set into a
rectangle — every semantic family has exactly
`{base, -dark, -bg, -hover, on-<f>, on-<f>-bg}`, 41 tokens — and **removed six
legacy tokens with no back-compat aliases** (deliberate; aliases were rejected as
permanent debt). It also ships `tailwind-colors.css`, a complete Tailwind v4
colour mapping generated from `style.css`.

Already migrated and verified in prod:

- **hadoku-task** — published 3.0.1, in-repo CSS migrated, gates wired into `lint:css` + pre-commit.
- **hadoku_site** — hand-rolled colour `@theme` block deleted, 58 gate problems → 0, deployed, all 6 CI checks green.
- **hadoku-resume-bot** — 3 dead-token refs fixed (`ae91c46`). Fallback hygiene still outstanding (see below).

## The deadline you're working against

Every consumer's `update-wolffm.yml` runs `pnpm update "@wolffm/*" --latest`,
which **ignores the `^2.0.16` caret and crosses the major boundary**. It fires on
`repository_dispatch` _and_ a 6-hourly cron. So every repo below will move to
3.0.1 on its own whether or not it has been migrated — resume-bot already did.

If you need to stop the clock, pin `@wolffm/themes` to `^2.0.16` with an exact
range or change that workflow off `--latest`. Otherwise just work the list.

---

## The token map

| Removed                   | Replace with                                                                                                                      | Notes                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `--color-primary-light`   | `--color-primary-bg`                                                                                                              | tint surface                                       |
| `--color-danger-light`    | `--color-danger-bg`                                                                                                               | same value, renamed onto the `<family>-bg` pattern |
| `--color-danger-darker`   | `--color-danger-dark`                                                                                                             | `danger` was the only family with two dark shades  |
| `--color-neutral-light`   | `--color-neutral-bg`, **or** `--color-bg-hover` if it was a hover surface, **or** `--color-bg-alt` if it was an inset/alt surface | read the rule before choosing                      |
| `--color-neutral-lighter` | `--color-neutral-bg` or `--color-bg-alt`                                                                                          | same judgement call                                |
| `--color-muted-bg`        | `--color-neutral-bg`                                                                                                              | orphan name that broke the `<family>-bg` pattern   |

**New and worth adopting:** `--color-on-<f>-bg` — the text colour for the `<f>-bg`
tint. Using `--color-<f>` as text on `--color-<f>-bg` fails WCAG AA in 62 of 90
theme×family combinations; that pairing is why badges kept coming out unreadable.

---

## Work list, measured

"Breakage" = references to deleted tokens. These render as nothing — the only
thing that is actually visibly wrong. Counts are from a scan on 2026-07-21;
re-measure before you start.

| repo                  | on 3.0.1? | breakage  | what                                                   |
| --------------------- | --------- | --------- | ------------------------------------------------------ |
| hadoku-jobplatform    | not yet   | **13**    | `muted-bg`×7, `danger-darker`×3, `danger-light`×3      |
| hadoku-contact-ui     | not yet   | **9**     | `primary-light`×4, `danger-light`×4, `danger-darker`×1 |
| hadoku-aggregator     | not yet   | **7**     | `danger-light`×5, `primary-light`×1, `muted-bg`×1      |
| hadoku-printTool      | not yet   | **3**     | `danger-light`×3                                       |
| hadoku-trader         | not yet   | **0**     | gate/hygiene pass only                                 |
| personal-dataplatform | not yet   | **0**     | gate/hygiene pass only                                 |
| hadoku-resume-bot     | **yes**   | 0 (fixed) | ~78 `var()` fallbacks remain                           |

Repos with no `@wolffm/themes` dependency — skip unless they gain one:
`tenhands`, `watchpart2`, `upcominganimego`, `hadoku-task-mobile`,
`brave-quartet`, `color_palette_picker`, `fileSystemAgent`.

### Breakage vs hygiene — keep these separate

The gate reports both; they are not equally urgent.

- **Breakage** — a reference to a deleted token. Renders as nothing. Fix first.
- **Hygiene** — `var(--color-x, #hex)` fallbacks. These still _render_, using the
  hardcoded fallback, which looks right in the default light theme and wrong in
  the other 17. Not a visible break today, but it is the silent-failure vector
  that hid `--color-text-primary` (a token that never existed) for months.

---

## Per-repo recipe

```sh
cd <repo>
pnpm install                       # get 3.0.1 into node_modules
node node_modules/@wolffm/themes/scripts/check-usage.mjs ./src
```

The gate reports five classes of problem:

1. **unknown-token** — `var(--color-*)` naming something that doesn't exist → use the map above.
2. **unknown-class** — a Tailwind colour class with no matching token. stylelint
   cannot catch these; it never reads `.tsx`. This is how hadoku_site shipped
   white buttons.
3. **fallback** — `var(--x, #hex)`. Delete the fallback, keep `var(--x)`.
4. **layered-import** — `@import '@wolffm/themes/style.css' layer(...)`. Must be unlayered (see below).
5. **tint-pair** — `--color-<f>` used as text on `--color-<f>-bg` → `--color-on-<f>-bg`.

Then:

- **Delete any hand-written colour `@theme` block** and `@import '@wolffm/themes/tailwind-colors.css'` instead.
  Keep non-colour `@theme` entries (font weights, line heights, transitions, extra shadows) — the package does not map those.
- **Replace hardcoded text on filled backgrounds.** `color: white` / `#fff` /
  `text-white` / `var(--color-bg)` on a `--color-<f>` fill is wrong in half the
  themes. Use `text-on-<f>` / `var(--color-on-<f>)`. **The gate does NOT catch
  this** — it is a wrong token, not a missing one. Grep for it manually:
  ```sh
  grep -rnE 'color:\s*(white|#fff|var\(--color-bg\))' src
  ```
- **Locally-defined `--color-*` names** (pre-theme skeletons etc.) should be
  renamed so they don't read as theme tokens — both hadoku-task and hadoku_site
  renamed theirs to `--skeleton-shimmer`.
- **Wire the gate in** so it can't regress:
  ```jsonc
  "lint:css": "stylelint \"src/**/*.css\" && node node_modules/@wolffm/themes/scripts/check-usage.mjs ./src"
  ```
  and make sure `lint:css` is in whatever aggregate script CI runs.
- **Add a Colors section to the repo's `CLAUDE.md`** — copy the one from
  `hadoku-task/CLAUDE.md` or `hadoku_site/CLAUDE.md`. Agents read CLAUDE.md; a
  standalone guide only helps if something points at it.

## Two gotchas that will cost you an hour each

1. **`style.css` must be imported UNLAYERED.** Tailwind emits every `@theme`
   entry into `@layer theme` as `:root { --x: var(--x) }` — self-referential and
   invalid on its own. It resolves only because `style.css` declares the same
   properties outside any cascade layer, and unlayered beats layered. Import it
   with `layer(base)` and all 41 colours silently become `transparent`. Verified.

2. **`--color-text-tertiary` and `--color-text-muted` are decorative-only.**
   Measured against `bg`/`bg-card`/`bg-alt` across 18 themes, `-tertiary` fails
   AA in 5 and `-muted` in 14. Any text a user must read takes `--color-text` or
   `--color-text-secondary`. Disabled states are exempt (WCAG excludes inactive
   controls). Worth a sweep in each repo.

## Verification bar

Do not sign off on typecheck/build alone — an unmapped Tailwind class produces
**no CSS rule at all**, so nothing in the toolchain fails.

1. `check-usage` clean.
2. Build, then confirm the utilities actually generate and resolve. Note that
   Astro **inlines** CSS for `client:only` pages rather than emitting a
   stylesheet, so grep the built HTML, not just `dist/**/*.css`.
3. Load the app and switch through several themes (include a dark one and
   `izakaya-light`, which has the most translucent tints) — confirm no element
   renders with a missing background and no light-on-light text.

## Known-flaky infrastructure (not your bug)

- `pnpm/action-setup@v5` self-installer crashing with
  `ENOENT: process.cwd failed` — a runner workdir race, seen on hadoku-contact-ui.
  Re-run.
- `ERR_PNPM_ERR_SQLITE_ERROR: database disk image is malformed` on the
  hadoku-task runner — corrupted pnpm store. Will keep failing that repo's
  auto-update until the store is cleared.
