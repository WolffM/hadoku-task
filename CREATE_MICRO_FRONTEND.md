# Creating a New Micro-Frontend for hadoku_site

This guide walks you through creating a new micro-frontend application that integrates with hadoku_site's micro-frontend architecture.

## Overview

hadoku_site uses a **micro-frontend architecture** where independent applications are loaded dynamically at runtime. Each micro-app:
- ✅ Lives in its own repository
- ✅ Has its own build pipeline
- ✅ Gets automatically deployed to hadoku_site
- ✅ Receives configuration from the parent via props
- ✅ Maintains complete control over its UI and styles

---

## 1. Repository Setup

### Create Your Repository

```bash
# Example: hadoku-myapp
mkdir hadoku-myapp
cd hadoku-myapp
git init
```

### Basic Structure

```
hadoku-myapp/
├── .github/
│   └── workflows/
│       └── build.yml           # GitHub Actions workflow
├── src/
│   ├── entry.tsx              # Required: mount/unmount exports
│   ├── App.tsx                # Your main app component
│   └── ...                    # Your app code
├── public/
│   └── ...                    # Static assets
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

## 2. Required Package Configuration

### package.json

Your app must export ES modules. Example for React + Vite:

```json
{
  "name": "hadoku-myapp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^6.x.x"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.x.x",
    "typescript": "^5.x.x",
    "vite": "^5.x.x"
  }
}
```

### vite.config.ts

**Critical**: Build as a library with ES modules format:

```typescript
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  return {
    // Local dev base path
    base: command === 'serve' ? '/myapp/' : undefined,
    
    plugins: [react()],
    
    build: {
      // Enable source maps for debugging
      sourcemap: true,
      
      // Build as a library (not a standalone app)
      lib: {
        entry: 'src/entry.tsx',
        formats: ['es'],              // ES modules only
        fileName: () => 'index.js',   // Output: dist/index.js
      },
      
      // External dependencies (provided by parent)
      rollupOptions: {
        external: ['react', 'react-dom/client'],
      },
    },
  };
});
```

**Important**: React and React DOM are marked as **external** because hadoku_site provides them via import maps.

---

## 3. Required Entry Point (entry.tsx)

Your app **must** export two functions: `mount` and `unmount`.

### Complete entry.tsx Template

```typescript
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import type { AppProps } from './App';
import App from './App';
import './styles.css';

// Props your app will receive from hadoku_site
export interface MyAppProps {
  basename?: string;           // e.g., "/myapp"
  apiUrl?: string;             // Your custom config
  environment?: string;        // "development" | "production"
  [key: string]: any;          // Any other props
}

type MountedInstance = {
  root: Root;
};

/**
 * mount() is called when your app is loaded
 * @param el - The DOM element to render into
 * @param props - Configuration from hadoku_site registry
 * @returns The router instance (optional)
 */
export function mount(el: HTMLElement, props: MyAppProps = {}) {
  const { 
    basename = '/myapp',
    apiUrl,
    environment,
    ...restProps 
  } = props;
  
  // Clean up any existing instance
  const existing = (el as any).__myapp as MountedInstance | undefined;
  existing?.root.unmount();
  
  // Create router with basename for proper routing
  const router = createBrowserRouter([
    {
      path: '/',
      element: <App apiUrl={apiUrl} environment={environment} {...restProps} />,
    },
    // Add more routes...
  ], { basename });
  
  // Render the app
  const root = createRoot(el);
  root.render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>
  );
  
  // Store instance for cleanup
  const instance: MountedInstance = { root };
  (el as any).__myapp = instance;
  
  console.log('[myapp] Mounted successfully', props);
  
  return router;
}

/**
 * unmount() is called when navigating away or before remounting
 * @param el - The DOM element to clean up
 */
export function unmount(el: HTMLElement) {
  const instance = (el as any).__myapp as MountedInstance | undefined;
  if (instance) {
    instance.root.unmount();
    delete (el as any).__myapp;
    console.log('[myapp] Unmounted successfully');
  }
}
```

### Key Points:

1. **`mount(el, props)`**: 
   - Receives a DOM element and props from parent
   - Must handle props with fallback defaults
   - Should clean up any previous instance
   - Return value is optional

2. **`unmount(el)`**:
   - Clean up resources (event listeners, timers, etc.)
   - Unmount React root
   - Remove any stored instance data

3. **Props pattern**:
   - Always provide defaults for local development
   - Use fallbacks: `props.apiUrl || 'http://localhost:3000'`
   - Don't rely on environment variables at build time

---

## 4. App Component Example

### App.tsx

```typescript
import React from 'react';

export interface AppProps {
  apiUrl?: string;
  environment?: string;
  [key: string]: any;
}

export default function App(props: AppProps) {
  const apiUrl = props.apiUrl || 'http://localhost:3000';
  const environment = props.environment || 'development';
  
  return (
    <div className="app">
      <h1>My App</h1>
      <p>API: {apiUrl}</p>
      <p>Environment: {environment}</p>
    </div>
  );
}
```

---

## 5. GitHub Actions Workflow

Create `.github/workflows/build.yml` to automatically deploy to hadoku_site:

```yaml
name: Build and Deploy to hadoku_site

on:
  push:
    branches: [ main ]
    paths:
      - 'src/**'
      - 'public/**'
      - 'package.json'
      - 'vite.config.ts'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout this repo
        uses: actions/checkout@v4
        with:
          path: myapp
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        working-directory: myapp
        run: npm install
      
      - name: Build
        working-directory: myapp
        run: npm run build
      
      - name: Checkout hadoku_site
        uses: actions/checkout@v4
        with:
          repository: WolffM/hadoku_site
          token: ${{ secrets.HADOKU_WATCHPARTY_DEPLOY_TOKEN }}
          path: hadoku_site
      
      - name: Copy built files to hadoku_site
        run: |
          mkdir -p hadoku_site/public/mf/myapp
          cp myapp/dist/* hadoku_site/public/mf/myapp/
          echo "Copied files:"
          ls -la hadoku_site/public/mf/myapp/
      
      - name: Commit and push to hadoku_site
        working-directory: hadoku_site
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add public/mf/myapp/
          if git diff --staged --quiet; then
            echo "No changes to commit"
          else
            git commit -m "chore: update myapp from ${{ github.repository }}@${{ github.sha }}"
            git push
            echo "✅ Deployed myapp to hadoku_site"
          fi
```

### Required Secret

Add `HADOKU_SITE_TOKEN` to your repository secrets:
1. Go to your repo → Settings → Secrets → Actions
2. Create `HADOKU_SITE_TOKEN` with a GitHub PAT that has access to hadoku_site
3. The token needs `repo` and `workflow` permissions

---

## 6. hadoku_site Integration

### A. Update Registry

In **hadoku_site**, update `public/mf/registry.json`:

```json
{
  "myapp": {
    "url": "/mf/myapp/index.js",
    "css": "/mf/myapp/style.css",
    "basename": "/myapp",
    "props": {
      "apiUrl": "https://api.hadoku.me",
      "environment": "production",
      "customSetting": "value"
    }
  }
}
```

### B. Create Page

Create `src/pages/myapp/index.astro` in **hadoku_site**:

```astro
---
import Base from '../../layouts/Base.astro';
---

<Base title="Hadoku - My App">
  <!-- Full-screen container -->
  <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; overflow: hidden;">
    <!-- Isolated container for micro-frontend -->
    <div id="root" data-app="myapp" style="all: initial; display: block; width: 100%; height: 100%;"></div>
    
    <!-- Home button overlay -->
    <a 
      href="/" 
      style="
        position: fixed;
        top: 1rem;
        left: 1rem;
        z-index: 9999;
        padding: 0.5rem 1rem;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        text-decoration: none;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        font-weight: 500;
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      "
    >
      <span style="font-size: 1.2rem;">←</span>
      <span>Home</span>
    </a>
  </div>
  
  <!-- Import maps for React (if needed) -->
  <script type="importmap">
    {
      "imports": {
        "react": "https://esm.sh/react@19.0.0",
        "react-dom/client": "https://esm.sh/react-dom@19.0.0/client"
      }
    }
  </script>
  
  <script src="../../components/mf-loader.js"></script>
</Base>
```

### C. Add to Navigation

Update hadoku_site's home page to link to your app:

```astro
<a href="/myapp/">My App</a>
```

---

## 7. Local Development

### Run Locally

```bash
npm run dev
# Visit http://localhost:5173/myapp/
```

### Test with Props

You can manually test the mount function:

```javascript
import { mount, unmount } from './src/entry';

const el = document.createElement('div');
document.body.appendChild(el);

mount(el, {
  basename: '/myapp',
  apiUrl: 'http://localhost:3000',
  environment: 'development'
});

// Later...
unmount(el);
```

---

## 8. Build and Deploy

### Manual Build

```bash
npm run build
# Output: dist/index.js, dist/style.css, dist/index.js.map
```

### Automatic Deploy

1. Commit and push to your repo
2. GitHub Actions builds the app
3. Copies files to hadoku_site/public/mf/myapp/
4. hadoku_site auto-deploys to GitHub Pages
5. Visit https://hadoku.me/myapp/ in ~3-5 minutes

---

## 9. Best Practices

### ✅ DO:
- Export `mount` and `unmount` functions
- Accept props with fallback defaults
- Mark React/ReactDOM as external
- Build as ES modules (`formats: ['es']`)
- Use `basename` for routing
- Reset styles with `all: initial` if needed
- Include source maps for debugging
- Handle cleanup in `unmount`

### ❌ DON'T:
- Don't use environment variables at build time
- Don't bundle React (mark as external)
- Don't assume parent styles won't affect you
- Don't use global variables for config
- Don't forget to clean up in `unmount`
- Don't hardcode API URLs (use props)

---

## 10. Troubleshooting

### App doesn't load
- Check browser console for errors
- Verify `mount` and `unmount` are exported
- Check registry.json has correct URL
- Ensure dist/index.js exists in hadoku_site

### Styles not working
- Verify `css` is specified in registry.json
- Check that dist/style.css exists
- Add `all: initial` to root element if needed

### Props not received
- Check registry.json has `props` object
- Add defaults in your mount function
- Console.log props in mount to verify

### React is undefined
- Verify import map in .astro file
- Check that React is marked as external
- Ensure using https://esm.sh CDN

---

## 11. Example Apps

### Reference Implementation
- **watchparty**: Full example at WolffM/hadoku-watchparty
  - See: `apps/ui/src/entry.tsx`
  - Shows: Props handling, React Router, Zustand, Socket.io

### Minimal Example
See the template above for a minimal working implementation.

---

## 12. Support

- **Documentation**: See `/docs/` in hadoku_site repository
- **Architecture**: `/docs/MICRO_FRONTEND_CONFIG.md`
- **Migration Guide**: `/docs/WATCHPARTY_MIGRATION_INSTRUCTIONS.md`

---

## Quick Checklist

- [ ] Created repository with correct structure
- [ ] Configured vite.config.ts with `lib` build
- [ ] Marked React as external dependency
- [ ] Exported `mount(el, props)` and `unmount(el)` from entry.tsx
- [ ] Added props handling with defaults
- [ ] Created GitHub Actions workflow
- [ ] Added `HADOKU_SITE_TOKEN` secret
- [ ] Updated hadoku_site registry.json
- [ ] Created page in hadoku_site
- [ ] Tested locally with `npm run dev`
- [ ] Pushed to GitHub and verified deployment
- [ ] Visited https://hadoku.me/myapp/ to confirm

---

**You're ready to build!** 🚀

Follow this template and your micro-frontend will integrate seamlessly with hadoku_site.
