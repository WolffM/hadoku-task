# @wolffm/themes

Beautiful color themes using CSS custom properties. Framework-agnostic and ready to use in any web project.

## Themes

9 theme families (18 themes), each with light and dark variants:

- **Light** (default) / **Dark** - Clean blue and white / Sophisticated midnight with purple accents
- **Strawberry** Light/Dark - Sweet pink tones
- **Ocean** Light/Dark - Deep sea blues and tropical coral
- **Cyberpunk** Light/Dark - Neon dystopia with electric colors
- **Coffee** Light/Dark - Rich espresso and cream tones
- **Lavender** Light/Dark - Soft purple elegance
- **Nature** Light/Dark - Lush leaf greens inspired by forests and earth
- **Pink** Light/Dark - Bubblegum pink and neon glows
- **Izakaya** Light/Dark - Japanese izakaya-inspired warm tones (Kitsune contest winner)

## Installation

```bash
npm install @wolffm/themes
```

## Usage

### Import CSS

```javascript
import '@wolffm/themes/style.css'
```

### Use Theme Utilities

```typescript
import { setTheme, loadTheme, saveTheme, THEMES } from '@wolffm/themes'

// Set theme (applies immediately)
setTheme('dark')
setTheme('cyberpunk-dark')

// Save to sessionStorage and apply
saveTheme('lavender-light')

// Load saved theme on app start
const theme = loadTheme()

// Get all available themes
console.log(THEMES) // ['light', 'dark', 'strawberry-light', ...]
```

### Apply to HTML

```html
<!-- Set globally on html element -->
<html data-theme="dark">
  <!-- Or on a specific container -->
  <div data-theme="strawberry-light">
    <!-- Your content -->
  </div>
</html>
```

## CSS Variables

Each theme defines ~40 variables (34 color + 6 shadow). Variables are **namespaced with `--hdk-*`** prefix for Tailwind v4 compatibility.

### Colors (no prefix needed)

- `--color-primary` (+ dark, light, bg, hover variants) / `--color-on-primary`
- `--color-success` (+ dark, bg, hover variants) / `--color-on-success`
- `--color-warning` (+ bg, hover variants) / `--color-on-warning`
- `--color-danger` (+ dark, darker, light, hover variants) / `--color-on-danger`
- `--color-neutral` (+ light, lighter, hover variants) / `--color-on-neutral`
- `--color-muted-bg` - background for neutral/unknown badges
- `--color-text` (+ secondary, tertiary, muted variants)
- `--color-border` (+ light variant)
- `--color-bg` (+ card, alt, hover, overlay variants)

### Typography

- `--font-family`
- `--hdk-text-*` (xs, sm, md, base, lg) - font sizes
- `--font-weight-*` (normal, semibold, bold)
- `--line-height-*` (normal, relaxed)

### Spacing

- `--hdk-space-*` (xs, sm, md, lg, xl, 2xl, 3xl, 4xl, 5xl)

### Layout

- `--hdk-radius` (+ sm, lg variants) - border radius
- `--hdk-shadow-*` (sm, md, lg, focus, focus-sm, focus-alt)

### Transitions

- `--transition-fast`
- `--transition-smooth`

### Usage Example

```css
.my-button {
  background: var(--color-primary);
  color: var(--color-on-primary);
  padding: var(--hdk-space-md) var(--hdk-space-xl);
  border-radius: var(--hdk-radius);
  font-size: var(--hdk-text-base);
  box-shadow: var(--hdk-shadow-sm);
  transition: var(--transition-fast);
}

.my-button:hover {
  background: var(--color-primary-dark);
  box-shadow: var(--hdk-shadow-md);
}
```

## Tailwind v4 Compatibility

This package uses namespaced CSS variables (`--hdk-*`) to avoid collisions with Tailwind v4's internal variables.

### Why Namespacing?

Tailwind v4 uses CSS custom properties internally:

- `--spacing-*` powers `max-w-md`, `p-4`, `gap-*`, etc.
- `--radius-*` powers `rounded-md`, `rounded-lg`, etc.
- `--font-size-*` powers `text-sm`, `text-base`, etc.
- `--shadow-*` powers `shadow-sm`, `shadow-md`, etc.

Without namespacing, a theme variable like `--spacing-md: 8px` would break `max-w-md` (changing it from 28rem to 8px).

### Variable Mapping

| Old Name (v1.x)   | New Name (v2.x)   |
| ----------------- | ----------------- |
| `--spacing-md`    | `--hdk-space-md`  |
| `--font-size-sm`  | `--hdk-text-sm`   |
| `--border-radius` | `--hdk-radius`    |
| `--shadow-sm`     | `--hdk-shadow-sm` |
| `--shadow-modal`  | `--hdk-shadow-lg` |

### Tailwind Integration (Optional)

If you want Tailwind utilities like `rounded-md` and `shadow-sm` to use your theme values, create a CSS file:

```css
/* tailwind-theme.css */
@import 'tailwindcss';

@theme {
  /* Map theme variables to Tailwind utilities */
  --radius-sm: var(--hdk-radius-sm);
  --radius: var(--hdk-radius);
  --radius-lg: var(--hdk-radius-lg);

  --shadow-sm: var(--hdk-shadow-sm);
  --shadow: var(--hdk-shadow-md);
  --shadow-lg: var(--hdk-shadow-lg);

  --text-xs: var(--hdk-text-xs);
  --text-sm: var(--hdk-text-sm);
  --text-base: var(--hdk-text-base);
  --text-lg: var(--hdk-text-lg);
}
```

This is opt-in - your theme variables work independently of Tailwind.

### Migration from v1.x

Search and replace in your CSS:

```
var(--spacing-       →  var(--hdk-space-
var(--font-size-     →  var(--hdk-text-
var(--border-radius  →  var(--hdk-radius
var(--shadow-        →  var(--hdk-shadow-
var(--shadow-modal)  →  var(--hdk-shadow-lg)
```

## React Integration

### Using the `useTheme` Hook (Recommended)

```tsx
import { useTheme, THEME_FAMILIES, THEME_ICON_MAP } from '@wolffm/themes'
import { ConnectedThemePicker } from '@wolffm/task-ui-components'
import '@wolffm/themes/style.css'
import '@wolffm/task-ui-components/theme-picker.css'

function App() {
  const { theme, setTheme } = useTheme()

  return (
    <ConnectedThemePicker
      themeFamilies={THEME_FAMILIES}
      currentTheme={theme}
      onThemeChange={setTheme}
      getThemeIcon={theme => {
        const Icon = THEME_ICON_MAP[theme]
        return Icon ? <Icon /> : null
      }}
    />
  )
}
```

### Manual React Integration

```tsx
import { useEffect, useState } from 'react'
import { loadTheme, setTheme, THEMES, type Theme } from '@wolffm/themes'
import '@wolffm/themes/style.css'

function App() {
  const [theme, setThemeState] = useState<Theme>('light')

  useEffect(() => {
    const savedTheme = loadTheme()
    setThemeState(savedTheme)
  }, [])

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme)
    setThemeState(newTheme)
  }

  return (
    <select value={theme} onChange={e => handleThemeChange(e.target.value as Theme)}>
      {THEMES.map(t => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  )
}
```

## Framework Examples

### Vue

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { loadTheme, setTheme, THEMES, type Theme } from '@wolffm/themes'
import '@wolffm/themes/style.css'

const theme = ref<Theme>('light')

onMounted(() => {
  theme.value = loadTheme()
})

const handleThemeChange = (newTheme: Theme) => {
  setTheme(newTheme)
  theme.value = newTheme
}
</script>

<template>
  <select v-model="theme" @change="handleThemeChange(theme)">
    <option v-for="t in THEMES" :key="t" :value="t">{{ t }}</option>
  </select>
</template>
```

### Vanilla JS

```javascript
import { loadTheme, setTheme, THEMES } from '@wolffm/themes'
import '@wolffm/themes/style.css'

// Load saved theme on page load
document.addEventListener('DOMContentLoaded', () => {
  loadTheme()

  // Theme switcher
  const select = document.getElementById('theme-select')
  THEMES.forEach(theme => {
    const option = document.createElement('option')
    option.value = theme
    option.textContent = theme
    select.appendChild(option)
  })

  select.addEventListener('change', e => {
    setTheme(e.target.value)
  })
})
```

## Theme Editor (Development Tool)

A standalone theme editor is included for creating and customizing themes. It displays all 34 color variables and 6 shadow variables with interactive controls.

### Opening the Editor

```bash
# Open directly in browser (no server needed)
open themes/dev/editor.html

# Or use a local server
npx serve themes/dev
```

### Features

- **Theme Selector** - Switch between all 18 themes instantly
- **Color Showcase** - See all variables organized by category (primary, success, warning, danger, neutral, text, border, backgrounds, shadows)
- **Live Component Demo** - Buttons, badges, cards, and forms using all theme colors
- **Click-to-Edit** - Click any color swatch to open the editor panel
- **Color Controls** - HSL sliders (hue, saturation, lightness, alpha) plus hex input
- **Live Preview** - Changes update instantly as you adjust values
- **Export CSS** - Copy your modifications as a complete CSS theme block
- **Reset** - Reset individual variables or all changes

### Workflow

1. Open `themes/dev/editor.html` in your browser
2. Select a base theme to start from
3. Click any color swatch to edit it
4. Adjust using sliders or enter a hex value
5. Click "Copy CSS Theme" to export your modifications
6. Paste the CSS into `src/style.css` as a new theme

## API Reference

### React Utilities (New in v1.1.3+)

#### `useTheme(): { theme: Theme, setTheme: (theme: Theme) => void }`

React hook for stateful theme management. Automatically saves to sessionStorage and syncs across tabs.

```tsx
const { theme, setTheme } = useTheme()
```

#### `THEME_FAMILIES: ThemeFamily[]`

Pre-configured array of all 9 theme families with icons and labels. Use with `ThemePicker` or `ConnectedThemePicker` components from `@wolffm/task-ui-components`.

```tsx
import { THEME_FAMILIES } from '@wolffm/themes'
// Each family includes: lightTheme, darkTheme, lightLabel, darkLabel, lightIcon, darkIcon
```

#### `THEME_ICON_MAP: Record<Theme, IconComponent>`

Map of theme names to their corresponding icon components.

```tsx
import { THEME_ICON_MAP } from '@wolffm/themes'
const Icon = THEME_ICON_MAP['cyberpunk-dark']
```

### Core Functions

#### `setTheme(theme: Theme): void`

Apply a theme immediately. Sets `data-theme` attribute on `<html>` element.

#### `getTheme(): Theme`

Get the currently active theme.

#### `saveTheme(theme: Theme): void`

Save theme to sessionStorage and apply it.

#### `loadTheme(): Theme`

Load saved theme from sessionStorage, apply it, and return the theme name. Respects browser's `prefers-color-scheme` preference if no saved theme. Returns 'light' if no preference.

#### `initTheme(): Theme`

Convenience function. Same as `loadTheme()`.

#### `clearTheme(): void`

Remove saved theme and reset to 'light'.

### Types

```typescript
type Theme =
  | 'light'
  | 'dark'
  | 'strawberry-light'
  | 'strawberry-dark'
  | 'ocean-light'
  | 'ocean-dark'
  | 'cyberpunk-light'
  | 'cyberpunk-dark'
  | 'coffee-light'
  | 'coffee-dark'
  | 'lavender-light'
  | 'lavender-dark'
  | 'nature-light'
  | 'nature-dark'
  | 'pink-light'
  | 'pink-dark'
  | 'izakaya-light'
  | 'izakaya-dark'

const THEMES: readonly Theme[]
```

## Browser Support

Works in all modern browsers that support:

- CSS Custom Properties (CSS Variables)
- ES2022 modules
- sessionStorage

## License

MIT

## Author

WolffM - [GitHub](https://github.com/WolffM)

## Related Packages

- [@wolffm/task](https://github.com/WolffM/hadoku-task) - Task management micro-frontend using these themes
