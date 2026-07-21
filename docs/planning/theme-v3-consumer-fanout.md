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

All known breakage has been fixed as of 2026-07-21. What remains is hygiene
(`var()` fallbacks) and wiring the gate into repos that lack it. **Re-measure
before trusting this table** — use the deployed-bundle check below.

| repo                  | on 3.0.1? | breakage            | what                                              |
| --------------------- | --------- | ------------------- | ------------------------------------------------- |
| hadoku-jobplatform    | yes       | **done** `a507e9a`  | fallback hygiene may remain                       |
| hadoku-contact-ui     | yes       | **done** `9996ceb`  | prod bundle was stale; redeploys clean            |
| hadoku-aggregator     | yes       | **done** `e387240`  | local checkout is diverged from origin — see note |
| hadoku-printTool      | yes       | **done** `92b93a2`  | fallback hygiene may remain                       |
| personal-dataplatform | yes       | **done** `3def316`  | —                                                 |
| hadoku-trader         | yes       | none needed         | 0 dead refs; gate/hygiene pass only               |
| hadoku-resume-bot     | yes       | **done** `ae91c46`  | ~78 `var()` fallbacks remain                      |
| tenhands              | yes       | **done** `3d76ee8`  | auto-update no-ops — see note below               |
| watchpart2            | yes       | **done** `ee4ff19a` | manifest in `apps/ui/`                            |

### Do NOT scope this by `package.json` dependency

An earlier version of this doc said to skip repos that don't depend on
`@wolffm/themes`. **That was wrong and it hid live prod breakage.** A
micro-frontend gets its tokens from hadoku_site at runtime, so it can use
`var(--color-*)` and Tailwind colour classes while declaring no dependency at
all — or while pinned to a stale 2.x that never auto-updated.

Two repos were broken on prod for exactly this reason and have since been fixed:

- **tenhands** — 24 dead refs + 19 tint anti-patterns (`3d76ee8`). Its manifest
  lives in `frontend/`, and `update-wolffm.yml` runs `pnpm update -r` at the repo
  root where there is no `package.json`, so **its auto-update silently no-ops**.
- **watchpart2** — hand-rolled colour `@theme` with four stale self-references,
  plus local aliases (`--color-text-primary`, `--color-success-text`) (`ee4ff19a`).
  Manifest is in `apps/ui/`.

**Scope by token usage, not by dependency**, and mind that source roots vary
(`frontend/src`, `apps/ui/src`, not always `./src`):

```sh
# find every repo that touches theme tokens, however it declares them
grep -rl -E 'var\(--color-|(bg|text|border)-(primary|success|warning|danger|neutral)' \
  ~/repos/*/ --include=*.css --include=*.tsx --include=*.astro 2>/dev/null \
  | grep -v node_modules | cut -d/ -f5 | sort -u
```

Then confirm against the **deployed** bundles, which is ground truth:

```sh
for mf in contact aggregator printtool jobplatform dataplatform task resume tenhands watchparty; do
  n=$(curl -s "https://hadoku.me/mf/$mf/style.css" \
      | grep -coE 'var\(--color-(danger-light|primary-light|muted-bg|neutral-light|neutral-lighter|danger-darker)\)')
  echo "$mf: $n dead refs"
done
```

Still believed clear (no token usage found): `upcominganimego`,
`hadoku-task-mobile`, `brave-quartet`, `color_palette_picker`, `fileSystemAgent`.
Re-check with the grep above rather than trusting this list.

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

## Known false positive in the gate

`check-usage` validates Tailwind classes against the **package's** token set
only. A repo that defines its own alias in a local `@theme` block — e.g.
`--color-text-primary: var(--color-text)` — makes `text-text-primary` a working
class, but the gate still reports it as "not mapped by @wolffm/themes".

Before "fixing" an `unknown-class` report, check whether the repo defines it
locally. If it does, the class works; the right move is still to drop the local
alias and use the real token, but it is cleanup, not breakage. (`var()` checks
do not have this problem — those already account for local definitions.)

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
