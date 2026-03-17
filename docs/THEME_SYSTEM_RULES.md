# Theme System Hard Rules

Research document covering non-negotiable rules for designing a multi-theme color system.
Based on analysis of Material Design 3, Radix Colors, Tailwind CSS, WCAG 2.2, and an audit of our current themes.

---

## 1. Contrast Ratios (WCAG 2.2 — Non-Negotiable)

These are legal accessibility requirements, not suggestions.

| Scenario                                              | Minimum Ratio | Standard                    |
| ----------------------------------------------------- | ------------- | --------------------------- |
| Normal text on background                             | **4.5:1**     | WCAG 2.2 SC 1.4.3 Level AA  |
| Large text (≥18pt or ≥14pt bold) on background        | **3:1**       | WCAG 2.2 SC 1.4.3 Level AA  |
| UI component boundaries (borders, icons, focus rings) | **3:1**       | WCAG 2.2 SC 1.4.11 Level AA |
| Enhanced contrast (AAA) normal text                   | **7:1**       | WCAG 2.2 SC 1.4.6 Level AAA |

### Hard Rules:

- **Every `--color-on-X` must achieve ≥4.5:1 against its paired `--color-X`.**
  Text on filled buttons is normal-sized, so 4.5:1 is the minimum, not 3:1.
- **Badge text must achieve ≥4.5:1 against its badge background.**
  A badge with `color: var(--color-success)` on `background: var(--color-success-bg)` must pass.
- **Never auto-calculate `on-X` without verifying the result.** Our cascade system derives `on-primary` via a simple `getContrastColor()` but this must be validated per theme.

### Our Current Status:

All button pairs pass WCAG AA:

| Button  | BG        | Text  | Ratio  | AA  |
| ------- | --------- | ----- | ------ | --- |
| Primary | `#2563eb` | white | 5.17:1 | ✅  |
| Success | `#0ea5e9` | black | 7.58:1 | ✅  |
| Warning | `#f59e0b` | black | 9.78:1 | ✅  |
| Danger  | `#f97316` | black | 7.49:1 | ✅  |
| Neutral | `#64748b` | white | 4.76:1 | ✅  |

**But "pass" ≠ "good".** Neutral at 4.76:1 barely clears 4.5:1. Material Design targets higher floors.

---

## 2. Color Pairing Is Mandatory (Material Design 3 Rule)

Material Design 3's single most important rule:

> **Colors must only be used in their designated pairs. Combining colors improperly breaks contrast under user-adjustable contrast levels.**

### The Pairing Pattern:

```
X          → background fill
on-X       → text/icons on X
X-container → softer fill (cards, chips)
on-X-container → text/icons on X-container
```

### Hard Rules:

- **`on-primary` is ONLY for text/icons that sit on a `primary` background.** Never use `on-primary` on `surface` or `bg`.
- **`primary` is ONLY for fills and backgrounds, never for body text.** Use `text` or `text-secondary` for body copy.
- **Container colors get their own `on-container` text color.** Don't reuse `on-primary` on `primary-bg` — the contrast math is different.
- **Each new surface level needs its own "on" color verified.**

### Violation in Our System:

We have `--color-primary-bg` but no `--color-on-primary-bg`. Badges using `color: var(--color-success)` on `background: var(--color-success-bg)` are creating an **unvalidated pair**. This works sometimes but is not guaranteed across all themes.

---

## 3. Semantic Colors Must Match Their Meaning

### Guidelines:

In conventional design systems, semantic colors follow universal hue associations.
However, our theme system intentionally allows creative freedom — themes express
personality through color choice (e.g., the light theme uses a "beach" palette
with sky-blue success and orange danger).

| Role               | Conventional Hue   | Our Approach                                       |
| ------------------ | ------------------ | -------------------------------------------------- |
| **Success**        | Green              | Theme-specific — can be any positive-feeling color |
| **Warning**        | Yellow / Amber     | Theme-specific — caution indicator                 |
| **Danger / Error** | Red                | Theme-specific — any bold contrasting color        |
| **Primary**        | Brand color        | Can be any hue                                     |
| **Neutral**        | Gray / desaturated | Should remain desaturated                          |

### Hard Rules:

- **All semantic colors MUST be visually distinct from each other** within each theme.
- **Success and danger MUST NOT be the same hue family** — users must be able to tell them apart.
- **Neutral MUST be desaturated.** Saturation ≤ 15% in HSL.
- **Each `--color-on-X` MUST achieve ≥4.5:1 contrast against its `--color-X`.**

### Acknowledged Exceptions:

The light theme uses a beach-inspired palette where `--color-success` is sky blue (#0ea5e9) and `--color-danger` is orange (#f97316). This is intentional and documented in `THEME_CREATION_GUIDE.md`, which states: "Success and Danger are theme-specific, not fixed to green/red."

- Radix Colors explicitly notes which scale steps have which foreground expectations. There is no ambiguity.

---

## 4. Radix 12-Step Scale Rules

Radix Colors defines the most rigorous scale structure in the industry. Key rules:

| Steps | Purpose                                          | Rule                                                       |
| ----- | ------------------------------------------------ | ---------------------------------------------------------- |
| 1–2   | App/card backgrounds                             | Must be near-white (light) or near-black (dark)            |
| 3–5   | Component backgrounds (normal → hover → pressed) | Must be progressively darker/lighter                       |
| 6–8   | Borders (subtle → interactive → strong)          | 6 for dividers, 7 for button borders, 8 for focus rings    |
| 9–10  | Solid fills (normal → hover)                     | **Highest chroma step.** Used for buttons, badges, headers |
| 11–12 | Text (low contrast → high contrast)              | Must achieve Lc 60 / Lc 90 APCA on step 2                  |

### Hard Rules:

- **Step 9 (solid fill) determines foreground color.** Most steps-9 use white text. Five exceptions use dark text: Sky, Mint, Lime, Yellow, Amber.
- **Never use a solid-fill color for text.** Step 9 is for backgrounds, steps 11–12 are for text.
- **Background steps (1–2) must have enough contrast with text steps (11–12) for readability.** This is guaranteed by Radix's math but must be manually verified in custom systems.

### Mapping to Our System:

```
Radix 1–2  → --color-bg, --color-bg-card
Radix 3–5  → --color-bg-hover, --color-primary-hover (with alpha)
Radix 6–8  → --color-border-light, --color-border
Radix 9    → --color-primary, --color-success, etc.
Radix 10   → --color-primary-dark (hover state)
Radix 11   → --color-text-secondary
Radix 12   → --color-text
```

---

## 5. Dark Theme Rules

Every design system agrees on these:

### Hard Rules:

- **Dark themes are NOT inverted light themes.** You cannot just swap white↔black.
- **Dark backgrounds use elevated surfaces, not lowered ones.** Higher = lighter in dark mode (Material Design).
- **Accent colors often need desaturation in dark mode.** Full-saturation colors on dark backgrounds cause eye strain and "vibration" effects.
- **Text in dark mode should NOT be pure white (`#ffffff`).** Use `#e2e8f0` to `#f1f5f9` range to reduce eye strain. Material Design uses tone 90 (not 100) for body text.
- **Dark mode primary colors should be lighter variants** of the light mode primary, not the same value. Material Design shifts from tone 40 (light) to tone 80 (dark).
- **Background in dark mode should not be pure black (`#000000`).** Use `#0f172a` or similar dark-slate. Pure black creates harsh edges on OLED screens and makes elevated cards invisible.

### Exceptions:

- OLED/AMOLED-optimized themes may use `#000000` intentionally.

---

## 6. State Management Rules

### Hard Rules:

- **Every interactive color needs at minimum: default, hover, active, focus, disabled states.**
- **Hover states should darken light fills and lighten dark fills** — a 5–10% lightness shift is standard.
- **Disabled states must be visually distinct but are exempt from contrast requirements** (WCAG 2.2 explicitly excludes inactive UI components).
- **Focus indicators must achieve 3:1 contrast against adjacent colors** (WCAG 2.2 SC 1.4.11).
- **State changes must not rely on color alone** (WCAG 2.2 SC 1.4.1). A hover that only changes color without any other visual cue (underline, shadow, scale) is insufficient.

---

## 7. The "on-X" Auto-Calculation Problem

Our cascade system auto-computes `on-X` (white or black) based on luminance. This has a known flaw:

### The Problem:

- Mid-range colors (L ≈ 0.18–0.25 in relative luminance) can go either way.
- A color at luminance 0.18 yields: white=4.31:1 (FAIL), black=4.64:1 (passes barely).
- The threshold in most `getContrastColor()` implementations uses luminance 0.179 as the cutoff. Colors near this boundary can flip between themes.

### Hard Rules:

- **Never blindly trust auto-calculated contrast text.** Always verify the computed `on-X` against its `X` background.
- **Prefer explicit `on-X` definitions per theme** over auto-calculation.
- **If auto-calculating, use WCAG ratio, not luminance threshold.** Compute both white and black contrast ratios, pick the higher one, and verify it's ≥ 4.5:1.
- **If neither white nor black achieves 4.5:1, the base color is unsuitable for a filled button.** Use it as a container/badge color instead (lower emphasis).

---

## 8. Color Space Rules

### Hard Rules:

- **HSL is insufficient for perceptually uniform color manipulation.** `hsl(120, 100%, 50%)` and `hsl(240, 100%, 50%)` have vastly different perceived brightness.
- **Use OKLCH or CIELAB for deriving variants.** Tailwind v4 moved entirely to OKLCH. Material Design uses HCT (Hue/Chroma/Tone).
- **If deriving dark/light variants by shifting L in HSL, verify contrast after every shift.** A -15 lightness shift might be fine for blue but catastrophic for yellow.
- **Alpha-based hover overlays are more robust than lightness shifts.** `hsla(primary, 8%)` over the current background adapts naturally to both light and dark themes.

---

## 9. Theme Portability Rules

When designing a system that supports user-created themes:

### Hard Rules:

- **Define a minimum set of required variables** and validate completeness at load time.
- **Every theme must be tested against a contrast matrix** before shipping.
- **Provide a reference theme** (and its full set of passing contrast ratios) that custom themes can be diff'd against.
- **Theme editors must show contrast ratios in real time** and flag violations before saving.
- **Export format must include metadata:** base theme, author, date, which variables were modified from baseline.

---

## 10. Summary: What We Must Fix

| Priority     | Issue                                                     | Status                                                               |
| ------------ | --------------------------------------------------------- | -------------------------------------------------------------------- |
| **Done**     | `--color-*-text` renamed to `--color-on-*`                | ✅ Completed — all 107 values fixed                                  |
| **Done**     | Light theme button text inconsistent (mix of black/white) | ✅ All `--color-on-*` set to white in light theme                    |
| **Done**     | Button hover effects inconsistent                         | ✅ Unified to `color-mix(in oklch, ..., black)`                      |
| **Accepted** | Success is not green in some themes                       | By design — themes express personality (see THEME_CREATION_GUIDE.md) |
| **P1**       | No `--color-on-X-container` variables                     | Badge text color is unvalidated against badge bg                     |
| **P1**       | Auto-calculated `on-X` is not verified                    | Add contrast validation to theme editor export                       |
| **P2**       | Some dark themes use pure white text                      | Consider `#e2e8f0` or similar off-white                              |
| **P2**       | Advanced surface mode incomplete                          | Simple/Advanced toggle exists but needs comprehensive design plan    |
| **P3**       | Theme editor doesn't show contrast ratios                 | Add live contrast ratio display in the editor panel                  |

---

## Sources

- [Material Design 3 — Color Roles](https://m3.material.io/styles/color/roles)
- [Material Design 3 — Color System Overview](https://m3.material.io/styles/color/system/overview)
- [Radix Colors — Understanding the Scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- [Tailwind CSS v4 — Colors (OKLCH)](https://tailwindcss.com/docs/customizing-colors)
- [WCAG 2.2 SC 1.4.3 — Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [WCAG 2.2 SC 1.4.11 — Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
