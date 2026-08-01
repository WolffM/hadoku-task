# Theme Usage Guide — which token do I use?

**This is the doc for _using_ colors.** For authoring a new theme's palette, see
[`THEME_CREATION_GUIDE.md`](./THEME_CREATION_GUIDE.md). For the accessibility
contracts, see [`docs/THEME_SYSTEM_RULES.md`](../docs/THEME_SYSTEM_RULES.md).

## The mental model, in one line

**A token names a semantic role, not a hue. Light/dark is automatic — never
branch on theme mode.**

There are 18 themes. `--color-success` is sky blue in one and gold in another.
Pick the token that matches what the element _means_; the theme decides the color.

---

## Decision table

`<f>` is one of `primary` · `success` · `warning` · `danger` · `neutral`.

| You're styling…                  | Use                                                              |
| -------------------------------- | ---------------------------------------------------------------- |
| Filled / primary button          | `bg-<f>` + `text-on-<f>`                                         |
| …its gradient or pressed state   | `bg-<f>-dark` (still pair with `text-on-<f>`)                    |
| Tint badge, chip, banner, alert  | `bg-<f>-bg` + `text-on-<f>-bg`                                   |
| Ghost button / row hover tint    | `hover:bg-<f>-hover`                                             |
| Body text                        | `text-text`                                                      |
| Secondary / muted text           | `text-text-secondary` → `text-text-tertiary` → `text-text-muted` |
| Page background                  | `bg-bg`                                                          |
| Card / panel surface             | `bg-bg-card`                                                     |
| Inset or alternate surface       | `bg-bg-alt`                                                      |
| Neutral row/button hover surface | `bg-bg-hover`                                                    |
| Modal scrim                      | `bg-bg-overlay`                                                  |
| Border / divider                 | `border-border`                                                  |
| Subtle divider                   | `border-border-light`                                            |

### The one rule people get wrong

`--color-<f>` and `--color-<f>-bg` are **different surfaces with different text
colors.** They are not interchangeable.

```
bg-<f>       (solid fill)  →  text-on-<f>
bg-<f>-bg    (faint tint)  →  text-on-<f>-bg     ← NOT text-<f>
```

Using `text-<f>` on `bg-<f>-bg` fails WCAG AA in 62 of 90 theme/family
combinations. That pairing is why badges kept turning up unreadable.

### The same rule, one step further out

A fill colour is not a text colour **on any surface**, not just on its own tint.
`text-<f>` with no background at all lands on the page or a card, and that pair
was validated by nothing: `check-contrast` checks `on-<f>` over `<f>`, so
accent-over-surface passed by never being looked at.

```
text-<f>  with no background   →  lands on bg / bg-card   ← unvalidated, usually fails
```

Measured against `--color-bg`: `--color-primary` clears the 3:1 large-text floor
in only 12 of 18 themes (izakaya-light 1.92, nature-light 2.15, ocean-light 2.28,
lavender-light 2.53, pink-light 2.56, strawberry-light 2.61). `--color-danger`
misses AA on a card in 11 of 18. This shipped in `.app-header__title` and reached
every consuming app at once.

Text on a surface is `text-text` (8.87–17.58 across all 18) or
`text-text-secondary`. To carry an accent, either pair `bg-<f>-bg` with
`text-on-<f>-bg`, or move the accent off the glyph entirely — a border, rule, or
underline is unconstrained by text contrast. `check-usage` gates this.

---

## Complete token list

Every token below is defined in **all 18 themes**. Nothing else exists — if a
name isn't here, it isn't a token.

### Semantic families

| family    | fill              | gradient/pressed       | tint surface         | hover overlay           | text on fill         | text on tint            |
| --------- | ----------------- | ---------------------- | -------------------- | ----------------------- | -------------------- | ----------------------- |
| `primary` | `--color-primary` | `--color-primary-dark` | `--color-primary-bg` | `--color-primary-hover` | `--color-on-primary` | `--color-on-primary-bg` |
| `success` | `--color-success` | `--color-success-dark` | `--color-success-bg` | `--color-success-hover` | `--color-on-success` | `--color-on-success-bg` |
| `warning` | `--color-warning` | `--color-warning-dark` | `--color-warning-bg` | `--color-warning-hover` | `--color-on-warning` | `--color-on-warning-bg` |
| `danger`  | `--color-danger`  | `--color-danger-dark`  | `--color-danger-bg`  | `--color-danger-hover`  | `--color-on-danger`  | `--color-on-danger-bg`  |
| `neutral` | `--color-neutral` | `--color-neutral-dark` | `--color-neutral-bg` | `--color-neutral-hover` | `--color-on-neutral` | `--color-on-neutral-bg` |

The table is a **rectangle on purpose.** Every family has exactly the same six
tokens, so the symmetric guess is always the right one.

### Structural

| role            | token                    | AA-safe for text?     |
| --------------- | ------------------------ | --------------------- |
| body text       | `--color-text`           | ✅ all 18 themes      |
| secondary text  | `--color-text-secondary` | ✅ all 18 themes      |
| tertiary text   | `--color-text-tertiary`  | ⚠️ fails in 5 themes  |
| muted text      | `--color-text-muted`     | ⚠️ fails in 14 themes |
| border          | `--color-border`         | —                     |
| subtle border   | `--color-border-light`   | —                     |
| page background | `--color-bg`             | —                     |
| card surface    | `--color-bg-card`        | —                     |
| alt surface     | `--color-bg-alt`         | —                     |
| hover surface   | `--color-bg-hover`       | —                     |
| modal scrim     | `--color-bg-overlay`     | —                     |

> **`-tertiary` and `-muted` are decorative-only.** Measured against
> `bg`/`bg-card`/`bg-alt` in all 18 themes, `-tertiary` drops below 4.5:1 in 5
> and `-muted` in 14. Use them for de-emphasised ornament (placeholder glyphs,
> disabled states — WCAG exempts inactive controls). **Any text a user must
> read gets `--color-text` or `--color-text-secondary`**, both of which clear
> AA on every surface in every theme. `check-contrast.mjs` gates those two and
> deliberately does not gate the other two.

**41 tokens total.** Non-color tokens (spacing, radius, shadows, type) use the
`--hdk-*` prefix — see [`README.md`](./README.md).

---

## Anti-patterns — hard rules

| ❌ Never                                                                    | ✅ Instead                      | Why                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `text-white`, `color: #fff` on a filled button                              | `text-on-<f>`                   | `--color-<f>` is light in many themes; white-on-light is invisible                                            |
| `var(--color-x, #hex)`                                                      | `var(--color-x)`                | A fallback renders the hardcoded value, so a wrong token looks right in light mode and breaks in the other 17 |
| `text-<f>` on `bg-<f>-bg`                                                   | `text-on-<f>-bg`                | Fails AA in 62/90 theme×family combinations                                                                   |
| `[data-theme='dark'] .foo { color: … }`                                     | one token, no branch            | Tokens already switch per theme; branching double-applies                                                     |
| Inventing `--color-<f>-light` / `-lighter` / `-darker` / `--color-muted-bg` | the six canonical family tokens | Removed in v3.0.0 — see [`THEME_GRAVEYARD.md`](./THEME_GRAVEYARD.md)                                          |
| `--color-<f>` as body text                                                  | `--color-text`                  | Solid fills are for backgrounds; §4 of the rules doc                                                          |
| `@import "@wolffm/themes/style.css" layer(base)`                            | import it **unlayered**         | Layering it makes every color resolve to nothing                                                              |

---

## Setup

```css
@import '@wolffm/themes/style.css'; /* 1. tokens — MUST be unlayered */
@import 'tailwindcss'; /* 2. Tailwind */
@import '@wolffm/themes/tailwind-colors.css'; /* 3. the color mapping */
```

That's the whole integration. **Do not hand-write an `@theme` color block** —
`tailwind-colors.css` maps all 41 tokens, and a local copy is exactly the
drift this package exists to prevent.

Not using Tailwind? Import step 1 only and use `var(--color-*)` directly.

### Why step 1 must stay unlayered

Tailwind emits each `@theme` entry into `@layer theme` as `:root { --x: var(--x) }`
— self-referential, and invalid on its own. It resolves only because
`style.css` declares the same properties **outside** any cascade layer, and
unlayered declarations win. Put it in a layer and all 41 colors silently
become `transparent`.

---

## Verify it

```sh
node node_modules/@wolffm/themes/scripts/check-usage.mjs ./src
```

Fails the build on: unknown tokens, Tailwind classes with no matching token,
`var()` fallbacks, and layered imports of `style.css`. Wire it into `lint` and
pre-commit — an unmapped class produces **no CSS rule at all**, so neither
typecheck nor build will ever catch it for you.
