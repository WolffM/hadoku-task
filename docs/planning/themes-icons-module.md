# Icons module in `@wolffm/themes`

**Status: SHIPPED in @wolffm/themes 5.3.0 (2026-08-12).** Written 2026-08-12 from a
hadoku_site planning session; executed the same day. Three things changed against the
plan — see "How it actually shipped" at the bottom before using this doc as a spec.
The original text is left intact so the reasoning that got overturned is still legible.
This doc is self-contained — an agent in this repo should be able to execute it without
reading hadoku_site first. The consumer-side work (rewiring the frontpage POCs) stays in
hadoku_site and is explicitly out of scope here.

## Why

The hadoku.me frontpage (and every child app) currently renders icons as **raw emoji
characters** — the `icon` field in hadoku_site's `spec/categories.json` is an emoji, and the
contract there says "render them directly — no icon font, no SVG sprite." That was a
deliberate bake-off fairness rule, and it's now the problem: platform emoji fonts render
these glyphs inconsistently and, on some platforms, plain ugly. There is no way to fix that
from CSS — the artwork has to ship with the site.

Decision from the operator: this becomes an **ecosystem capability inside `@wolffm/themes`**
(not a separate package — "I can't imagine a situation where I wouldn't want both"). Themes
already carries the ecosystem's shared visual contract (tokens, Tailwind mapping, unified
header lives next door in `task-ui-components`), so icons belong here.

## Requirements

1. **Enforced set.** A curated allowlist of named icons. Consumers reference icons by name
   (`IconName` string union exported from the package); an icon outside the set must fail —
   at the type level for TS consumers, and via a scanner script for everything else (same
   philosophy as `scripts/check-usage.mjs`, which already polices color-token usage across
   consumer repos).
2. **Consistent artwork.** Bundle SVGs so every platform renders identically. No runtime
   dependence on platform emoji fonts, no icon-font webfont, no external CDN (the frontpage
   ships under a strict CSP).
3. **Theme-integrated accent.** The operator wants icons to carry a **third accent color**
   and specifically asked for the existing `warning` family (frontpage visuals today
   gradient mostly between success/danger, so warning is the unused third). The tokens
   already exist in all 18 themes with the full six-token shape (`--color-warning`, `-dark`,
   `-bg`, `-hover`, `--color-on-warning`, `--color-on-warning-bg`) — **no new tokens**.
   `check:contrast` already validates the family. This constrains the artwork style (see
   open question 1).
4. **Framework-spread consumers.** The frontpage POCs are Astro (one is Qwik); child apps
   are mostly React/Preact. The module therefore needs BOTH:
   - a React component (`<Icon name="..." />`) alongside the existing React exports
     (`HadokuThemeRoot` et al.), and
   - a framework-free path: raw SVG string lookup (`getIconSvg(name)`) and/or a build-time
     sprite, consumable from an `.astro` template with no client JS.
5. **Coverage.** The initial set must cover every icon the frontpage catalogue uses today
   (17 total, listed below) plus room to grow. Adding an icon = adding artwork + name to
   the registry in this package; consumers never inline their own.

## Current icon inventory (hadoku_site `spec/categories.json`, 2026-08-12)

| Consumer id            | Current emoji | Suggested icon name |
| ---------------------- | ------------- | ------------------- |
| category `me`          | 👋            | `wave`              |
| app `resume`           | 📄            | `document`          |
| app `contact`          | 📧            | `mail`              |
| category `studio`      | 🎨            | `palette`           |
| app `printtool`        | 🖨️            | `printer`           |
| app `conjure`          | ✨            | `sparkles`          |
| app `pygmalion`        | 🎭            | `masks`             |
| app `promptsmith`      | 🔧            | `wrench`            |
| category `aggregators` | 📡            | `antenna`           |
| app `aggregator`       | 🔍            | `magnifier`         |
| app `jobplatform`      | 💼            | `briefcase`         |
| category `workflows`   | ⚙️            | `gear`              |
| app `tenhands`         | 🖐️            | `hand`              |
| app `task`             | ✅            | `check`             |
| category `watch`       | 🎬            | `clapper`           |
| app `watchparty`       | 🍿            | `popcorn`           |
| app `dataplatform`     | 📼            | `videotape`         |

(A category-reorg is happening in hadoku_site in parallel, so treat the _names_ as the
stable contract, not the grouping. Names describe the pictograph, not the app, so a
reorg never renames an icon.)

## Open questions the executing agent should settle with the operator

1. **Artwork style — the tintability tension.** Full-color emoji artwork (vendoring a
   subset of Noto Emoji / Twemoji SVGs) looks rich but **cannot take the warning-accent
   tint** — you can't `currentColor` a five-color glyph. Monochrome or duotone line icons
   tint perfectly (fill/stroke driven by `--color-warning` / `-dark`) and will sit better
   against the frontpage's WebGPU scenes, but mean sourcing or drawing 17+ consistent
   glyphs. Recommendation: **monochrome/duotone**, sourced from a permissively-licensed
   set with wide coverage (e.g. Phosphor (MIT) or Lucide (ISC)); reserve full-color for a
   later `variant` prop if ever wanted. If instead full-color wins, the warning accent
   moves to the icon's _chrome_ (ring/glow/badge) rather than the glyph.
2. **Licensing.** Whatever set is vendored: Phosphor MIT, Lucide ISC, Noto Apache-2.0,
   Twemoji CC-BY-4.0 (attribution required — least attractive). Record the choice + license
   file in the package.
3. **Sprite vs. inline.** One SVG symbol sprite (small, cacheable, but needs a DOM injection
   step) vs. per-icon inline SVG strings (tree-shakeable, trivial for Astro). Either is fine;
   pick one and document it.

## Shape of the work in this package

- `themes/src/icons/` — registry (`registry.ts` exporting `ICONS: Record<IconName, string>`
  and the `IconName` union), artwork, React `<Icon>` component honouring size + accent props.
- Exports map additions in `themes/package.json` (keep `files` in sync — this package
  publishes `src/*.css` and `scripts/` as files, so new runtime assets must be added there).
- Default rendering: glyph tinted with `--color-warning` family, sized in `em` so it scales
  with text; props/attributes for the other four families for consumers with a reason.
  Follow the existing rule set: tint-on-bg pairs use `--color-on-warning-bg`, filled chips
  use `--color-on-warning`. `check:contrast` covers the tokens; nothing new to verify there.
- Enforcement: extend `scripts/check-usage.mjs` (or add `check-icons.mjs` beside it, wired
  into `pnpm validate`) to flag consumer-side raw-emoji icon fields and unknown icon names.
- Docs: section in `THEME_USAGE_GUIDE.md` (the guide hadoku_site's CLAUDE.md tells every
  agent to read before styling) — icon list, both consumption paths, the "names come from
  the registry, never inline your own SVG" rule.
- Tests: registry completeness (every `IconName` has artwork), React component renders +
  applies tokens, and the doc-sync check (`check:docs`) if the guide gains a generated table.
- Release: additive **minor** version. Publishes flow through the existing monorepo publish
  workflow; hadoku_site picks it up via the normal `packages_updated` dispatch.

## Explicitly out of scope (stays in hadoku_site)

- Rewiring the three frontpage POCs (`pocs/07-webgpu-bento`, `10-yggdrasil-circuit`,
  `03-mobile-editorial`) from raw emoji to this module, including changing the
  `spec/categories.json` `icon` field from emoji to registry names and updating
  `spec/CONTRACT.md` + `spec/assets/README.md` (whose "icons are emoji, render directly"
  rule this work retires).
- The frontpage's new hover/click-card interaction work — separate workstream, only
  coincidentally adjacent.

---

## How it actually shipped

### 1. The set is 78 icons, not 17

The plan's inventory was `hadoku_site/spec/categories.json` alone. A scan of every repo
with commits in the last 12 months (39 repos) found **~55 distinct emoji in authored UI
across 16 apps** — the catalogue's 17 plus a whole interaction vocabulary the plan
missed: refresh, trash, edit, eye, clipboard, lock, play, star, shuffle, hourglass,
volume (3 states), robot, user, clock, calendar, wand, broom, package, info, link.

The registry ships 78: those, plus the lucide set `hadoku-pygmalion` already consumes
through its own local `icons.tsx`, so that file can now retire in favour of this one.

Two lessons for the next inventory:

- **Filter to authored source.** Naively scanning `/repos` yields 3459 "distinct emoji",
  almost all junk: `fileSystemAgent` vendors a Hayabusa/Sigma rule enumerating ~964
  emoji to _detect_ suspicious CLI usage, ArchiveBot stores Discord reaction dumps, and
  skin-tone/ZWJ variants trebled the count.
- **Match `Extended_Pictographic`, not `Emoji_Presentation`.** `⚙` U+2699, `▶` U+25B6,
  `✏` U+270F and `⚠` U+26A0 default to TEXT presentation, so an emoji-presentation
  filter misses them — and this repo was shipping a bare `⚙` as its board-settings
  button. The symbols that legitimately appear as text glyphs (`✓` `×` `↺` `→`) are not
  pictographic at all, so the looser rule costs no false positives.

### 2. The warning accent moved to the tile — the glyph could not carry it

Requirement 3 asked for the glyph itself tinted `--color-warning`, on the grounds that
"`check:contrast` already validates the family; nothing new to verify there."

That last clause was the error. `check:contrast` validates `on-<f>` over `<f>`; it never
looks at an accent over a _surface_. Measured across all 18 themes on `--color-bg-card`
and `--color-bg`, a bare accent glyph misses WCAG 1.4.11's 3:1 non-text minimum in **8
of 36 combinations for `warning` alone** — light 2.15, ocean-light 1.92, pink-light 1.67
— and every other family fails somewhere too. `--color-<f>-dark` does not rescue it.
This is the same accent-as-text anti-pattern `check-usage.mjs` rule 6 already gates.

So the plan's own escape hatch became the default path: bare glyphs inherit
`currentColor` (no contrast obligation of their own), and the accent lives on a **tile** —
`tint` (`--color-<f>-bg` + `--color-on-<f>-bg`) or `filled` (`--color-<f>` +
`--color-on-<f>`). Both clear 3:1 in 18/18 themes for all five families, verified in a
real browser off computed style.

### 3. Open questions, as resolved

1. **Artwork** — monochrome line icons, artwork vendored from **Lucide (ISC)**. Decided
   on precedent: `hadoku-pygmalion` had already replaced its ad-hoc emoji with
   `lucide-react`, sized to `1em` on the text baseline, and the operator confirmed that
   set looks right. Lucide covers 71/71 names needed, including the awkward ones
   (`popcorn`, `clapperboard`, `videotape`, `drama`, `satellite-dish`).
2. **Licensing** — ISC. `themes/LICENSE-lucide` is committed. Pinned to
   `lucide-static@1.28.0` (a `devDependency`; nothing is added at runtime).
3. **Sprite vs inline** — **inline**, and the performance question turned out not to
   decide it. Cloud Four's stress test at _1000_ icons spans 67ms (`<img>`+data-URI) to
   149ms (mask-image), with inline SVG at 75ms; at the ~17 the frontpage renders, that
   spread is under a millisecond. What actually decides it: the fastest technique
   (`<img src="data:">`) cannot be tinted with `currentColor` at all, and inline is the
   fastest technique that can. Optimisation mattered far more than technique — inline
   SVG went 75ms → 192ms unoptimised.

### What exists now

| Thing                   | Where                                                         |
| ----------------------- | ------------------------------------------------------------- |
| Allowlist (hand-edited) | `themes/src/icons/sources.json`                               |
| Generator + drift check | `themes/scripts/generate-icons.mjs [--check]`                 |
| Vendored artwork        | `themes/src/icons/registry.generated.ts` (do not edit)        |
| React component         | `<Icon name variant family size title/>` — `@wolffm/themes`   |
| Framework-free          | `getIconSvg()`, `getIconTileClass()` — `@wolffm/themes/icons` |
| Styles                  | `@wolffm/themes/icons.css` (import **unlayered**)             |
| Enforcement             | `themes/scripts/check-icons.mjs`, wired into `pnpm validate`  |
| Docs                    | `themes/THEME_USAGE_GUIDE.md` § Icons                         |
| Runtime verification    | `e2e/icons.spec.ts`, `e2e/icons-in-app.spec.ts`               |

Adding an icon: add a `"name": "lucide-slug"` line to `sources.json`, run
`pnpm run generate:icons`, commit the regenerated registry.

### Still to do (unchanged from "out of scope", plus one)

- Rewire the three frontpage POCs and `spec/categories.json` in **hadoku_site**, and
  retire the "icons are emoji, render directly" rule in `spec/CONTRACT.md`.
- Migrate the other child apps. `check-icons.mjs` run against each repo prints the
  exact list; `hadoku-pygmalion`'s local `icons.tsx` is the easiest win since it is
  already lucide.
- **Not done:** the 7 automation-board e2e specs that fail on `main` (pre-existing at
  a0a3729, unrelated to icons). Their `beforeEach` times out in
  `waitForLoadState('networkidle')` — something on an automation board polls
  continuously, so the page never goes idle.
