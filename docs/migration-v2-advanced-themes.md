# Migration Guide: Metallic → Advanced Theme System

**Breaking change in:** `@wolffm/themes@2.0.5`, `@wolffm/task-ui-components@1.3.6`

The old per-theme metallic gradient system has been replaced with a named advanced theme architecture. Only mapped themes (currently `light` → `beach-day`) get gradient effects. All other themes use standard flat colors.

---

## 1. Deleted Components

`MetallicSurface` and `ShimmerOverlay` have been removed from `@wolffm/task-ui-components`.

```tsx
// BEFORE — breaks at import
import { MetallicSurface, ShimmerOverlay } from '@wolffm/task-ui-components'
;<MetallicSurface withNoise withHighlight className="profile-card h-full">
  <ShimmerOverlay active />
  {children}
</MetallicSurface>
```

```tsx
// AFTER — replace with a plain wrapper div
// The advanced gradient is now applied automatically via CSS to .task-app__item
// For non-task-item cards (like bento cards), use standard theme colors

<div className="profile-card h-full" style={{ background: 'var(--color-bg-card)' }}>
  {children}
</div>
```

### Files to update in hadoku-site

| File                                             | What to change                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/bento/cards/ProfileCard.tsx`     | Remove `MetallicSurface` import and wrapper. Use a plain `<div>` with `background: var(--color-bg-card)` or `var(--color-primary)`.                                                        |
| `src/components/bento/cards/AppCardContent.tsx`  | Remove `MetallicSurface` import and wrapper. Remove `card-gradient-offset` class. Remove `--card-hue-offset` style prop.                                                                   |
| `src/components/bento/cards/ThemePickerCard.tsx` | Remove `MetallicSurface` import and wrapper. Remove `--metallic-radius` style prop. Use a plain `<div className="rounded-full shadow-sm" style={{ background: 'var(--color-bg-card)' }}>`. |

### Deleted types

Remove any imports of:

- `MetallicSurfaceProps`
- `ShimmerOverlayProps`

---

## 2. Deleted CSS Classes

These classes no longer exist in `bento.css`:

| Removed class                         | What it did                | Replacement                                                                |
| ------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `.metallic-surface`                   | Base gradient container    | Use `background: var(--color-bg-card)` or `var(--color-primary)`           |
| `.metallic-surface--noise::before`    | SVG noise texture          | Remove — no replacement needed                                             |
| `.metallic-surface--highlight::after` | Radial light reflection    | Remove — no replacement needed                                             |
| `.shimmer-overlay`                    | Sweeping shimmer animation | Remove — no replacement needed                                             |
| `.card-gradient-offset`               | Per-card hue variation     | Remove — no replacement needed                                             |
| `.card-text-primary`                  | Text color on gradient bg  | Use `color: var(--color-text)` or Tailwind `text-text`                     |
| `.card-text-secondary`                | Secondary text on gradient | Use `color: var(--color-text-secondary)` or Tailwind `text-text-secondary` |
| `.card-text-muted`                    | Muted text on gradient     | Use `color: var(--color-text-muted)` or Tailwind `text-text-muted`         |

### Files to update in hadoku-site

| File                                            | What to change                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/bento/cards/ProfileCard.tsx`    | Replace `card-text-primary` with `text-text`. Replace `card-text-secondary` with `text-text-secondary`.                                      |
| `src/components/bento/cards/AppCardContent.tsx` | Replace `card-text-primary` with `text-text`. Replace `card-text-secondary` with `text-text-secondary`. Remove `card-gradient-offset` class. |
| `src/pages/index.astro`                         | Remove the `.metallic-surface { contain: layout paint; }` CSS rule (line ~179). It targets a class that no longer exists.                    |

---

## 3. Deleted CSS Variables

These variables have been removed from **all themes** in `@wolffm/themes/style.css`:

### Metallic primitives (removed from every `[data-theme]` block)

- `--accent-l`, `--accent-c`, `--accent-h`

### Derived metallic variables (removed from `:root`)

- `--gradient-start`, `--gradient-end`
- `--highlight`
- `--glow`, `--glow-primary`, `--glow-secondary`
- `--card-text-primary`, `--card-text-secondary`, `--card-text-muted`
- `--gradient-l-adjust`, `--gradient-c-scale`

### Files to update in hadoku-site

| File                    | What to change                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/index.astro` | The ambient glow uses `var(--glow-primary, ...)` and `var(--glow-secondary, ...)` with fallback values. These will now **always** hit the fallbacks since the variables are gone. This is safe — the fallbacks work — but if you want theme-reactive glows, define `--glow-primary` and `--glow-secondary` locally in hadoku-site's own CSS. Same for `var(--glow, ...)` on the card hover effect. |

---

## 4. Data Attribute Changes

### `data-surface` → `data-simple-mode`

The old system used `data-surface="simple"` / `data-surface="advanced"` to toggle metallic effects.

The new system uses `data-simple-mode="true"` (present = simple mode) or absent (= advanced mode).

The old `[data-simple-mode='true'] .metallic-surface` CSS rules in bento.css have been removed since the component no longer exists. The new advanced-themes.css uses `[data-simple-mode='true'][data-advanced-theme]` selectors.

### Files to update in hadoku-site

| File                                             | What to change                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/layouts/Base.astro`                         | The blocking script sets `data-surface`. Either: (A) rename to set `data-simple-mode="true"` when surface is `"simple"`, or (B) remove the `data-surface` attribute entirely if you're not implementing your own advanced effects in hadoku-site.                                                                                                 |
| `src/components/bento/cards/ThemePickerCard.tsx` | The surface toggle button sets `data-surface` on `document.documentElement` and stores `hadoku-surface` in sessionStorage. Since MetallicSurface is gone, this toggle has nothing to control. Either: (A) remove the toggle button entirely, or (B) rewire it to set `data-simple-mode` if you plan to use advanced theme effects in hadoku-site. |

### New attribute: `data-advanced-theme`

The `useTheme` hook in hadoku-task now automatically sets `data-advanced-theme="beach-day"` when the `light` theme is active. This is controlled by `ADVANCED_THEME_MAP` in `src/app/themeConfig.tsx`. hadoku-site does **not** need to do anything for this — it only applies inside the task app's own container.

---

## 5. New Variables (Light Theme Only)

These 24 variables are added to `[data-theme='light']` for the Beach Day gradient. They are only relevant if hadoku-site wants to build its own advanced effects for the light theme:

```css
--advanced-stop-{1-8}-l  /* Lightness */
--advanced-stop-{1-8}-c  /* Chroma */
--advanced-stop-{1-8}-h  /* Hue */
```

No action needed — these are additive and won't break anything.

---

## Quick Reference: hadoku-site Files to Touch

1. **`src/components/bento/cards/ProfileCard.tsx`** — Remove MetallicSurface, fix text classes
2. **`src/components/bento/cards/AppCardContent.tsx`** — Remove MetallicSurface, card-gradient-offset, fix text classes
3. **`src/components/bento/cards/ThemePickerCard.tsx`** — Remove MetallicSurface, decide on surface toggle
4. **`src/pages/index.astro`** — Remove `.metallic-surface` CSS rule, ambient glow fallbacks are fine
5. **`src/layouts/Base.astro`** — Update or remove `data-surface` blocking script
