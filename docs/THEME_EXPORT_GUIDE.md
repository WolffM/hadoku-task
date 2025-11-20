# Exporting Theme System for Other Apps

## Current State

The theme system is currently bundled into `dist/style.css` but not separately exportable.

## What Needs to Be Done

### 1. Create Standalone Theme CSS File

Create `src/styles/themes-only.css`:

```css
/**
 * Hadoku Theme System - Standalone
 * Use these 7 themes in any application
 */

/* Light Theme (Default) */
:root {
  --color-primary: #2563eb;
  --color-primary-dark: #1d4ed8;
  /* ... all ~45 variables ... */
}

/* Dark Theme */
[data-theme='dark'] {
  --color-primary: #3b82f6;
  /* ... all variables ... */
}

/* Strawberry, Ocean, Cyberpunk, Coffee, Lavender themes... */
```

### 2. Create Theme Utility Export

Create `src/theme/index.ts`:

```typescript
export const THEMES = [
  'light',
  'dark',
  'strawberry',
  'ocean',
  'cyberpunk',
  'coffee',
  'lavender'
] as const

export type Theme = (typeof THEMES)[number]

export function setTheme(theme: Theme) {
  if (theme === 'light') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

export function getTheme(): Theme {
  return (document.documentElement.getAttribute('data-theme') as Theme) || 'light'
}

export function saveTheme(theme: Theme) {
  sessionStorage.setItem('theme', theme)
  setTheme(theme)
}

export function loadTheme(): Theme {
  const saved = sessionStorage.getItem('theme') as Theme
  if (saved && THEMES.includes(saved)) {
    setTheme(saved)
    return saved
  }
  return 'light'
}
```

### 3. Update package.json Exports

```json
{
  "exports": {
    "./api": {
      "types": "./dist/server/index.d.ts",
      "default": "./dist/server/index.js"
    },
    "./frontend": "./dist/index.js",
    "./style.css": "./dist/style.css",
    "./themes": {
      "types": "./dist/theme/index.d.ts",
      "default": "./dist/theme/index.js"
    },
    "./style.css": "./dist/themes-only.css"
  }
}
```

### 4. Update Build Configuration

In `vite.config.ts`:

```typescript
export default defineConfig({
  // ... existing config ...
  build: {
    rollupOptions: {
      input: {
        main: 'src/app/entry.tsx',
        themes: 'src/styles/themes-only.css'
      },
      output: {
        assetFileNames: assetInfo => {
          if (assetInfo.name === 'themes-only.css') {
            return 'themes-only.css'
          }
          return 'style.css'
        }
      }
    }
  }
})
```

### 5. Update TypeScript Build

In `tsconfig.json`, ensure theme utilities are included:

```json
{
  "include": ["src/**/*", "src/theme/**/*"]
}
```

## Usage in Other Apps

After implementing the above:

### Install Package

```bash
npm install @wolffm/task
```

### Import Themes CSS

```javascript
import '@wolffm/task/style.css'
```

### Use Theme Utilities

```typescript
import { setTheme, THEMES } from '@wolffm/task/themes'

// Change theme
setTheme('dark')

// Get available themes
console.log(THEMES) // ['light', 'dark', 'strawberry', ...]

// Save to sessionStorage
saveTheme('cyberpunk')

// Load saved theme on app start
const theme = loadTheme()
```

### Apply to Custom Elements

```html
<!-- Entire app -->
<div data-theme="dark">
  <!-- Your app content -->
</div>

<!-- Or set globally -->
<html data-theme="cyberpunk"></html>
```

## Benefits

✅ **Standalone**: Other apps can use themes without the full task app
✅ **Lightweight**: Only CSS variables (~10KB for all 7 themes)
✅ **Framework-agnostic**: Pure CSS + vanilla JS utilities
✅ **Type-safe**: TypeScript support for theme names
✅ **Flexible**: Can apply to entire app or specific sections

## Implementation Checklist

- [ ] Create `src/styles/themes-only.css` with all theme definitions
- [ ] Create `src/theme/index.ts` with utility functions
- [ ] Update `package.json` exports
- [ ] Update `vite.config.ts` to build themes separately
- [ ] Update `tsconfig.json` includes
- [ ] Test import in another project
- [ ] Document in README.md
- [ ] Bump version and publish

## Alternative: Create Separate Package

For maximum flexibility, consider:

**@wolffm/themes** - Standalone theme package

- Just CSS variables + utilities
- No dependencies
- Usable in any framework (React, Vue, Svelte, vanilla)
- Can be used independently of @wolffm/task

This would make themes truly reusable across your entire ecosystem!
