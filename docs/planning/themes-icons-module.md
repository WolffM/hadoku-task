# Icons module in `@wolffm/themes`

**Status: planned, not started.** Written 2026-08-12 from a hadoku_site planning session.
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

| Consumer id | Current emoji | Suggested icon name |
| ----------- | ------------- | ------------------- |
| category `me` | 👋 | `wave` |
| app `resume` | 📄 | `document` |
| app `contact` | 📧 | `mail` |
| category `studio` | 🎨 | `palette` |
| app `printtool` | 🖨️ | `printer` |
| app `conjure` | ✨ | `sparkles` |
| app `pygmalion` | 🎭 | `masks` |
| app `promptsmith` | 🔧 | `wrench` |
| category `aggregators` | 📡 | `antenna` |
| app `aggregator` | 🔍 | `magnifier` |
| app `jobplatform` | 💼 | `briefcase` |
| category `workflows` | ⚙️ | `gear` |
| app `tenhands` | 🖐️ | `hand` |
| app `task` | ✅ | `check` |
| category `watch` | 🎬 | `clapper` |
| app `watchparty` | 🍿 | `popcorn` |
| app `dataplatform` | 📼 | `videotape` |

(A category-reorg is happening in hadoku_site in parallel, so treat the *names* as the
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
   moves to the icon's *chrome* (ring/glow/badge) rather than the glyph.
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
