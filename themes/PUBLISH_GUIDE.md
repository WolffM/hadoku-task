# Publishing and Using @wolffm/themes

## Step 1: Build the Themes Package

```bash
cd themes
npm install
npm run build
```

This creates `dist/index.js` and `dist/index.d.ts`.

## Step 2: Test Locally (Optional)

```bash
# In themes directory
npm link

# In hadoku-task root
npm link @wolffm/themes
```

## Step 3: Publish to GitHub Packages

```bash
cd themes

# Make sure you're logged in to GitHub Packages
npm login --registry=https://npm.pkg.github.com

# Publish
npm publish
```

## Step 4: Update hadoku-task to Use @wolffm/themes

### Install the Package

```bash
# From hadoku-task root
npm install @wolffm/themes
```

### Update package.json

```json
{
  "dependencies": {
    "@wolffm/themes": "^1.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

### Update src/app/entry.tsx

Replace the local variables.css import with themes package:

```typescript
// OLD
import '../styles/variables.css'

// NEW
import '@wolffm/themes/themes.css'
```

### Update Theme Utilities

Replace local theme utilities with package imports:

```typescript
// In src/app/App.tsx or wherever you manage themes
import { setTheme, loadTheme, saveTheme, type Theme, THEMES } from '@wolffm/themes'

// Use the same way as before
useEffect(() => {
  const savedTheme = loadTheme()
  setCurrentTheme(savedTheme)
}, [])

const handleThemeChange = (newTheme: Theme) => {
  saveTheme(newTheme)
  setCurrentTheme(newTheme)
}
```

### Clean Up Old Theme Files

After verifying everything works, you can remove:
- `src/styles/variables.css` (theme definitions - keep other styles!)
- Any local theme utility functions (if you had them)

**Keep these files:**
- `src/styles/base.css`
- `src/styles/buttons.css`
- `src/styles/main.css`
- `src/styles/modal.css`
- `src/styles/task-items.css`
- `src/styles/task-layout.css`
- `src/styles/index.css` (update imports)

### Update src/styles/index.css

```css
/* Remove this */
/* @import './variables.css'; */

/* Keep all other imports */
@import './base.css';
@import './main.css';
@import './buttons.css';
@import './modal.css';
@import './task-items.css';
@import './task-layout.css';
```

## Step 5: Update Theme Constants

Since the themes package has light/dark variants, update your theme picker UI:

```typescript
import { THEMES } from '@wolffm/themes'

// THEMES now includes:
// ['light', 'dark', 'strawberry-light', 'strawberry-dark', 
//  'ocean-light', 'ocean-dark', 'cyberpunk-light', 'cyberpunk-dark',
//  'coffee-light', 'coffee-dark', 'lavender-light', 'lavender-dark',
//  'pink-light', 'pink-dark']
```

## Step 6: Update .task-app-container Scoping (If Needed)

The themes package exports themes for `:root` and `[data-theme]`.

If you need `.task-app-container` scoping for embedding, wrap your app:

```tsx
// src/app/entry.tsx
export function mount(container: HTMLElement, props: MountProps) {
  // Add class to container for scoping
  container.classList.add('task-app-container')
  
  root.render(
    <StrictMode>
      <App {...props} />
    </StrictMode>
  )
}
```

Or keep using `data-theme` on the container directly (recommended):

```typescript
// Set theme on container instead of document.documentElement
export function setTheme(theme: Theme, container?: HTMLElement): void {
  const target = container || document.documentElement
  if (theme === 'light') {
    target.removeAttribute('data-theme')
  } else {
    target.setAttribute('data-theme', theme)
  }
}
```

## Step 7: Test Everything

```bash
npm run dev
# Test theme switching
# Verify all themes look correct
# Check that styles are applied properly
```

## Step 8: Commit and Push

```bash
git add themes/
git add package.json package-lock.json
git add src/app/entry.tsx
git commit -m "Extract themes to @wolffm/themes package"
git push
```

## Benefits

✅ **Reusable** - Use themes in any project
✅ **Maintainable** - Update themes in one place
✅ **Smaller repo** - Theme definitions moved to package
✅ **Versioned** - Semantic versioning for themes
✅ **Shareable** - Other developers can use your themes

## Using in Other Projects

Any project can now use your themes:

```bash
npm install @wolffm/themes
```

```typescript
import '@wolffm/themes/themes.css'
import { setTheme } from '@wolffm/themes'

setTheme('cyberpunk-dark')
```

Perfect for:
- hadoku-task (this repo)
- hadoku-task-mobile
- hadoku.me main site
- Any future projects! 

## Updating Themes

To update themes later:

1. Edit `themes/src/themes.css`
2. Bump version in `themes/package.json`
3. Build: `cd themes && npm run build`
4. Publish: `npm publish`
5. Update in hadoku-task: `npm update @wolffm/themes`
