# Theme Creation Guide for AI Assistants

This guide helps AI systems generate new color themes for the @wolffm/themes package by analyzing color palettes and mapping them to our standardized theme structure.

## Theme Structure Overview

Each theme requires **28 color variables** organized into 7 categories. The system uses a hierarchical color assignment strategy where "main colors" are selected from the palette, and "alt colors" are derived through color manipulation.

### Required Variables by Category

#### 1. Primary Colors (6 variables)
**Purpose:** Main interactive elements, buttons, links
- `--color-primary` - **MAIN:** Primary brand color
- `--color-primary-dark` - **ALT:** Darker shade (darken 10-15%)
- `--color-primary-light` - **ALT:** Light tint for light themes / dark shade for dark themes
- `--color-primary-bg` - **ALT:** Very subtle background (5-10% opacity)
- `--color-primary-hover` - **ALT:** Hover state (primary at 6-15% opacity)

#### 2. Success Colors (3 variables)
**Purpose:** Positive actions, completed tasks
- `--color-success` - **MAIN:** Success/completion indicator
- `--color-success-dark` - **ALT:** Darker shade (darken 10-15%)
- `--color-success-text` - **ALT:** Text color on success backgrounds (light or dark)

#### 3. Danger Colors (5 variables)
**Purpose:** Destructive actions, errors, warnings
- `--color-danger` - **MAIN:** Error/danger indicator
- `--color-danger-dark` - **ALT:** Darker shade (darken 10-15%)
- `--color-danger-darker` - **ALT:** Even darker (darken 20-30%)
- `--color-danger-light` - **ALT:** Light tint/background shade
- `--color-danger-text` - **ALT:** Text color on danger backgrounds

#### 4. Neutral Colors (3 variables)
**Purpose:** Non-critical UI elements, disabled states
- `--color-neutral` - **MAIN:** Neutral gray or muted color
- `--color-neutral-light` - **ALT:** Lighter shade for subtle backgrounds
- `--color-neutral-lighter` - **ALT:** Even lighter for hover states

#### 5. Text Colors (4 variables)
**Purpose:** All text hierarchy
- `--color-text` - **MAIN:** Primary text color (dark for light themes, light for dark themes)
- `--color-text-secondary` - **ALT:** Secondary text (slightly muted)
- `--color-text-tertiary` - **ALT:** Tertiary text (more muted)
- `--color-text-muted` - **ALT:** Least prominent text

#### 6. Border Colors (2 variables)
**Purpose:** UI element boundaries
- `--color-border` - **ALT:** Default border color (subtle, derived from neutral)
- `--color-border-light` - **ALT:** Lighter border for less prominent divisions

#### 7. Background Colors (4 variables)
**Purpose:** Page and component backgrounds
- `--color-bg` - **MAIN:** Primary background
- `--color-bg-card` - **MAIN:** Card/panel background
- `--color-bg-alt` - **ALT:** Alternative background (slightly different shade)
- `--color-bg-overlay` - **ALT:** Modal/overlay background (semi-transparent)

#### 8. Shadows (6 variables)
**Purpose:** Depth and elevation
- `--shadow-sm` - **ALT:** Subtle shadow (derived from primary or black)
- `--shadow-md` - **ALT:** Medium shadow
- `--shadow-modal` - **ALT:** Strong shadow for modals
- `--shadow-focus` - **ALT:** Focus ring (primary at 20-40% opacity)
- `--shadow-focus-sm` - **ALT:** Small focus ring
- `--shadow-focus-alt` - **ALT:** Alternative focus ring

---

## Color Role Analysis from Existing Themes

### Main Colors (Selected from palette)
1. **Primary** - Brand identity color
2. **Success** - Green, yellow, orange, or bright accent
3. **Danger** - Contrasting color for warnings (red, purple, pink)
4. **Neutral** - Gray or desaturated color
5. **Text** - High contrast color for readability
6. **Background** - Base canvas color
7. **Card Background** - Elevated surface color

### Alt Colors (Derived through manipulation)
- **Darker shades** - darken(main, 10-30%)
- **Lighter tints** - lighten(main, 10-40%) or adjust alpha
- **Text contrast** - Calculate based on background luminance
- **Borders** - Desaturate and adjust brightness
- **Shadows** - Use primary or black with alpha

---

## AI Theme Generation Process

### Step 1: Analyze Input Palette
Given a color list like:
```
#e4bea6, #f6e9e1, #d2936b, #d3c2b7, #f0bb9a, #312843, #544573, 
#0e0b13, #363636, #6553cc, #9a8edd, #4130a2, #7c74ab, #7f5b55, 
#a6817a, #513a36, #6a6a6a, #9f99a9, #c6c3cc, #787085, #a1a1a1
```

**Sort by luminance and saturation:**
- Darkest colors → Backgrounds (dark theme)
- Lightest colors → Backgrounds (light theme)
- Most saturated → Primary, Success, Danger
- Desaturated → Neutral, Borders

### Step 2: Assign Main Colors

#### For Light Theme:
```
--color-primary: [Most vibrant/saturated mid-tone]
--color-success: [Green-ish or complementary bright color]
--color-danger: [Red/Orange/Pink or contrasting vibrant]
--color-neutral: [Muted gray or desaturated color]
--color-text: [Darkest color with good contrast]
--color-bg: [Lightest color]
--color-bg-card: [Second lightest or pure white]
```

#### For Dark Theme:
```
--color-primary: [Brightest saturated color]
--color-success: [Bright accent that pops]
--color-danger: [Bold contrasting color]
--color-neutral: [Mid-tone gray]
--color-text: [Lightest color]
--color-bg: [Darkest color]
--color-bg-card: [Second darkest]
```

### Step 3: Generate Alt Colors

Use color manipulation functions:

```javascript
// Darker shades
--color-primary-dark: darken(primary, 15%)

// Lighter tints (light theme)
--color-primary-light: lighten(primary, 40%)

// Darker tints (dark theme)
--color-primary-light: darken(primary, 30%)

// Background with opacity
--color-primary-bg: rgba(primary, 0.05) // light theme
--color-primary-bg: rgba(primary, 0.15) // dark theme

// Hover states
--color-primary-hover: rgba(primary, 0.08) // light theme
--color-primary-hover: rgba(primary, 0.15) // dark theme

// Text colors (progressive desaturation)
--color-text-secondary: adjust-brightness(text, -15%)
--color-text-tertiary: adjust-brightness(text, -30%)
--color-text-muted: adjust-brightness(text, -45%)

// Borders (from neutral or background)
--color-border: mix(neutral, bg, 70%)
--color-border-light: mix(neutral, bg, 50%)

// Shadows
--shadow-sm: 0 1px 2px rgba(primary, 0.08)
--shadow-focus: 0 0 0 3px rgba(primary, 0.25)
```

### Step 4: Validate Contrast

Ensure WCAG AA compliance:
- **Primary text on background:** ≥ 4.5:1
- **Secondary text on background:** ≥ 3:1
- **UI elements on background:** ≥ 3:1

---

## Example: Generating "Sunset" Theme

### Input Palette:
```
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
[data-theme="sunset-light"] {
  /* Main Colors */
  --color-primary: #ff6b35;              /* Vibrant orange */
  --color-success: #fdc830;              /* Golden yellow */
  --color-danger: #004e89;               /* Deep blue */
  --color-neutral: #e0e0e0;              /* Light gray */
  --color-text: #2d2d2d;                 /* Dark gray */
  --color-bg: #ffffff;                   /* Pure white */
  --color-bg-card: #f4f4f4;              /* Off-white */
  
  /* Alt Colors (derived) */
  --color-primary-dark: #e65a2a;         /* darken(#ff6b35, 10%) */
  --color-primary-light: #ffe0d5;        /* lighten(#ff6b35, 50%) */
  --color-primary-bg: #fff5f2;           /* rgba(#ff6b35, 0.05) */
  --color-primary-hover: rgba(255, 107, 53, 0.08);
  
  --color-success-dark: #e0b425;
  --color-success-text: white;
  
  --color-danger-dark: #003d6e;
  --color-danger-darker: #002c4f;
  --color-danger-light: #e6f2ff;
  --color-danger-text: white;
  
  --color-neutral-light: #f4f4f4;
  --color-neutral-lighter: #fafafa;
  
  --color-text-secondary: #555555;
  --color-text-tertiary: #888888;
  --color-text-muted: #aaaaaa;
  
  --color-border: #e0e0e0;
  --color-border-light: #efefef;
  
  --color-bg-alt: #f9f9f9;
  --color-bg-overlay: rgba(45, 45, 45, 0.5);
  
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

- [ ] All 28 color variables are defined
- [ ] All 6 shadow variables are defined
- [ ] Primary text has ≥4.5:1 contrast on main background
- [ ] Theme works in both light and dark variants
- [ ] Hover states are visually distinct but subtle
- [ ] Success/Danger colors are clearly different from Primary
- [ ] Focus rings are visible on all backgrounds
- [ ] Theme name follows kebab-case convention: `theme-name-light` / `theme-name-dark`

---

## Common Pitfalls

1. **Insufficient contrast** - Text must be readable
2. **Too similar colors** - Primary, Success, Danger should be distinct
3. **Harsh transitions** - Derived colors should be smooth gradations
4. **Ignoring accessibility** - Always check WCAG guidelines
5. **Inconsistent opacity** - Use similar alpha values for similar purposes
6. **Missing dark variant** - Every theme needs both light and dark versions

---

## Resources

- WCAG Contrast Checker: https://webaim.org/resources/contrastchecker/
- Color Harmonies: https://color.adobe.com
- Palette Extraction: Use image processing to extract dominant colors
