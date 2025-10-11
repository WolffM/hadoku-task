# Child App Template

**Template for creating micro-frontend child apps for hadoku.me**

This template provides the structure and configuration needed to create a new child app that integrates with the parent `hadoku_site` application.

---

## Overview

Child apps are independent applications that:
- Run as micro-frontends mounted in the parent app
- Provide framework-agnostic API handlers using the Universal Adapter Pattern
- Auto-deploy to parent on code changes
- Share authentication/user context from parent
- Support multiple deployment strategies (Cloudflare Workers, self-hosted)

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

## Backend API Handlers (Universal Adapter Pattern)

If your app needs server-side logic, use the Universal Adapter Pattern for framework-agnostic handlers.

### Directory Structure

```
src/
├── App.tsx           # React frontend
├── entry.tsx         # Mount/unmount exports
├── components/       # React components (optional)
├── hooks/            # Custom hooks (optional)
├── lib/              # Frontend utilities
└── server/           # Backend handlers (framework-agnostic)
    ├── index.ts      # Exports (handlers, types, storage interface)
    ├── handlers.ts   # Pure business logic
    ├── storage.ts    # Storage interface + filesystem implementation
    ├── types.ts      # TypeScript types (single source of truth)
    ├── utils.ts      # Utility functions
    ├── router.ts     # Express adapter (optional, for testing)
    └── routes-adapter.ts  # Route factory (optional)
```

### Handler Template

**`src/server/handlers.ts`** (Framework-agnostic):
```typescript
import type { Storage, AuthContext, MyData } from './types.js'

export async function getData(storage: Storage, auth: AuthContext) {
  const data = await storage.getData(auth.userType)
  return { data }
}

export async function createItem(
  storage: Storage,
  auth: AuthContext,
  input: { title: string }
) {
  const data = await storage.getData(auth.userType)
  const newItem = { id: generateId(), title: input.title, createdAt: new Date().toISOString() }
  
  const updated = { ...data, items: [...data.items, newItem] }
  await storage.saveData(auth.userType, updated)
  
  return newItem
}
```

### Storage Interface

**`src/server/storage.ts`**:
```typescript
export interface Storage {
  getData(userType: UserType): Promise<MyData>
  saveData(userType: UserType, data: MyData): Promise<void>
}

// Filesystem implementation (for self-hosted)
export function createStorage(dataPath: string): Storage {
  return {
    async getData(userType) {
      // Read from filesystem
    },
    async saveData(userType, data) {
      // Write to filesystem
    }
  }
}
```

### Package Exports

**`src/server/index.ts`**:
```typescript
export * as MyAppHandlers from './handlers.js'
export * as MyAppUtils from './utils.js'
export type { Storage as MyAppStorage } from './storage.js'
export type { MyData, AuthContext, UserType } from './types.js'
```

### Express Adapter (Optional)

**`src/server/router.ts`** (For testing/self-hosted):
```typescript
import { Router } from 'express'
import * as Handlers from './handlers.js'
import { createStorage } from './storage.js'

export function createMyAppRouter(config: { dataPath: string }) {
  const storage = createStorage(config.dataPath)
  const router = Router()
  
  router.get('/', async (req, res) => {
    const auth = { userType: req.header('X-User-Type') || 'public' }
    const result = await Handlers.getData(storage, auth)
    res.json(result)
  })
  
  router.post('/', async (req, res) => {
    const auth = { userType: req.header('X-User-Type') || 'public' }
    const result = await Handlers.createItem(storage, auth, req.body)
    res.json(result)
  })
  
  return router
}
```

### Build Configuration

**`package.json`** (Package exports):
```json
{
  "name": "@hadoku/myapp",
  "type": "module",
  "exports": {
    ".": "./dist/index.js",
    "./api": "./src/server/index.ts",
    "./api/types": "./src/server/types.ts"
  },
  "scripts": {
    "build": "vite build",
    "build:handlers": "tsc -p tsconfig.server.json --moduleResolution bundler",
    "build:all": "npm run build && npm run build:handlers"
  }
}
```

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

---

## Parent Integration

### How Parent Loads Your App (Client)

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

### How Parent Uses Your Handlers (Server)

The parent imports your handlers and creates routes with their chosen framework.

#### **Option 1: Cloudflare Workers (Hono)**

```typescript
import { Hono } from 'hono'
import { MyAppHandlers, MyAppStorage } from '@hadoku/myapp/api'

const app = new Hono()

// Implement storage with Cloudflare KV
const storage: MyAppStorage = {
  getData: async (userType) => {
    const data = await env.MYAPP_KV.get(`data:${userType}`, 'json')
    return data || { version: 1, items: [] }
  },
  saveData: async (userType, data) => {
    await env.MYAPP_KV.put(`data:${userType}`, JSON.stringify(data))
  }
}

// Create routes using handlers
app.get('/myapp/api', async (c) => {
  const auth = { userType: c.req.header('X-User-Type') || 'public' }
  return c.json(await MyAppHandlers.getData(storage, auth))
})

app.post('/myapp/api', async (c) => {
  const auth = { userType: c.req.header('X-User-Type') || 'public' }
  const input = await c.req.json()
  return c.json(await MyAppHandlers.createItem(storage, auth, input))
})
```

#### **Option 2: Self-Hosted (Express)**

```typescript
import express from 'express'
import { createMyAppRouter } from './apps/myapp/router.js'

const app = express()

// Use the included Express adapter
app.use('/myapp/api', createMyAppRouter({ dataPath: './data/myapp' }))
```

Both approaches create the same client contract: `/myapp/api/*`

---

### Deployment Strategy Examples

#### **Self-Hosted with Express**

The parent uses your included Express adapter:

```typescript
import express from 'express'
import { createMyAppRouter } from './apps/myapp/router.js'

const app = express()
app.use('/myapp/api', createMyAppRouter({ dataPath: './data/myapp' }))
app.listen(3000)
```

Your `router.ts` uses the filesystem storage implementation you provide.

---

#### **Cloudflare Workers with Hono**

The parent imports your handlers and implements KV storage:

```typescript
import { Hono } from 'hono'
import { MyAppHandlers, MyAppStorage } from '@hadoku/myapp/api'

const app = new Hono()

// Parent implements KV storage
const createStorage = (env): MyAppStorage => ({
  getData: async (userType) => {
    const data = await env.MYAPP_KV.get(`data:${userType}`, 'json')
    return data || { version: 1, items: [] }
  },
  saveData: async (userType, data) => {
    await env.MYAPP_KV.put(`data:${userType}`, JSON.stringify(data))
  }
})

// Use handlers with Hono
app.get('/myapp/api', async (c) => {
  const storage = createStorage(c.env)
  const auth = { userType: c.req.header('X-User-Type') || 'public' }
  return c.json(await MyAppHandlers.getData(storage, auth))
})

export default app
```

---

### Benefits of Universal Adapter Pattern

✅ **Framework Agnostic** - Same handlers work with Express, Hono, or any framework  
✅ **Deployment Flexibility** - Self-hosted or Cloudflare Workers without code changes  
✅ **Storage Abstraction** - Parent chooses storage (filesystem, KV, database)  
✅ **Pure Business Logic** - Handlers have no framework dependencies  
✅ **Easy Testing** - Mock the Storage interface for unit tests

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
2. **Use Universal Adapter Pattern** - Export pure handlers, not framework-specific code
3. **Single source of truth for types** - Export types from `src/server/types.ts` via package.json
4. **Support all user types** - public, friend, admin
5. **Handle props gracefully** - Provide defaults
6. **Clean up on unmount** - Remove listeners, timers
7. **Test locally first** - Before deploying
8. **Document your handlers** - List exported functions and their signatures
9. **Use consistent naming** - Match parent conventions
10. **Implement Storage interface** - Don't couple handlers to specific storage

---

## Resources

- Parent repository: [WolffM/hadoku_site](https://github.com/WolffM/hadoku_site)
- Example app: [WolffM/hadoku-task](https://github.com/WolffM/hadoku-task)
- Micro-frontends pattern: [Single-SPA](https://single-spa.js.org/)
- GitHub Actions: [docs.github.com](https://docs.github.com/actions)

---

**Template Version**: 1.0.0  
**Last Updated**: October 6, 2025
