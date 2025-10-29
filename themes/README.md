# @wolffm/themes

24 beautiful color themes using CSS custom properties. Framework-agnostic and ready to use in any web project.

## Themes

12 theme families, each with light and dark variants:

- **Light** (default) - Clean blue and white
- **Dark** - Sophisticated midnight with purple accents
- **Strawberry Light/Dark** - Sweet pink tones
- **Ocean Light/Dark** - Deep sea blues and tropical coral
- **Cyberpunk Light/Dark** - Neon dystopia with electric colors
- **Coffee Light/Dark** - Rich espresso and cream tones
- **Lavender Light/Dark** - Soft purple elegance
- **Nature Light/Dark** - Lush leaf greens inspired by forests and earth
- **Pink Light/Dark** - Bubblegum pink and neon glows
- **Kitsune Springs A-D Light/Dark** - Japanese spa-inspired themes with serene colors (8 variants)

## Installation

```bash
npm install @wolffm/themes
```

## Usage

### Import CSS

```javascript
import '@wolffm/themes/themes.css'
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
```

## CSS Variables

Each theme defines ~50 variables:

### Colors
- `--color-primary` (+ dark, light, bg, hover variants)
- `--color-success` (+ dark, text variants)
- `--color-danger` (+ dark, darker, light, text variants)
- `--color-neutral` (+ light, lighter variants)
- `--color-text` (+ secondary, tertiary, muted variants)
- `--color-border` (+ light variant)
- `--color-bg` (+ card, alt, overlay variants)

### Typography
- `--font-family`
- `--font-size-*` (xs, sm, md, base, lg)
- `--font-weight-*` (normal, semibold, bold)
- `--line-height-*` (normal, relaxed)

### Spacing
- `--spacing-*` (xs, sm, md, lg, xl, 2xl, 3xl, 4xl, 5xl)

### Layout
- `--border-radius` (+ sm, lg variants)
- `--shadow-*` (sm, md, modal, focus, focus-sm, focus-alt)

### Transitions
- `--transition-fast`
- `--transition-smooth`

### Usage Example

```css
.my-button {
  background: var(--color-primary);
  color: var(--color-text);
  padding: var(--spacing-md) var(--spacing-xl);
  border-radius: var(--border-radius);
  font-size: var(--font-size-base);
  box-shadow: var(--shadow-sm);
  transition: var(--transition-fast);
}

.my-button:hover {
  background: var(--color-primary-dark);
  box-shadow: var(--shadow-md);
}
```

## Framework Examples

### React
```tsx
import { useEffect, useState } from 'react'
import { loadTheme, setTheme, THEMES, type Theme } from '@wolffm/themes'
import '@wolffm/themes/themes.css'

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
    <select value={theme} onChange={(e) => handleThemeChange(e.target.value as Theme)}>
      {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  )
}
```

### Vue
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { loadTheme, setTheme, THEMES, type Theme } from '@wolffm/themes'
import '@wolffm/themes/themes.css'

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
import '@wolffm/themes/themes.css'

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
  
  select.addEventListener('change', (e) => {
    setTheme(e.target.value)
  })
})
```

## API Reference

### Functions

#### `setTheme(theme: Theme): void`
Apply a theme immediately. Sets `data-theme` attribute on `<html>` element.

#### `getTheme(): Theme`
Get the currently active theme.

#### `saveTheme(theme: Theme): void`
Save theme to sessionStorage and apply it.

#### `loadTheme(): Theme`
Load saved theme from sessionStorage, apply it, and return the theme name. Returns 'light' if no theme is saved.

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
  | 'pink-light'
  | 'pink-dark'

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
