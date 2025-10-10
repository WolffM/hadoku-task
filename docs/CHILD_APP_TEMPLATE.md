# Child App Template

**Template for creating micro-frontend child apps for hadoku.me**

This template provides the structure and configuration needed to create a new child app that integrates with the parent `hadoku_site` application.

---

## Overview

Child apps are independent applications that:
- Run as micro-frontends mounted in the parent app
- Optionally provide backend API routers
- Auto-deploy to parent on code changes
- Share authentication/user context from parent

---

## Quick Start

### 1. Create New Repository

```bash
# Create from this template
git clone https://github.com/WolffM/hadoku-task.git my-new-app
cd my-new-app
npm install
```

### 2. Update Package Name

Edit `package.json`:
```json
{
  "name": "hadoku-my-app",
  "version": "0.1.0"
}
```

### 3. Update Build Workflow

Edit `.github/workflows/build.yml`:
- Change app name in paths
- Update deployment directories

---

## Required Files

### `src/entry.tsx` - Entry Point

The entry point exports `mount()` and `unmount()` functions for parent integration.

**Template**:
```typescript
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'

export interface MyAppProps {
  basename?: string      // Base URL path
  apiUrl?: string        // API endpoint (e.g., '/myapp/api')
  environment?: string   // 'development' | 'production'
  userType?: 'admin' | 'friend' | 'public'
}

export function mount(el: HTMLElement, props: MyAppProps = {}) {
  // Extract userType from URL params if not provided
  const urlParams = new URLSearchParams(window.location.search)
  const userType = props.userType || urlParams.get('userType') as any || 'public'
  
  const finalProps = { ...props, userType }
  const root = createRoot(el)
  root.render(<App {...finalProps} />)
  
  // Store root for unmounting
  ;(el as any).__root = root
  console.log('[my-app] Mounted successfully', finalProps)
}

export function unmount(el: HTMLElement) {
  ;(el as any).__root?.unmount()
}
```

**Key Points**:
- Export `mount(el, props)` - called by parent to render app
- Export `unmount(el)` - called by parent to cleanup
- Accept props interface for configuration
- Support `userType` from props or URL params
- Store root instance for cleanup

---

### `.github/workflows/build.yml` - CI/CD Pipeline

The workflow builds and deploys both client and server code to parent.

**Template**:
```yaml
name: Build and Deploy My App

on:
  push:
    branches: [ main ]
    paths:
      - 'src/**'
      - 'public/**'
      - 'package.json'
      - 'vite.config.ts'
      - 'tsconfig.json'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout this repository
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build application
        run: npm run build:all  # or just 'npm run build' if no server
      
      - name: Verify build output
        run: |
          # Verify client build exists
          if [ ! -f "dist/index.js" ]; then
            echo "❌ Error: dist/index.js not found"
            exit 1
          fi
          
          # If you have a server, verify it too
          # if [ ! -f "dist/server/router.js" ]; then
          #   echo "❌ Error: dist/server/router.js not found"
          #   exit 1
          # fi
      
      - name: Push built files to parent repository
        env:
          HADOKU_SITE_TOKEN: ${{ secrets.HADOKU_SITE_TOKEN }}
        run: |
          # Clone parent
          git clone https://${{ secrets.HADOKU_SITE_TOKEN }}@github.com/WolffM/hadoku_site.git parent
          cd parent
          
          # Create directories
          mkdir -p public/mf/myapp
          # mkdir -p api/apps/myapp  # If you have server code
          
          # Copy client build
          rm -rf public/mf/myapp/*
          cp -r ../dist/index.js ../dist/style.css public/mf/myapp/
          
          # Copy server build (if applicable)
          # rm -rf api/apps/myapp/*
          # cp -r ../dist/server/* api/apps/myapp/
          # cp ../package.json api/apps/myapp/
          
          # Configure git
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          
          # Commit and push
          git add public/mf/myapp/
          # git add api/apps/myapp/  # If you have server code
          
          if git diff --staged --quiet; then
            echo "✅ No changes to commit"
            echo "CHANGES_MADE=false" >> $GITHUB_ENV
          else
            git commit -m "chore: update myapp from ${{ github.sha }}"
            git push
            echo "✅ Successfully pushed myapp to hadoku_site"
            echo "CHANGES_MADE=true" >> $GITHUB_ENV
          fi
      
      - name: Trigger parent site deployment
        if: env.CHANGES_MADE == 'true'
        env:
          HADOKU_SITE_TOKEN: ${{ secrets.HADOKU_SITE_TOKEN }}
        run: |
          curl -X POST \
            "https://api.github.com/repos/WolffM/hadoku_site/dispatches" \
            -H "Authorization: Bearer $HADOKU_SITE_TOKEN" \
            -H "Accept: application/vnd.github+json" \
            -d '{"event_type":"myapp_updated","client_payload":{"sha":"${{ github.sha }}"}}'
```

**Key Points**:
- Triggers on pushes to main branch
- Requires `HADOKU_SITE_TOKEN` secret
- Builds client (and optionally server)
- Pushes to parent repository
- Triggers parent redeployment

---

## Optional: Backend API Router

If your app needs server-side logic, create an Express router.

### Directory Structure

```
src/
├── App.tsx           # React frontend
├── entry.tsx         # Mount/unmount exports
├── components/       # React components (optional)
├── hooks/            # Custom hooks (optional)
├── lib/              # Utilities & types
└── server/           # Backend code (optional)
    ├── router.ts                  # Express router (main entry)
    ├── storage.ts                 # Low-level storage operations
    ├── utils.ts                   # Utility functions
    ├── types.ts                   # TypeScript types
    ├── handlers/                  # Business logic (optional)
    │   └── data-access.ts        # Data access layer
    └── routes/                    # HTTP routes (optional)
        └── my-routes.ts          # Route handlers
```

### Router Template

**`src/server/router.ts`**:
```typescript
import { Router } from 'express'

export interface MyAppConfig {
  dataPath: string
  // Add your config options
}

export function createMyAppRouter(config: MyAppConfig) {
  const router = Router()
  
  // GET /
  router.get('/', (req, res) => {
    res.json({ message: 'Hello from my app!' })
  })
  
  // POST /
  router.post('/', (req, res) => {
    const data = req.body
    // Handle request
    res.json({ ok: true })
  })
  
  return router
}
```

### Build Configuration

**`tsconfig.server.json`**:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "target": "ES2022",
    "outDir": "./dist/server",
    "rootDir": "./src/server",
    "types": ["node"]
  },
  "include": ["src/server/**/*"]
}
```

**`package.json`**:
```json
{
  "scripts": {
    "build": "vite build",
    "build:router": "tsc -p tsconfig.server.json",
    "build:all": "npm run build && npm run build:router"
  }
}
```

---

## Parent Integration

### How Parent Loads Your App

**`hadoku_site/src/pages/myapp.astro`**:
```astro
---
// Astro page that mounts your micro-frontend
---
<html>
  <head>
    <link rel="stylesheet" href="/mf/myapp/style.css">
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      import { mount } from '/mf/myapp/index.js'
      
      mount(document.getElementById('app'), {
        apiUrl: '/myapp/api',
        environment: 'production',
        userType: 'friend'
      })
    </script>
  </body>
</html>
```

### How Parent Uses Your Router

The parent supports **two integration patterns**:

1. **Nested Express App** (local router, e.g., task API)
2. **Tunneled Remote API** (proxied to external server, e.g., watchparty API)

Both patterns create the same stable client contract: `/myapp/api/*`

---

#### **Pattern 1: Nested Express App (Local Router)**

For lightweight APIs that run directly in the parent process (JSON commits, database queries, etc.):

**Step 1: Import Your Router**
```typescript
import { createMyAppRouter } from './apps/myapp/router.js'
```

**Step 2: Create Nested Express App**
```typescript
const myAppApp = express()
myAppApp.use('/api', createMyAppRouter({
  dataPath: join(rootDir, 'data', 'myapp'),
  environment
}))
```

**Step 3: Mount as Nested App**
```typescript
app.use('/myapp', myAppApp)
```

This creates the stable client contract where your API is at `/myapp/api/*` and you can add other routes like `/myapp/health` without affecting the client.

---

#### **Pattern 2: Tunneled Remote API (Proxy)**

For heavy APIs that run on your local/home server (media streaming, FFmpeg, etc.):

**Step 1: Create Proxy Middleware**
```typescript
import { createProxyMiddleware } from 'http-proxy-middleware'
```

**Step 2: Create Nested Express App with Proxy**
```typescript
const watchpartyApp = express()
watchpartyApp.use('/api', createProxyMiddleware({
  target: 'https://watchparty-api.hadoku.me',
  changeOrigin: true
}))
```

**Step 3: Mount as Nested App**
```typescript
app.use('/watchparty', watchpartyApp)
```

Client still uses `/watchparty/api/*`, but requests are proxied to your tunnel endpoint.

---

#### **Unified Helper Function**

To simplify mounting both patterns, you can use a helper:

```typescript
import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'

function mountMicroApp(app, name, routerFactoryOrProxy) {
  const micro = express()
  
  if (typeof routerFactoryOrProxy === 'function') {
    // Pattern 1: Local router (nested Express app)
    micro.use('/api', routerFactoryOrProxy())
  } else {
    // Pattern 2: Remote proxy (tunneled API)
    micro.use('/api', createProxyMiddleware({
      target: routerFactoryOrProxy,
      changeOrigin: true
    }))
  }
  
  app.use(`/${name}`, micro)
}

// Example usage:

// Local JSON-committing Task API
mountMicroApp(app, 'task', () => createTaskRouter({ dataPath, environment }))

// Remote Watchparty API (tunneled to your home server)
mountMicroApp(app, 'watchparty', 'https://watchparty-api.hadoku.me')
```

**Benefits**:
- Same client contract (`/{app}/api/*`) for both patterns
- Easy to switch between local and remote
- Simple, consistent mounting API
- Future-proof for edge deployments

---

#### **Update API Info (Optional)**
```typescript
// In the /api endpoint
endpoints: {
  health: '/health',
  task: '/task/api',
  myapp: '/myapp/api'  // Add your app
}

// In the /health endpoint
services: {
  api: 'running',
  task: 'running',
  myapp: 'running'  // Add your app
}
```

#### **Complete Example**

**`hadoku_site/api/server.ts`**:
```typescript
import express from 'express'
import { join, dirname } from 'path'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { createTaskRouter } from './apps/task/router.js'
import { createMyAppRouter } from './apps/myapp/router.js'

const app = express()
const rootDir = dirname(__dirname)
const environment = process.env.NODE_ENV || 'development'

app.use(express.json())

// Helper to mount micro-apps with either pattern
function mountMicroApp(app, name, routerFactoryOrProxy) {
  const micro = express()
  
  if (typeof routerFactoryOrProxy === 'function') {
    // Pattern 1: Local router
    micro.use('/api', routerFactoryOrProxy())
  } else {
    // Pattern 2: Remote proxy
    micro.use('/api', createProxyMiddleware({
      target: routerFactoryOrProxy,
      changeOrigin: true
    }))
  }
  
  app.use(`/${name}`, micro)
}

// Mount local task API (lightweight JSON commits)
mountMicroApp(app, 'task', () => createTaskRouter({
  dataPath: join(rootDir, 'data', 'task'),
  environment
}))

// Mount your new local API
mountMicroApp(app, 'myapp', () => createMyAppRouter({
  dataPath: join(rootDir, 'data', 'myapp'),
  environment
}))

// Mount remote watchparty API (heavy media streaming)
// Requires Cloudflare Tunnel or similar at watchparty-api.hadoku.me
mountMicroApp(app, 'watchparty', 'https://watchparty-api.hadoku.me')

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    endpoints: {
      health: '/health',
      task: '/task/api',
      myapp: '/myapp/api',
      watchparty: '/watchparty/api'
    }
  })
})

app.listen(3000)
```

**That's it!** The parent never needs to know about your individual endpoints - they're all encapsulated in your router or proxied transparently. Both patterns use the same stable client contract.

---

## GitHub Token Management

### Token Requirements

The `HADOKU_SITE_TOKEN` secret needs:
- **Permissions**: `repo` scope (read/write access)
- **Purpose**: Push builds to parent repo
- **Security**: Managed by parent admin script

### Token Sync Script (Parent Repo)

**`hadoku_site/scripts/sync-tokens.sh`**:
```bash
#!/bin/bash
# Sync HADOKU_SITE_TOKEN to all child app repositories

TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
OWNER="WolffM"

CHILD_REPOS=(
  "hadoku-task"
  "hadoku-watchparty"
  "hadoku-myapp"
)

for REPO in "${CHILD_REPOS[@]}"; do
  echo "Syncing token to $REPO..."
  
  gh secret set HADOKU_SITE_TOKEN \
    --repo "$OWNER/$REPO" \
    --body "$TOKEN"
  
  echo "✅ Synced to $REPO"
done
```

**Usage**:
```bash
# Run from parent repository
./scripts/sync-tokens.sh
```

---

## Development Workflow

### Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Open http://localhost:5173
# Test with different user types:
# http://localhost:5173?userType=public
# http://localhost:5173?userType=friend
# http://localhost:5173?userType=admin
```

### Test Server (Optional)

If you have a backend router, create a test server:

**`test-server.ts`**:
```typescript
import express from 'express'
import { createMyAppRouter } from './src/server/router.js'

const app = express()
app.use(express.json())

const myAppApp = express()
myAppApp.use('/api', createMyAppRouter({
  dataPath: './data'
}))

app.use('/myapp', myAppApp)
app.use(express.static('.'))

app.listen(3001, () => {
  console.log('Test server: http://localhost:3001')
})
```

### Deployment Flow

1. **Push to main branch**
2. **GitHub Actions builds** client and server
3. **Workflow pushes** to parent repository
4. **Workflow triggers** parent deployment
5. **Parent deploys** to production
6. **Users access** at `hadoku.me/myapp`

---

## Testing

### Manual Testing

1. **Local dev**: `npm run dev`
2. **Build test**: `npm run build:all`
3. **Integration test**: Copy `dist/` to parent's `public/mf/myapp/`

### Automated Testing

Add to workflow:
```yaml
- name: Run tests
  run: npm test

- name: Run E2E tests
  run: npm run test:e2e
```

---

## Checklist for New App

- [ ] Clone template repository
- [ ] Update `package.json` name
- [ ] Update `entry.tsx` with app name
- [ ] Update `.github/workflows/build.yml` paths
- [ ] Add `HADOKU_SITE_TOKEN` secret
- [ ] Create app in parent at `public/mf/myapp/`
- [ ] Create page in parent at `src/pages/myapp.astro`
- [ ] Test local development
- [ ] Test deployment workflow
- [ ] Update parent to mount app
- [ ] Verify production deployment

---

## Troubleshooting

### Build fails
- Check `package.json` scripts
- Verify TypeScript config
- Run `npm run build` locally

### Deployment fails
- Verify `HADOKU_SITE_TOKEN` secret exists
- Check token has `repo` scope
- Verify parent repository structure

### App doesn't mount
- Check `entry.tsx` exports `mount` and `unmount`
- Verify parent is loading correct files
- Check console for errors

### API not working
- Verify router is mounted in parent
- Check API path matches client
- Test router locally with test server

---

## Best Practices

1. **Keep entry point minimal** - Just mount/unmount logic
2. **Export TypeScript types** - For parent integration
3. **Support all user types** - public, friend, admin
4. **Handle props gracefully** - Provide defaults
5. **Clean up on unmount** - Remove listeners, timers
6. **Test locally first** - Before deploying
7. **Document your API** - If you have a router
8. **Use consistent naming** - Match parent conventions

---

## Resources

- Parent repository: [WolffM/hadoku_site](https://github.com/WolffM/hadoku_site)
- Example app: [WolffM/hadoku-task](https://github.com/WolffM/hadoku-task)
- Micro-frontends pattern: [Single-SPA](https://single-spa.js.org/)
- GitHub Actions: [docs.github.com](https://docs.github.com/actions)

---

**Template Version**: 1.0.0  
**Last Updated**: October 6, 2025
