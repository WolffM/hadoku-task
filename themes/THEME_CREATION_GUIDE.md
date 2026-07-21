# Theme Creation Guide for AI Assistants

This guide helps AI systems generate new color themes for the @wolffm/themes package by analyzing color palettes and mapping them to our standardized theme structure.

## Tailwind v4 Compatibility Note

All spacing, typography, radius, and shadow variables use the `--hdk-*` namespace to avoid collisions with Tailwind v4's internal CSS variables. Color variables (`--color-*`) don't conflict and remain unchanged.

| Variable Type | Naming Convention       | Example           |
| ------------- | ----------------------- | ----------------- |
| Spacing       | `--hdk-space-*`         | `--hdk-space-md`  |
| Font Size     | `--hdk-text-*`          | `--hdk-text-sm`   |
| Border Radius | `--hdk-radius-*`        | `--hdk-radius-lg` |
| Shadows       | `--hdk-shadow-*`        | `--hdk-shadow-sm` |
| Colors        | `--color-*` (unchanged) | `--color-primary` |

## Theme Structure Overview

Each theme requires **34 color variables** + **6 shadow variables** = **40 total variables**. The system uses a hierarchical color assignment strategy where "main colors" are selected from the palette, and "alt colors" are derived through color manipulation.

> **CRITICAL: `--color-on-*` variables (text on colored surfaces)**
>
> The `--color-on-primary`, `--color-on-success`, `--color-on-warning`, `--color-on-danger`,
> and `--color-on-neutral` variables define the text color for use **ON TOP OF** that color's
> background (e.g., text on a primary-colored button). These must be computed from the
> **luminance of the color itself**, NOT from the theme mode.
>
> **WRONG:** "This is a light theme, so all `--color-on-*` = black"
> **RIGHT:** "--color-primary is #2563eb (dark blue, low luminance) so --color-on-primary = white"
>
> Use the WCAG relative luminance formula: if luminance > 0.179, use `black`; otherwise `white`.

### Color Variables Count:

- Primary colors: 6 (includes text)
- Success colors: 4
- Warning colors: 3 (includes text)
- Danger colors: 5
- Neutral colors: 5 (includes text and muted-bg)
- Text colors: 4
- Border colors: 2
- Background colors: 5
- **Total: 34 color variables**

### Additional Variables:

- Shadow variables: 6
- **Grand Total: 40 variables per theme**

### The 5 Main Colors (From Palette)

These are the only colors you need to select from the input palette. **Be creative** - these are guidelines, not rules:

1. **`--color-primary`** - Primary brand color
   - Usually the most vibrant/saturated color
2. **`--color-success`** - Success/completion indicator
   - Any bright, positive-feeling color
3. **`--color-danger`** - Error/warning/delete indicator
   - Any bold, contrasting color that stands out
   - Should contrast well with primary and success
4. **`--color-neutral`** - Neutral/muted base
   - Desaturated or gray tone
   - Used for borders, disabled states
5. **`--color-bg`** - Primary background
   - Lightest color for light themes
   - Darkest color for dark themes

All other 42 variables (36 colors + 6 shadows) are **derived** from these 5 main colors using color manipulation.

---

### Required Variables by Category

#### 1–5. Semantic Families (6 variables each)

All five families — `primary`, `success`, `warning`, `danger`, `neutral` —
take **exactly the same six tokens**. There are no per-family exceptions; an
asymmetric set is what made consumers reach for names that did not exist.

| token               | purpose                                                   | how to derive                                                                      |
| ------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `--color-<f>`       | **MAIN:** the solid fill                                  | your palette choice                                                                |
| `--color-<f>-dark`  | bottom stop of the filled-button gradient / pressed state | darken ~0.07 OKLCH L, bounded so `on-<f>` still clears 4.5:1                       |
| `--color-<f>-bg`    | faint tint surface for badges, chips, banners             | the fill at 10% alpha (light) / 15% (dark)                                         |
| `--color-<f>-hover` | translucent overlay for ghost + row hover                 | the fill at 6% alpha (light) / 10% (dark)                                          |
| `--color-on-<f>`    | text/icons ON the solid fill                              | black or white — whichever scores the higher WCAG ratio, NOT a luminance threshold |
| `--color-on-<f>-bg` | text/icons ON the tint                                    | the fill's hue/chroma, lightness walked away from the tint until ≥4.5:1            |

**Purposes:** `primary` = main interactive elements · `success` = positive/
completed · `warning` = caution/pending · `danger` = destructive/errors ·
`neutral` = non-critical, disabled, unknown.

> Do not hand-compute these. Author the five MAIN colours, then run
> `node themes/scripts/normalize-tokens.mjs` to derive the rest in OKLCH and
> `node themes/scripts/check-contrast.mjs` to verify every pair. The editor's
> live HSL cascade is a preview, not the authority.

#### 6. Text Colors (4 variables)

**Purpose:** All text hierarchy

- `--color-text` - **ALT:** Primary text (auto-calculated based on bg luminance for 4.5:1 contrast)
- `--color-text-secondary` - **ALT:** Secondary text (slightly muted, 80% opacity)
- `--color-text-tertiary` - **ALT:** Tertiary text (60% opacity)
- `--color-text-muted` - **ALT:** Least prominent text (40% opacity)

#### 7. Border Colors (2 variables)

**Purpose:** UI element boundaries

- `--color-border` - **ALT:** Default border color (derived from neutral)
- `--color-border-light` - **ALT:** Lighter border (derived from neutral-light)

#### 8. Background Colors (5 variables)

**Purpose:** Page and component backgrounds

- `--color-bg` - **MAIN:** Primary background canvas
- `--color-bg-card` - **ALT:** Card/panel background
  - Can be pure white/black
  - Or lighten/darken bg by 3-5%
  - Or add subtle hue shift for character
- `--color-bg-alt` - **ALT:** Alternative background (slightly different from bg)
- `--color-bg-hover` - **ALT:** Hover state background (subtle, between bg and bg-alt)
- `--color-bg-overlay` - **ALT:** Modal/overlay background (semi-transparent)

#### 9. Shadows (6 variables)

**Purpose:** Depth and elevation

- `--hdk-shadow-sm` - **ALT:** Subtle shadow (derived from primary or black)
- `--hdk-shadow-md` - **ALT:** Medium shadow
- `--hdk-shadow-lg` - **ALT:** Strong shadow for modals/dialogs
- `--hdk-shadow-focus` - **ALT:** Focus ring (primary at 20-40% opacity)
- `--hdk-shadow-focus-sm` - **ALT:** Small focus ring
- `--hdk-shadow-focus-alt` - **ALT:** Alternative focus ring

---

## Derivation Strategy

### Alt Colors (Derived or Selected Creatively)

You have two approaches for deriving the 22 alt colors (+ 6 shadows):

#### Option A: Algorithmic (Recommended for AI)

- **Darker shades** - darken(main, 10-30%)
- **Lighter tints** - lighten(main, 10-40%) or adjust alpha
- **Text contrast** - Calculate based on background luminance
- **Borders** - Desaturate and adjust brightness
- **Shadows** - Use primary or black with alpha

#### Option B: Creative Selection (Recommended for Designers)

- Pick complementary colors from the input palette
- Add subtle hue shifts to create mood
- Use palette harmony (analogous, triadic, etc.)
- Example: Strawberry theme has pink hue shifts in backgrounds

---

## Real Examples from Existing Themes

### How Success & Danger Colors Vary:

| Theme          | Success          | Danger             | Notes                |
| -------------- | ---------------- | ------------------ | -------------------- |
| **Light**      | #0ea5e9 (cyan)   | #f97316 (orange)   | Cool + warm contrast |
| **Dark**       | #fde047 (yellow) | #c084fc (purple)   | High contrast neons  |
| **Strawberry** | #22c55e (green)  | #ec4899 (hot pink) | Traditional green    |
| **Ocean**      | #f97316 (orange) | #ec4899 (pink)     | Coral reef vibes     |
| **Cyberpunk**  | #00f5d4 (cyan)   | #fb5607 (orange)   | Neon dystopia        |
| **Coffee**     | #eab308 (gold)   | #78350f (brown)    | Warm earth tones     |
| **Lavender**   | #84cc16 (lime)   | #6366f1 (indigo)   | Unexpected pops      |
| **Nature**     | #a7d88f (sage)   | #c8643b (rust)     | Organic palette      |

**Takeaway:** Success and Danger are **theme-specific**, not fixed to green/red!

---

## AI Theme Generation Process

### Step 1: Analyze Input Palette

Given a color list like:

```text
#e4bea6, #f6e9e1, #d2936b, #d3c2b7, #f0bb9a, #312843, #544573,
#0e0b13, #363636, #6553cc, #9a8edd, #4130a2, #7c74ab, #7f5b55,
#a6817a, #513a36, #6a6a6a, #9f99a9, #c6c3cc, #787085, #a1a1a1
```

**Sort by luminance and saturation:**

- Darkest colors → Backgrounds (dark theme)
- Lightest colors → Backgrounds (light theme)
- Most saturated → Primary, Success, Danger
- Desaturated → Neutral, Borders

### Step 2: Assign 5 Main Colors

#### For Light Theme:

```css
--color-primary: [Most vibrant/saturated color - your theme's identity]
--color-success: [Any bright, positive color - can be cyan, yellow, green, orange]
--color-danger: [Contrasting bold color - pick what feels right]
--color-neutral: [Muted gray or desaturated color]
--color-bg: [Lightest color - can be pure white or tinted]
```

#### For Dark Theme:

<!-- prettier-ignore -->
```css
--color-primary: [Brightest saturated color that pops]
--color-success: [Bright accent - yellow, neon, cyan work great]
--color-danger: [Bold color that contrasts with primary - purple, pink, etc.]
--color-neutral: [Mid-tone gray]
--color-bg: [Darkest color - can be pure black or tinted]
```

**Pro Tip:** Success and Danger should be visually distinct from Primary AND from each other. Test them side-by-side!

### Step 3: Generate 36 Derived Colors + 6 Shadows

Use color manipulation functions:

```javascript
// Every family derives identically — same three tokens, same maths.
// f ∈ { primary, success, warning, danger, neutral }

--color-<f>-dark:  darkenOklch(<f>, 0.07)   // bounded: on-<f> must stay ≥ 4.5:1
--color-<f>-bg:    rgba(<f>, 0.10)          // light theme;  0.15 in dark themes
--color-<f>-hover: rgba(<f>, 0.06)          // light theme;  0.10 in dark themes

// Contrast text — pick by MEASURED WCAG ratio, never a luminance threshold
--color-on-<f>:    higherContrastOf(black, white, <f>)
--color-on-<f>-bg: shiftLightness(<f>) away from <f>-bg until ratio ≥ 4.5:1

// === From BACKGROUND ===
--color-text: getContrastText(bg)           // auto: dark or light for 4.5:1
--color-text-secondary: rgba(text, 0.8)
--color-text-tertiary: rgba(text, 0.6)
```

### Step 4: Validate Contrast

Ensure WCAG AA compliance:

- **Primary text on background:** ≥ 4.5:1
- **Secondary text on background:** ≥ 3:1
- **UI elements on background:** ≥ 3:1

---

## Example: Generating "Sunset" Theme

### Input Palette:

```text
#ff6b35, #f7931e, #fdc830, #004e89, #1a659e,
#f4f4f4, #2d2d2d, #1a1a1a, #ffffff, #e0e0e0
```

### Analysis:

- **Vibrant oranges/yellows:** #ff6b35, #f7931e, #fdc830
- **Cool blues:** #004e89, #1a659e
- **Neutrals:** #2d2d2d, #1a1a1a, #f4f4f4, #e0e0e0
- **Pure:** #ffffff

### Light Theme Assignment:

```css
[data-theme='sunset-light'] {
  /* ===== 5 MAIN COLORS (from palette) ===== */
  --color-primary: #ff6b35; /* Vibrant orange */
  --color-success: #fdc830; /* Golden yellow */
  --color-danger: #004e89; /* Deep blue */
  --color-neutral: #e0e0e0; /* Light gray */
  --color-bg: #ffffff; /* Pure white */

  /* ===== 36 DERIVED COLORS + 6 SHADOWS ===== */

  /* From Primary */
  --color-primary-dark: #e65a2a; /* darken 10% */
  --color-primary-bg: #fff5f2; /* 10% tint */
  --color-on-primary: black; /* auto-contrast, measured */
  --color-primary-hover: rgba(255, 107, 53, 0.08);

  /* From Success */
  --color-success-dark: #e0b425; /* darken 10% */
  --color-on-success: #1a1a1a; /* auto-contrast: success is bright, so dark text */

  /* From Danger */
  --color-danger-dark: #003d6e; /* darken 15% */
  --color-danger-bg: #e6f2ff; /* 10% tint */
  --color-on-danger-bg: #003d6e; /* text on the tint */
  --color-on-danger: white; /* auto-contrast: danger is dark blue, so white text */

  /* From Neutral */
  --color-neutral-bg: #f4f4f4; /* 10% tint */
  --color-neutral-dark: #c7c7c7; /* darken 0.07 L */

  /* From Background (auto-calculated) */
  --color-text: #2d2d2d; /* auto: dark for light bg */
  --color-text-secondary: rgba(45, 45, 45, 0.8);
  --color-text-tertiary: rgba(45, 45, 45, 0.6);
  --color-text-muted: rgba(45, 45, 45, 0.4);

  --color-bg-card: #f4f4f4; /* lighten bg 3% */
  --color-bg-alt: #f9f9f9; /* darken bg 2% */
  --color-bg-hover: #f7f7f7; /* between bg and bg-alt */
  --color-bg-overlay: rgba(45, 45, 45, 0.5);

  /* Borders (from neutral + bg) */
  --color-border: #e0e0e0; /* mix(neutral, bg, 70%) */
  --color-border-light: #efefef; /* mix(neutral, bg, 50%) */

  /* Shadows */
  --hdk-shadow-sm: 0 1px 2px rgba(255, 107, 53, 0.08);
  --hdk-shadow-md: 0 2px 4px rgba(255, 107, 53, 0.12);
  --hdk-shadow-lg: 0 8px 24px rgba(255, 107, 53, 0.2);
  --hdk-shadow-focus: 0 0 0 3px rgba(255, 107, 53, 0.25);
  --hdk-shadow-focus-sm: 0 0 0 2px rgba(255, 107, 53, 0.25);
  --hdk-shadow-focus-alt: 0 0 0 2px rgba(255, 107, 53, 0.15);
}
```

---

## Quick Reference: Color Manipulation

### JavaScript/TypeScript Helpers

```typescript
function darken(hex: string, percent: number): string {
  // Decrease HSL lightness by percent
}

function lighten(hex: string, percent: number): string {
  // Increase HSL lightness by percent
}

function adjustAlpha(hex: string, alpha: number): string {
  // Convert to rgba with alpha
}

function mix(color1: string, color2: string, weight: number): string {
  // Blend two colors
}

function getContrastText(bg: string): 'light' | 'dark' {
  // Return 'light' if bg is dark, 'dark' if bg is light
  // Based on WCAG luminance calculation
}
```

---

## Theme Checklist

Before submitting a new theme, verify:

- [ ] All 34 color variables are defined (`--color-*`)
- [ ] All 6 shadow variables are defined (`--hdk-shadow-*`)
- [ ] Primary text has ≥4.5:1 contrast on main background
- [ ] Theme works in both light and dark variants
- [ ] Hover states are visually distinct but subtle
- [ ] Success/Warning/Danger colors are clearly different from Primary
- [ ] Focus rings are visible on all backgrounds
- [ ] Theme name follows kebab-case convention: `theme-name-light` / `theme-name-dark`
- [ ] Uses `--hdk-*` namespace for spacing, text, radius, and shadow variables

---

## Common Pitfalls

1. **Insufficient contrast** - Text must be readable (≥4.5:1 ratio)
2. **Too similar colors** - Primary, Success, Danger should be visually distinct
3. **Ignoring accessibility** - Always check WCAG guidelines
4. **Forgetting the mood** - Themes should have personality and character
5. **Over-relying on formulas** - Sometimes picking from the palette works better than algorithmic derivation
6. **Missing dark variant** - Every theme needs both light and dark versions

## Creativity Encouraged!

**Don't be afraid to:**

- Use unexpected color combinations
- Add subtle hue shifts to backgrounds
- Pick complementary colors from palette instead of darkening
- Create unique shadows and focus rings
- Break the "rules" if it looks good and meets accessibility standards

---

## Resources

- WCAG Contrast Checker: <https://webaim.org/resources/contrastchecker/>
- Color Harmonies: <https://color.adobe.com>
- Palette Extraction: Use image processing to extract dominant colors
