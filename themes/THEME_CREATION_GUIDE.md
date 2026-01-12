# Theme Creation Guide for AI Assistants

This guide helps AI systems generate new color themes for the @wolffm/themes package by analyzing color palettes and mapping them to our standardized theme structure.

## Theme Structure Overview

Each theme requires **34 color variables** + **6 shadow variables** = **40 total variables**. The system uses a hierarchical color assignment strategy where "main colors" are selected from the palette, and "alt colors" are derived through color manipulation.

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

All other 35 variables (29 colors + 6 shadows) are **derived** from these 5 main colors using color manipulation.

---

### Required Variables by Category

#### 1. Primary Colors (6 variables)

**Purpose:** Main interactive elements, buttons, links

- `--color-primary` - **MAIN:** Primary brand color
- `--color-primary-dark` - **ALT:** Darker shade (darken 10-15%)
- `--color-primary-light` - **ALT:** Light tint for light themes / dark shade for dark themes
- `--color-primary-bg` - **ALT:** Very subtle background (5-10% opacity)
- `--color-primary-hover` - **ALT:** Hover state (primary at 6-15% opacity)
- `--color-primary-text` - **ALT:** Text on primary backgrounds (white or black for contrast)

#### 2. Success Colors (4 variables)

**Purpose:** Positive actions, completed tasks, checkmarks

- `--color-success` - **MAIN:** Success/completion indicator
- `--color-success-dark` - **ALT:** Darker shade (~10-15% darker, or pick complementary from palette)
- `--color-success-text` - **ALT:** Text on success backgrounds (white or black for contrast)
- `--color-success-bg` - **ALT:** Background for success badges (10-15% opacity of success color)

#### 3. Warning Colors (3 variables)

**Purpose:** Intermediate states, caution indicators, pending actions

- `--color-warning` - **MAIN:** Warning/caution indicator (typically amber/yellow)
- `--color-warning-bg` - **ALT:** Background for warning badges (10-15% opacity of warning color)
- `--color-warning-text` - **ALT:** Text on warning backgrounds (usually black for yellow/amber)

#### 4. Danger Colors (5 variables)

**Purpose:** Destructive actions, errors, warnings

- `--color-danger` - **MAIN:** Error/danger indicator
- `--color-danger-dark` - **ALT:** Darker shade (darken 10-15%)
- `--color-danger-darker` - **ALT:** Even darker (darken 20-30%)
- `--color-danger-light` - **ALT:** Light tint/background shade
- `--color-danger-text` - **ALT:** Text color on danger backgrounds (auto-calculated)

#### 5. Neutral Colors (5 variables)

**Purpose:** Non-critical UI elements, disabled states, unknown/neutral badges

- `--color-neutral` - **MAIN:** Neutral gray or muted color
- `--color-neutral-light` - **ALT:** Lighter/darker variant for subtle backgrounds
- `--color-neutral-lighter` - **ALT:** Even lighter/darker for hover states
- `--color-neutral-text` - **ALT:** Text on neutral backgrounds (white or black for contrast)
- `--color-muted-bg` - **ALT:** Background for neutral/unknown badges

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

- `--shadow-sm` - **ALT:** Subtle shadow (derived from primary or black)
- `--shadow-md` - **ALT:** Medium shadow
- `--shadow-modal` - **ALT:** Strong shadow for modals
- `--shadow-focus` - **ALT:** Focus ring (primary at 20-40% opacity)
- `--shadow-focus-sm` - **ALT:** Small focus ring
- `--shadow-focus-alt` - **ALT:** Alternative focus ring

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

```css
--color-primary:
  [Brightest saturated color that pops] --color-success: [Bright accent - yellow, neon,
  cyan work great] --color-danger: [Bold color that contrasts with primary - purple, pink,
  etc.] --color-neutral: [Mid-tone gray] --color-bg: [Darkest color - can be pure black or tinted];
```

**Pro Tip:** Success and Danger should be visually distinct from Primary AND from each other. Test them side-by-side!

### Step 3: Generate 22 Alt Colors + 6 Shadows

Use color manipulation functions:

```javascript
// === From PRIMARY ===
--color-primary-dark: darken(primary, 15%)
--color-primary-light: lighten(primary, 40%) // light theme
--color-primary-light: darken(primary, 30%)  // dark theme
--color-primary-bg: rgba(primary, 0.05)      // light theme
--color-primary-bg: rgba(primary, 0.15)      // dark theme
--color-primary-hover: rgba(primary, 0.08)   // light theme
--color-primary-hover: rgba(primary, 0.15)   // dark theme

// === From SUCCESS ===
--color-success-dark: darken(success, 15%)
--color-success-text: getContrastText(success) // auto: white or black

// === From DANGER ===
--color-danger-dark: darken(danger, 15%)
--color-danger-darker: darken(danger, 30%)
--color-danger-light: lighten(danger, 40%)     // light theme
--color-danger-light: darken(danger, 30%)      // dark theme
--color-danger-text: getContrastText(danger)   // auto: white or black

// === From NEUTRAL ===
--color-neutral-light: lighten(neutral, 20%)   // light theme
--color-neutral-light: darken(neutral, 20%)    // dark theme
--color-neutral-lighter: lighten(neutral, 30%) // light theme
--color-neutral-lighter: darken(neutral, 30%)  // dark theme

// === From BACKGROUND ===
--color-text: getContrastText(bg)           // auto: dark or light for 4.5:1
--color-text-secondary: rgba(text, 0.8)
--color-text-tertiary: rgba(text, 0.6)
--color-text-muted: rgba(text, 0.4)

--color-bg-card: lighten(bg, 3%)            // light theme
--color-bg-card: lighten(bg, 5%)            // dark theme
--color-bg-alt: darken(bg, 2%)              // light theme
--color-bg-alt: darken(bg, 5%)              // dark theme
--color-bg-hover: mix(bg, bg-alt, 50%)      // subtle hover state
--color-bg-overlay: rgba(text, 0.5)

--color-border: mix(neutral, bg, 70%)
--color-border-light: mix(neutral, bg, 50%)

// === Shadows (from primary or black) ===
--shadow-sm: 0 1px 2px rgba(primary, 0.08)      // or rgba(0,0,0,0.4) for dark
--shadow-md: 0 2px 4px rgba(primary, 0.12)
--shadow-modal: 0 8px 24px rgba(primary, 0.2)
--shadow-focus: 0 0 0 3px rgba(primary, 0.25)
--shadow-focus-sm: 0 0 0 2px rgba(primary, 0.25)
--shadow-focus-alt: 0 0 0 2px rgba(primary, 0.15)
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

  /* ===== 22 ALT COLORS + 6 SHADOWS (derived) ===== */

  /* From Primary */
  --color-primary-dark: #e65a2a; /* darken 10% */
  --color-primary-light: #ffe0d5; /* lighten 50% */
  --color-primary-bg: #fff5f2; /* rgba 5% */
  --color-primary-hover: rgba(255, 107, 53, 0.08);

  /* From Success */
  --color-success-dark: #e0b425; /* darken 10% */
  --color-success-text: #1a1a1a; /* auto-contrast */

  /* From Danger */
  --color-danger-dark: #003d6e; /* darken 15% */
  --color-danger-darker: #002c4f; /* darken 30% */
  --color-danger-light: #e6f2ff; /* lighten 40% */
  --color-danger-text: white; /* auto-contrast */

  /* From Neutral */
  --color-neutral-light: #f4f4f4; /* lighten 20% */
  --color-neutral-lighter: #fafafa; /* lighten 30% */

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
  --shadow-sm: 0 1px 2px rgba(255, 107, 53, 0.08);
  --shadow-md: 0 2px 4px rgba(255, 107, 53, 0.12);
  --shadow-modal: 0 8px 24px rgba(255, 107, 53, 0.2);
  --shadow-focus: 0 0 0 3px rgba(255, 107, 53, 0.25);
  --shadow-focus-sm: 0 0 0 2px rgba(255, 107, 53, 0.25);
  --shadow-focus-alt: 0 0 0 2px rgba(255, 107, 53, 0.15);
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

- [ ] All 34 color variables are defined
- [ ] All 6 shadow variables are defined (40 total)
- [ ] Primary text has ≥4.5:1 contrast on main background
- [ ] Theme works in both light and dark variants
- [ ] Hover states are visually distinct but subtle
- [ ] Success/Warning/Danger colors are clearly different from Primary
- [ ] Focus rings are visible on all backgrounds
- [ ] Theme name follows kebab-case convention: `theme-name-light` / `theme-name-dark`

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
